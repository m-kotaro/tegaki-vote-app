// backend/src/handler.ts — Lambda handler ルーティング（Task 5.6）。
//
// API Gateway プロキシ統合の handler をエクスポートし、以下 2 経路をルーティングする。
//   - POST /votes                          … 受付 → 解析 → 保存 → 200 VoteResult
//   - GET /elections/{election_id}/results … DynamoDB 読み取り → 票レコード一覧を 200 で返す（集計しない）
//
// 各失敗は design.md「Error Handling」のステータスコード表に従いエラーレスポンスへマップする。
// 解析失敗時は S3・DDB 保存を一切行わない（analyze が失敗を返した時点で store を呼ばない, Req 8.1）。
//
// Backend は開票回・候補者の定義を持たない（Req 10.2）。election_id は保存ラベルとして扱い、
// 開票回定義との照合（NOT_FOUND 拒否）は行わない（Req 4.6 / 9.1）。判定基準の candidates は
// リクエストで受け取り、集計はフロントが行う（Backend は票レコード一覧を返すのみ, Req 9.1〜9.5）。
//
// 対応 Requirement: 4.1, 4.6, 7.1, 8.1, 9.1, 9.2
// 対応 design.md: Architecture（投票処理シーケンス）, Components / Results, API 契約, Error Handling

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import type {
  ErrorResponse,
  VoteRecord,
  ElectionResultsResponse,
} from "@tegaki/shared";

import { validateVoteRequest } from "./modules/receiver.js";
import { analyze } from "./modules/analyzer.js";
import { store } from "./modules/storage.js";
import { toVoteRecordSummaries } from "./modules/results.js";

// ---------------------------------------------------------------------------
// CORS / レスポンスヘルパ
// ---------------------------------------------------------------------------

/**
 * 全レスポンスに付与する CORS ヘッダ（design.md Security / 非機能: CORS）。
 * API Gateway 側 CORS 設定（infra Task 9.2）に加え、handler でもレスポンスヘッダを付ける。
 * v1 のデモ用途のためオリジンは緩めに許可する。
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
};

/** 成功 / エラーを問わず JSON ボディ + CORS ヘッダを付けた APIGatewayProxyResult を作る。 */
function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/** 共通エラーボディ形式 `{ error: { code, message } }` を作る（design.md エラーレスポンス形式）。 */
function errorResponse(
  statusCode: number,
  code: ErrorResponse["error"]["code"],
  message: string,
): APIGatewayProxyResult {
  const body: ErrorResponse = { error: { code, message } };
  return jsonResponse(statusCode, body);
}

// ---------------------------------------------------------------------------
// DynamoDB 読み取り（results 用の副作用）
// ---------------------------------------------------------------------------

/** モジュールスコープで使い回す既定の DynamoDB Document クライアント（遅延生成）。 */
let defaultDdbDoc: DynamoDBDocumentClient | undefined;

function getDefaultDdbDoc(): DynamoDBDocumentClient {
  if (!defaultDdbDoc) {
    defaultDdbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return defaultDdbDoc;
}

/**
 * 指定 election_id の VoteRecord 群を Votes_Table から読み取る（Req 9）。
 *
 * v1 の方針（design.md Data Models）に従い、GSI は用いずスキャン + election_id フィルタで
 * 全ページを走査する。読み取りクライアント・テーブル名は差し替え可能にし（テスト容易性）、
 * テーブル名は環境変数 VOTES_TABLE から解決する。
 *
 * @param electionId 集計対象の election_id
 * @param options    DI とテーブル名の差し替え（省略時は既定クライアント + env VOTES_TABLE）
 */
export async function readVotesByElection(
  electionId: string,
  options: { ddbDoc?: DynamoDBDocumentClient; table?: string } = {},
): Promise<VoteRecord[]> {
  const ddbDoc = options.ddbDoc ?? getDefaultDdbDoc();
  const table = options.table ?? process.env.VOTES_TABLE;
  if (!table) {
    throw new Error("環境変数 VOTES_TABLE が未設定です");
  }

  const records: VoteRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const output = await ddbDoc.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "election_id = :eid",
        ExpressionAttributeValues: { ":eid": electionId },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    for (const item of output.Items ?? []) {
      records.push(item as VoteRecord);
    }
    lastEvaluatedKey = output.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  return records;
}

// ---------------------------------------------------------------------------
// ルートハンドラ
// ---------------------------------------------------------------------------

/** API Gateway プロキシイベントから生のリクエストボディ文字列を取り出す（base64 対応）。 */
function extractRawBody(event: APIGatewayProxyEvent): string | null {
  if (event.body === null || event.body === undefined) {
    return null;
  }
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf-8");
  }
  return event.body;
}

/**
 * POST /votes: 受付 → 解析 → 保存 → 200 VoteResult（Req 4.1 / 4.6 / 7.1 / 8.1）。
 *
 * 各失敗を design.md のステータスコード表へマップする。
 *   - VALIDATION_ERROR → 400（入力不正。election_id は照合せず非空チェックのみ, Req 4.6）
 *   - LIST_INVALID → 400、ANALYSIS_FAILED → 502（解析失敗時は保存しない, Req 8.1）
 *   - STORAGE_FAILED → 500
 */
async function handleVote(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  // 1. 受付・入力検証（Req 4.x）。election_id は保存ラベルとして非空チェックのみ（照合なし, Req 4.6）。
  const rawBody = extractRawBody(event);
  const validation = validateVoteRequest(rawBody);
  if (!validation.ok) {
    // VALIDATION_ERROR → 400（入力不正）。Backend は開票回定義を持たず NOT_FOUND は返さない。
    return errorResponse(400, validation.code, validation.message);
  }

  // 2. 解析（Req 5.x）。リクエストで受け取った candidates を判定基準に用いる（Req 5.1）。
  const analysis = await analyze(validation.image, validation.candidates);
  if (!analysis.ok) {
    // LIST_INVALID → 400、ANALYSIS_FAILED → 502。
    // 解析失敗時点で store を呼ばないため S3・DDB 保存は行われない（Req 8.1）。
    const status = analysis.code === "LIST_INVALID" ? 400 : 502;
    return errorResponse(status, analysis.code, analysis.message);
  }

  // 3. 保存（Req 6.x）。S3 → DynamoDB、失敗時はロールバック（storage 側が担う）。
  const storage = await store(
    analysis.result,
    validation.electionId,
    validation.image,
  );
  if (!storage.ok) {
    return errorResponse(500, storage.code, storage.message);
  }

  // 4. 成功。200 VoteResult をそのまま返す（Req 7.1）。
  return jsonResponse(200, storage.result);
}

/**
 * GET /elections/{election_id}/results: DynamoDB 読み取り → 票レコード一覧を 200 で返す（Req 9.1 / 9.2）。
 *
 * Backend は開票回定義を持たないため、election_id を保存ラベルとして扱い照合しない（Req 9.1）。
 * Votes_Table から当該 election_id のレコードを読み取り、VoteRecordSummary[] に写像して返すのみで、
 * 集計（総数・有効/無効・候補者別得票）はフロントが行う（Req 9.3〜9.5）。
 * 該当レコードがない場合は空配列を返す（Req 9.2）。
 */
async function handleResults(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const electionId = event.pathParameters?.election_id;
  if (electionId === undefined || electionId.length === 0) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "election_id がパスに含まれていません",
    );
  }

  // DynamoDB から当該 election_id の投票を読み取り、票レコード一覧を返す（集計なし, Req 9.1 / 9.2）。
  const records = await readVotesByElection(electionId);
  const response: ElectionResultsResponse = {
    election_id: electionId,
    votes: toVoteRecordSummaries(records),
  };
  return jsonResponse(200, response);
}

/** メソッド + リソースパスからルートを判定する。 */
function matchesVotes(event: APIGatewayProxyEvent): boolean {
  const method = event.httpMethod?.toUpperCase();
  const path = event.resource ?? event.path ?? "";
  return method === "POST" && path.replace(/\/$/, "").endsWith("/votes");
}

function matchesResults(event: APIGatewayProxyEvent): boolean {
  const method = event.httpMethod?.toUpperCase();
  const path = event.resource ?? event.path ?? "";
  return (
    method === "GET" &&
    /\/elections\/[^/]+\/results$/.test(path.replace(/\/$/, ""))
  );
}

/**
 * AWS Lambda（API Gateway プロキシ統合）の handler。
 * POST /votes と GET /elections/{election_id}/results をルーティングし、
 * 該当しないメソッド / パスは 404 を返す（ErrorResponse.code の契約外のため
 * ルーティング専用の簡易ボディで返す）。予期しない例外は 500 に丸める。
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    // CORS プリフライトへの応答（OPTIONS）。
    if (event.httpMethod?.toUpperCase() === "OPTIONS") {
      return jsonResponse(200, {});
    }

    if (matchesVotes(event)) {
      return await handleVote(event);
    }
    if (matchesResults(event)) {
      return await handleResults(event);
    }

    // 未定義ルート。ErrorResponse.code は API 契約（Backend が返すエラー）に限定されるため、
    // ルーティングの 404 は契約型に載せず簡易ボディで返す。
    return jsonResponse(404, {
      error: { code: "NOT_FOUND", message: "対象のリソースが存在しません" },
    });
  } catch (error) {
    // 予期しない例外（DynamoDB 読み取り失敗など）は 500 STORAGE_FAILED に丸める。
    const message =
      error instanceof Error ? error.message : String(error);
    return errorResponse(500, "STORAGE_FAILED", message);
  }
};
