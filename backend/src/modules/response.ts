// backend/src/modules/response.ts — 200 レスポンスビルダ（Req 7.1, Property 12）。
// 保存成功結果（VoteRecord）から POST /votes の 200 レスポンス契約を満たす
// VoteResult を構築する純粋関数を提供する。副作用を持たないため、
// design.md Property 12 を property-based testing で検証しやすい構造にしている。

import type { VoteRecord, VoteResult } from "@tegaki/shared";

/**
 * 保存成功結果（VoteRecord）から POST /votes の 200 レスポンス契約を満たす
 * VoteResult を構築する純粋関数（Req 7.1, Property 12）。
 *
 * VoteRecord は VoteResult を extends し、Votes_Table 保存専用の election_id と
 * image_key を追加した型である。レスポンスにはこれらの内部属性を含めず、
 * VoteResult の契約フィールドのみ（vote_id・recognized_text・matched_candidate・
 * is_valid・confidence・reason・created_at）を抽出して返す。
 *
 * confidence は Analyzer の正規化（normalizeAnalysis）で 0.0〜1.0 に収まっており、
 * is_valid は真偽値である。本関数は値を変換せず対応するフィールドをそのまま写すため、
 * これらの契約（Property 12）は入力 VoteRecord から保存される。
 *
 * @param record 保存まで成功した投票レコード（buildRecord の出力 / Votes_Table のレコード）
 * @returns POST /votes の 200 レスポンスボディとして返す VoteResult
 */
export function toVoteResult(record: VoteRecord): VoteResult {
  return {
    vote_id: record.vote_id,
    recognized_text: record.recognized_text,
    matched_candidate: record.matched_candidate,
    is_valid: record.is_valid,
    confidence: record.confidence,
    reason: record.reason,
    created_at: record.created_at,
  };
}
