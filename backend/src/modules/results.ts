// backend/src/modules/results.ts — Results 読み取りマッピング（Req 9）。
// Backend は集計しない。DynamoDB 読み取り（副作用）は handler 側で行い、読み取った
// VoteRecord 群を本モジュールの純粋関数で VoteRecordSummary[] へ写像して返すのみ。
// 集計（総数・有効/無効・候補者別得票）はフロント側の tally が担う（design.md Components / Frontend）。

import type { VoteRecord, VoteRecordSummary } from "@tegaki/shared";

/**
 * 読み取った VoteRecord 群を、GET results の応答契約である VoteRecordSummary[] に
 * 写像する純粋関数（Req 9.1）。集計は行わず、フロント集計（tally）に必要な
 * vote_id・matched_candidate・is_valid に加え、無効票の詳細表示
 * （Invalid_Votes_View, Req 12.1）に必要な recognized_text（判読不能時 null, Req 12.2）・
 * reason・created_at を抽出する。VoteRecord にはこれらの属性が既に存在するため
 * （Votes_Table スキーマ）、該当フィールドを抽出するのみで集計・抽出は行わない。
 *
 * 前提: `votes` は呼び出し側で単一の election_id にフィルタ済みであること。
 */
export function toVoteRecordSummaries(
  votes: readonly VoteRecord[],
): VoteRecordSummary[] {
  return votes.map((vote) => ({
    vote_id: vote.vote_id,
    matched_candidate: vote.matched_candidate,
    is_valid: vote.is_valid,
    recognized_text: vote.recognized_text,
    reason: vote.reason,
    created_at: vote.created_at,
  }));
}
