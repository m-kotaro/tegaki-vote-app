// backend/src/modules/analyzer.ts — Analyzer_Module（解析結果の正規化）
//
// 本ファイルは Bedrock 生応答を正規化する副作用のない純粋関数
// `normalizeAnalysis` と、Bedrock 呼び出し（副作用）を配線して正規化済み
// 結果を返す `analyze` を提供する。Bedrock クライアントラッパ（プロンプト構築・
// タイムアウト・リトライ）は bedrock.ts に分離し、本ファイルはそれを結合する。
//
// 対応 Requirement: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 10.5, 10.7
// 対応 design.md: Components / Analyzer_Module, Property 4〜7

import type { AnalyzedVote, Candidate } from "@tegaki/shared";
import { validateCandidateList } from "./candidateList.js";
import {
  createBedrockClient,
  invokeBedrock,
  resolveAnalyzerConfig,
  type AnalyzerConfig,
} from "./bedrock.js";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

export type { AnalyzerConfig } from "./bedrock.js";

/**
 * 正規化の結果（design.md Analyzer_Module の AnalysisOutcome）。
 * - `ok: true`  … 正規化済みの解析結果 `AnalyzedVote` を返す
 * - `ok: false` … 解析失敗（ANALYSIS_FAILED, Req 5.8）または
 *                 候補者リスト不正（LIST_INVALID, Req 10.7）
 */
export type AnalysisOutcome =
  | { ok: true; result: AnalyzedVote }
  | {
      ok: false;
      code: "ANALYSIS_FAILED" | "LIST_INVALID";
      message: string;
    };

/** 判読不能とみなす confidence の下限（Req 5.5: 0.5 未満は判読不能）。 */
const CONFIDENCE_THRESHOLD = 0.5;

const ANALYSIS_FAILED = (message: string): AnalysisOutcome => ({
  ok: false,
  code: "ANALYSIS_FAILED",
  message,
});

/**
 * 値が「有効な JSON オブジェクト」であるか（配列・null・プリミティブでない）を判定する。
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * confidence が [0.0, 1.0] の範囲内の有限数であるかを判定する（Req 5.6 / 5.7）。
 * 欠落（number でない）・NaN・範囲外はすべて false。
 */
function isValidConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.0 &&
    value <= 1.0
  );
}

/**
 * Bedrock 生応答（JSON パース済み unknown）と、対象 Election の Candidate_List から、
 * 正規化済みの `AnalysisOutcome` を返す純粋関数（Req 5.2〜5.8, 10.5, 10.7, Property 4〜7）。
 *
 * 副作用を持たず、入力を変更しない。Bedrock 呼び出し（副作用）とは分離しているため、
 * property test で正規化ロジックを直接検証できる。
 *
 * 正規化ルールの適用順序（この順序を厳守する）:
 *   1. 候補者リスト検証: 対象 Election の Candidate_List が空 / id 重複（3.4 の
 *      validateCandidateList）なら LIST_INVALID（Req 10.7）。Bedrock を呼ぶ前提だが
 *      正規化側でも防御する。
 *   2. JSON 妥当性: raw が有効な JSON オブジェクトでない、または
 *      recognized_text / matched_candidate / is_valid / confidence / reason の
 *      いずれか必須フィールドが欠落 → ANALYSIS_FAILED（Req 5.8, Property 7）。
 *   3. confidence 正規化 / 範囲外: confidence が欠落 or <0.0 or >1.0 なら
 *      confidence=0.0, is_valid=false に固定する（Req 5.6 / 5.7, Property 6）。
 *   4. 低信頼度の判読不能化: 正規化後 confidence < 0.5 なら判読不能とみなし
 *      recognized_text=null, matched_candidate=null, is_valid=false（Req 5.5, Property 5）。
 *   5. 候補者所属判定: confidence >= 0.5 の場合、matched_candidate が対象 Election の
 *      Candidate_List の name 集合に含まれるなら is_valid=true、含まれない / null なら
 *      is_valid=false かつ matched_candidate=null（Req 5.3 / 5.4, Property 4）。
 *
 * 正規化後 confidence は常に [0.0, 1.0] に収まる（Property 6）。
 */
export function normalizeAnalysis(
  raw: unknown,
  candidates: readonly Candidate[],
): AnalysisOutcome {
  // 1. 候補者リスト検証（Req 10.7）。Bedrock を呼ぶ前提だが正規化側でも防御する。
  //    空 / id 重複 / name 不正なら当該 Election の判定を行わず LIST_INVALID を返す。
  const listValidation = validateCandidateList(candidates);
  if (!listValidation.ok) {
    return {
      ok: false,
      code: "LIST_INVALID",
      message: listValidation.message,
    };
  }

  // 2. JSON 妥当性（Req 5.8, Property 7）。有効な JSON オブジェクトでなければ解析失敗。
  if (!isJsonObject(raw)) {
    return ANALYSIS_FAILED(
      "Bedrock 応答が有効な JSON オブジェクトではありません",
    );
  }

  // 必須フィールドの存在確認（欠落は ANALYSIS_FAILED, Req 5.8）。
  // - recognized_text: string | null
  // - matched_candidate: string | null
  // - is_valid: boolean
  // - confidence: number（範囲は後段で正規化）
  // - reason: string
  if (
    !("recognized_text" in raw) ||
    !("matched_candidate" in raw) ||
    !("is_valid" in raw) ||
    !("confidence" in raw) ||
    !("reason" in raw)
  ) {
    return ANALYSIS_FAILED("Bedrock 応答に必須フィールドが欠落しています");
  }

  const recognizedTextRaw = raw.recognized_text;
  const matchedCandidateRaw = raw.matched_candidate;
  const isValidRaw = raw.is_valid;
  const confidenceRaw = raw.confidence;
  const reasonRaw = raw.reason;

  // 各必須フィールドの型を検証する（型不一致は解析失敗, Req 5.8）。
  // recognized_text / matched_candidate は string | null を許容する。
  if (recognizedTextRaw !== null && typeof recognizedTextRaw !== "string") {
    return ANALYSIS_FAILED("recognized_text の型が不正です");
  }
  if (matchedCandidateRaw !== null && typeof matchedCandidateRaw !== "string") {
    return ANALYSIS_FAILED("matched_candidate の型が不正です");
  }
  if (typeof isValidRaw !== "boolean") {
    return ANALYSIS_FAILED("is_valid の型が不正です");
  }
  if (typeof reasonRaw !== "string") {
    return ANALYSIS_FAILED("reason の型が不正です");
  }

  const recognizedText: string | null = recognizedTextRaw;
  let matchedCandidate: string | null = matchedCandidateRaw;
  const reason: string = reasonRaw;

  // 3. confidence の正規化 / 範囲外（Req 5.6 / 5.7, Property 6）。
  //    欠落・非数・NaN・範囲外はすべて confidence=0.0, is_valid=false に固定する。
  let confidence: number;
  let isValid: boolean;
  if (isValidConfidence(confidenceRaw)) {
    confidence = confidenceRaw;
    isValid = isValidRaw;
  } else {
    confidence = 0.0;
    isValid = false;
  }

  // 4. 低信頼度の判読不能化（Req 5.5, Property 5）。
  //    正規化後 confidence < 0.5 は判読不能とみなし、テキスト・候補者を null、無効票にする。
  if (confidence < CONFIDENCE_THRESHOLD) {
    return {
      ok: true,
      result: {
        recognized_text: null,
        matched_candidate: null,
        is_valid: false,
        confidence,
        reason,
      },
    };
  }

  // 5. 候補者所属判定（Req 5.3 / 5.4, Property 4）。confidence >= 0.5 のケース。
  //    matched_candidate が対象 Election の Candidate_List の name 集合に含まれるなら
  //    is_valid=true、含まれない / null なら is_valid=false かつ matched_candidate=null。
  const candidateNames = new Set(candidates.map((c) => c.name));
  const isMatched =
    matchedCandidate !== null && candidateNames.has(matchedCandidate);

  if (isMatched) {
    isValid = true;
  } else {
    isValid = false;
    matchedCandidate = null;
  }

  return {
    ok: true,
    result: {
      recognized_text: recognizedText,
      matched_candidate: matchedCandidate,
      is_valid: isValid,
      confidence,
      reason,
    },
  };
}

/**
 * 検証済み画像と、対象 Election の Candidate_List を Bedrock へ渡し、正規化済みの
 * 解析結果を返す（Req 5.1 / 5.2 / 5.9, 10.5, 10.7）。design.md の Analyzer_Module に
 * 定義された analyze のシグネチャに沿う。
 *
 * 副作用配線の責務:
 *   1. 候補者リストが不正（空 / id 重複 / name 不正）なら Bedrock を呼ばず LIST_INVALID
 *      を返す（Req 10.7, Property 16）。無駄な LLM 呼び出しとコストを避ける事前防御。
 *   2. Bedrock マルチモーダル LLM を Converse API で呼び出す。システムプロンプトに
 *      Candidate_List を埋め込み JSON のみの応答を強制し、画像（Buffer）を渡す（Req 5.1 / 5.2）。
 *      30 秒タイムアウト・最大 2 回リトライ・全滅で失敗（Req 5.9）は bedrock.ts が担う。
 *   3. Bedrock 呼び出しが失敗（タイムアウト / エラー / リトライ全滅 / JSON 不正）なら
 *      ANALYSIS_FAILED を返す（Req 5.9）。
 *   4. 取得した生応答を normalizeAnalysis に渡して正規化し、最終判定を得る。LLM 応答を
 *      そのまま信用せず、候補者リストへの所属チェックはコード側が権威を持つ（多層防御）。
 *
 * @param image      検証済みの手書き画像（PNG バイト列）
 * @param candidates 対象 Election の Candidate_List（Receiver が election_id から特定）
 * @param config     モデル ID・タイムアウト・リトライ回数（省略時は env から解決）
 * @param client     Bedrock Runtime クライアント（省略時は既定を生成。テストで差し替え可能）
 */
export async function analyze(
  image: Buffer,
  candidates: readonly Candidate[],
  config: AnalyzerConfig = resolveAnalyzerConfig(),
  client: BedrockRuntimeClient = createBedrockClient(),
): Promise<AnalysisOutcome> {
  // 1. 候補者リスト事前検証（Req 10.7）。不正なら Bedrock を呼ばず LIST_INVALID。
  const listValidation = validateCandidateList(candidates);
  if (!listValidation.ok) {
    return {
      ok: false,
      code: "LIST_INVALID",
      message: listValidation.message,
    };
  }

  // 2. Bedrock マルチモーダル呼び出し（Converse API、タイムアウト / リトライ付き）。
  const invocation = await invokeBedrock(client, image, candidates, config);

  // 3. 呼び出し失敗（タイムアウト / エラー / リトライ全滅 / JSON 不正）は解析失敗（Req 5.9）。
  //    詳細な失敗理由は invokeBedrock 内で console.error 済み。ここでは解析失敗への
  //    マッピングを記録する（切り分け用）。
  if (!invocation.ok) {
    console.error(
      `[analyzer] 解析失敗として処理します (ANALYSIS_FAILED): ${invocation.message}`,
    );
    return ANALYSIS_FAILED(invocation.message);
  }

  // 4. 生応答を正規化し、コード側の所属チェックを権威とした最終判定を返す。
  return normalizeAnalysis(invocation.raw, candidates);
}
