// frontend/src/logic/invalidVotes.ts — フロント側の無効票抽出（Req 12.1, Property 18）。
//
// Backend は集計・無効票抽出を行わず票レコード一覧（VoteRecordSummary[]）を返すのみで、
// 無効票の抽出はフロントが行う（design.md Components / Frontend）。集計（tally）とは関心が
// 異なる（前者は件数・候補者別集計、後者は無効票の詳細抽出・並び）ため専用モジュールに分離する。
// selectInvalidVotes は副作用を持たない純粋関数。

import type { VoteRecordSummary } from "@tegaki/shared";

/**
 * 票レコード一覧から無効票（is_valid=false）のみを抽出する純粋関数（Req 12.1, Property 18）。
 * Backend では実行しない。
 *
 * 抽出・並びルール:
 * - is_valid=false の票のみを返し、is_valid=true の票は一切含めない。
 * - 並び順は決定的: created_at 昇順を第一キー、同時刻は vote_id 昇順を第二キーとする。
 * - 無効票が 1 件もない場合（全件 is_valid=true または空集合）は空配列を返す
 *   （呼び出し側 InvalidVotesPage が「無効票なし」を表示, Req 12.3）。
 * - 返した各レコードは入力の vote_id・recognized_text（判読不能時 null, Req 12.2）・reason・
 *   created_at を保持する。
 */
export function selectInvalidVotes(
  votes: readonly VoteRecordSummary[],
): VoteRecordSummary[] {
  return votes
    .filter((vote) => !vote.is_valid)
    .sort((a, b) => {
      // 第一キー: created_at 昇順。
      if (a.created_at < b.created_at) return -1;
      if (a.created_at > b.created_at) return 1;
      // 第二キー: 同時刻は vote_id 昇順（決定的な並び順）。
      if (a.vote_id < b.vote_id) return -1;
      if (a.vote_id > b.vote_id) return 1;
      return 0;
    });
}
