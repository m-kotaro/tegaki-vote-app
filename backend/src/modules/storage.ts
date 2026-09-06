// backend/src/modules/storage.ts
// Storage_Module の純粋ロジック部分（レコードビルダと生成関数）。
// 副作用を持つ配線（S3 保存 / DynamoDB 書き込み / ロールバック・リトライ）は
// 後続タスク（5.3）で store() として実装する。ここでは純粋なビルダのみを提供し、
// design.md Property 9 / Property 10、Requirements 6.3〜6.6 を検証しやすい構造にする。

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import type { AnalyzedVote, VoteRecord, VoteResult } from "@tegaki/shared";
import { toVoteResult } from "./response.js";

/**
 * 一意な vote_id（UUID）を生成する（Req 6.3, Property 9）。
 *
 * crypto.randomUUID() により RFC 4122 準拠の UUID v4 文字列を返す。
 * この関数は乱数生成という非決定的処理を含むため、buildRecord からは分離し、
 * 生成値を引数で受け取れる構造にしている（buildRecord を純粋に保つため）。
 */
export function generateVoteId(): string {
  return crypto.randomUUID();
}

/**
 * created_at を ISO 8601 UTC 形式（YYYY-MM-DDThh:mm:ssZ、秒精度）で生成する
 * （Req 6.6）。
 *
 * Date#toISOString() はミリ秒を含む（例: 2026-04-01T12:34:56.789Z）ため、
 * 秒精度に切り詰めて末尾を Z（UTC）で終える形に整形する。
 * この関数は現在時刻という非決定的処理を含むため、buildRecord からは分離し、
 * 生成値を引数で受け取れる構造にしている。
 *
 * @param date 整形対象の時刻（省略時は現在時刻）
 */
export function generateCreatedAt(date: Date = new Date()): string {
  // "2026-04-01T12:34:56.789Z" → "2026-04-01T12:34:56Z"
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * 正規化済み解析結果（AnalyzedVote）と付随情報から、Votes_Table に書き込む
 * VoteRecord を構築する純粋関数（Req 6.4 / 6.5 / 6.6, Property 10）。
 *
 * 全属性（vote_id・election_id・image_key・recognized_text・matched_candidate・
 * is_valid・confidence・reason・created_at）を含み、各値は入力に対応する。
 * matched_candidate が存在しない（null）入力では null のまま格納される（Req 6.5）。
 *
 * vote_id / created_at は非決定的な生成処理（generateVoteId / generateCreatedAt）から
 * 分離するため引数で受け取る。これにより本関数は副作用を持たず、同じ入力に対して
 * 常に同じ VoteRecord を返す純粋関数として検証できる。
 *
 * @param analyzed  Analyzer が正規化した解析結果（AnalyzedVote）
 * @param electionId 対象 Election の election_id
 * @param imageKey  Image_Store に保存した画像の S3 オブジェクトキー
 * @param voteId    生成済みの vote_id（generateVoteId の戻り値）
 * @param createdAt 生成済みの created_at（generateCreatedAt の戻り値、ISO 8601 UTC）
 */
export function buildRecord(
  analyzed: AnalyzedVote,
  electionId: string,
  imageKey: string,
  voteId: string,
  createdAt: string,
): VoteRecord {
  return {
    vote_id: voteId,
    election_id: electionId,
    image_key: imageKey,
    recognized_text: analyzed.recognized_text,
    matched_candidate: analyzed.matched_candidate,
    is_valid: analyzed.is_valid,
    confidence: analyzed.confidence,
    reason: analyzed.reason,
    created_at: createdAt,
  };
}
// ---------------------------------------------------------------------------
// 副作用配線（S3 + DynamoDB）— タスク 5.3
// Req 6.1 / 6.2 / 6.7 / 6.8, 8.2, 8.3
// design.md: Components / Storage_Module
//
// store() は純粋な buildRecord / generateVoteId / generateCreatedAt を活用しつつ、
// 画像保存（S3）・レコード書き込み（DynamoDB）・失敗時ロールバック・リトライを
// 配線する副作用付き関数である。実 AWS 依存（S3 / DynamoDB クライアント）は
// StorageDeps として注入可能にし、タスク 5.4 / 5.5 のテストでモックへ差し替えられる。
// ---------------------------------------------------------------------------

/**
 * store() の戻り値（design.md Storage_Module の StorageResult）。
 * - `ok: true`  … 保存成功。200 レスポンス契約を満たす VoteResult を返す（Req 7.1）
 * - `ok: false` … 保存失敗（STORAGE_FAILED, Req 6.7 / 6.8, 8.2, 8.3）
 */
export type StorageResult =
  | { ok: true; result: VoteResult }
  | { ok: false; code: "STORAGE_FAILED"; message: string };

/** S3 / DynamoDB の各操作の最大試行回数（Req 8.3: 最大 3 回リトライ = 初回 + 追加 2 回 = 計 3 回試行）。 */
export const STORAGE_MAX_ATTEMPTS = 3;

/** 画像 PNG の ContentType（design.md: 画像の ContentType は image/png）。 */
const IMAGE_CONTENT_TYPE = "image/png";

/**
 * store() が依存する副作用の注入口。実運用では AWS SDK クライアントを、
 * テストではモックを差し替える（タスク 5.4 / 5.5 のテスト容易性のため）。
 *
 * いずれも「1 回の試行」を表す。リトライ（Req 8.3）は store() 側が担うため、
 * ここでは単発の put / delete のみを実装すればよい。
 */
export interface StorageDeps {
  /** Image_Store（S3）へ画像を 1 回保存する。失敗時は例外を投げる。 */
  putImage(params: { key: string; body: Buffer }): Promise<void>;
  /** Image_Store（S3）から画像を 1 回削除する（ロールバック用）。失敗時は例外を投げる。 */
  deleteImage(params: { key: string }): Promise<void>;
  /** Votes_Table（DynamoDB）へレコードを 1 回書き込む。失敗時は例外を投げる。 */
  putRecord(params: { record: VoteRecord }): Promise<void>;
}

/**
 * store() の環境設定。バケット名・テーブル名は環境変数から取得する
 * （design.md: S3 バケット名・DynamoDB テーブル名は環境変数から取得）。
 */
export interface StorageConfig {
  /** Image_Store の S3 バケット名（env IMAGE_BUCKET）。 */
  bucket: string;
  /** Votes_Table の DynamoDB テーブル名（env VOTES_TABLE）。 */
  table: string;
  /** 各操作の最大試行回数（既定 STORAGE_MAX_ATTEMPTS = 3, Req 8.3）。 */
  maxAttempts?: number;
}

/** モジュールスコープで使い回す既定の AWS SDK クライアント（遅延生成）。 */
let defaultS3: S3Client | undefined;
let defaultDdbDoc: DynamoDBDocumentClient | undefined;

function getDefaultS3(): S3Client {
  if (!defaultS3) {
    defaultS3 = new S3Client({});
  }
  return defaultS3;
}

function getDefaultDdbDoc(): DynamoDBDocumentClient {
  if (!defaultDdbDoc) {
    defaultDdbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return defaultDdbDoc;
}

/**
 * 環境変数から StorageConfig を読み取る（design.md: 環境変数から取得）。
 * 未設定時は例外を投げる（デプロイ時の設定漏れを早期検出するため）。
 */
export function storageConfigFromEnv(): StorageConfig {
  const bucket = process.env.IMAGE_BUCKET;
  const table = process.env.VOTES_TABLE;
  if (!bucket) {
    throw new Error("環境変数 IMAGE_BUCKET が未設定です");
  }
  if (!table) {
    throw new Error("環境変数 VOTES_TABLE が未設定です");
  }
  return { bucket, table };
}

/**
 * 実 AWS SDK クライアントを用いた既定の StorageDeps を生成する。
 * S3 / DynamoDB クライアントは引数で差し替え可能（テスト容易性のため）。
 *
 * @param config バケット名・テーブル名
 * @param clients 差し替え用の S3 / DynamoDB Document クライアント（省略時は既定を遅延生成）
 */
export function createStorageDeps(
  config: StorageConfig,
  clients?: {
    s3?: S3Client;
    ddbDoc?: DynamoDBDocumentClient;
  },
): StorageDeps {
  const s3 = clients?.s3 ?? getDefaultS3();
  const ddbDoc = clients?.ddbDoc ?? getDefaultDdbDoc();

  return {
    async putImage({ key, body }) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: IMAGE_CONTENT_TYPE,
        }),
      );
    },
    async deleteImage({ key }) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
    },
    async putRecord({ record }) {
      await ddbDoc.send(
        new PutCommand({
          TableName: config.table,
          Item: record,
        }),
      );
    },
  };
}

/** store() のオプション引数。DI とリトライ回数を差し替え可能にする（タスク 5.4 / 5.5）。 */
export interface StoreOptions {
  /** 副作用の注入口。省略時は環境変数 + 既定 AWS クライアントから生成する。 */
  deps?: StorageDeps;
  /** 各操作の最大試行回数（省略時 STORAGE_MAX_ATTEMPTS = 3, Req 8.3）。 */
  maxAttempts?: number;
}

/**
 * 与えた非同期操作を最大 attempts 回まで試行する（Req 8.3）。
 * すべて失敗した場合は最後の例外を再送出する。試行間は指数バックオフで待機する
 * （最初の試行は即時、リトライ時のみ待機）。テストでは maxAttempts=1 として
 * バックオフを回避できる。
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  attempts: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        // 指数バックオフ: 100ms, 200ms, ...（リトライ時のみ待機）。
        const delayMs = 100 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 解析済み投票を永続化する副作用付き関数（Req 6.1 / 6.2 / 6.7 / 6.8, 8.2, 8.3）。
 *
 * 手順（design.md Storage_Module に厳密準拠）:
 *   1. vote_id = generateVoteId()、created_at = generateCreatedAt()（Req 6.3 / 6.6）
 *   2. 画像を Image_Store（S3）へ保存。キーは `votes/{election_id}/{vote_id}.png`
 *      （Req 6.1 / 6.2）。最大 maxAttempts 回リトライ（Req 8.3）
 *   3. S3 保存失敗時は DynamoDB へ書き込まず STORAGE_FAILED を返す（Req 6.7）
 *   4. buildRecord で VoteRecord を構築し Votes_Table（DynamoDB）へ書き込む
 *      （Req 6.4 / 6.5）。最大 maxAttempts 回リトライ（Req 8.3）
 *   5. DynamoDB 書き込み失敗時は保存済み S3 画像を削除してロールバックし
 *      STORAGE_FAILED を返す（Req 6.8 / 8.2）
 *   6. 成功時は toVoteResult で VoteResult を構築して返す（Req 7.1）
 *
 * 副作用（S3 / DynamoDB）は StoreOptions.deps 経由で注入可能。省略時は環境変数
 * （IMAGE_BUCKET / VOTES_TABLE）と既定 AWS クライアントから生成する。
 *
 * @param analyzed   Analyzer が正規化した解析結果
 * @param electionId 対象 Election の election_id
 * @param image      保存する手書き画像（PNG バイト列）
 * @param options    DI とリトライ回数の差し替え（テスト容易性のため）
 */
export async function store(
  analyzed: AnalyzedVote,
  electionId: string,
  image: Buffer,
  options: StoreOptions = {},
): Promise<StorageResult> {
  const deps = options.deps ?? createStorageDeps(storageConfigFromEnv());
  const maxAttempts = options.maxAttempts ?? STORAGE_MAX_ATTEMPTS;

  // 1. 非決定的な生成値（純粋な生成関数を活用）。
  const voteId = generateVoteId();
  const createdAt = generateCreatedAt();
  const imageKey = `votes/${electionId}/${voteId}.png`;

  // 2. 画像を Image_Store（S3）へ保存（Req 6.1 / 6.2）。最大 maxAttempts 回リトライ（Req 8.3）。
  try {
    await withRetry(() => deps.putImage({ key: imageKey, body: image }), maxAttempts);
  } catch (error) {
    // 3. S3 保存失敗時は DynamoDB へ書き込まず STORAGE_FAILED（Req 6.7）。
    return {
      ok: false,
      code: "STORAGE_FAILED",
      message: `画像の保存に失敗しました: ${errorMessage(error)}`,
    };
  }

  // 4. VoteRecord を構築（純粋関数 buildRecord）し Votes_Table（DynamoDB）へ書き込む
  //    （Req 6.4 / 6.5）。最大 maxAttempts 回リトライ（Req 8.3）。
  const record = buildRecord(analyzed, electionId, imageKey, voteId, createdAt);
  try {
    await withRetry(() => deps.putRecord({ record }), maxAttempts);
  } catch (writeError) {
    // 5. DynamoDB 書き込み失敗時は保存済み S3 画像を削除してロールバック（Req 6.8 / 8.2）。
    //    ロールバックの削除もリトライするが、削除自体が失敗しても STORAGE_FAILED を返す。
    try {
      await withRetry(() => deps.deleteImage({ key: imageKey }), maxAttempts);
    } catch {
      // ロールバック削除の失敗は握りつぶし、元の書き込み失敗として報告する。
      // （部分データを極力残さない努力はしたが、これ以上は呼び出し元へ委ねる）
    }
    return {
      ok: false,
      code: "STORAGE_FAILED",
      message: `投票結果の書き込みに失敗しました: ${errorMessage(writeError)}`,
    };
  }

  // 6. 成功時は toVoteResult で VoteResult を構築して返す（Req 7.1）。
  return { ok: true, result: toVoteResult(record) };
}
