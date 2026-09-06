// frontend/src/logic/tally.ts — フロント側の開票集計（Req 9.3〜9.5, Property 14 / 15）。
//
// Backend は集計せず票レコード一覧（VoteRecordSummary[]）を返すのみで、集計はフロントが行う
// （design.md Components / Frontend, API 契約）。tally は副作用を持たない純粋関数。

import type {
  VoteRecordSummary,
  ElectionResults,
  CandidateTally,
} from "@tegaki/shared";

/**
 * 票レコード一覧を集計する純粋関数（Req 9.3〜9.5, Property 14 / 15）。Backend では実行しない。
 *
 * 集計ルール:
 * - total = valid + invalid（Req 9.3）
 * - valid   = is_valid=true の件数
 * - invalid = is_valid=false の件数
 * - is_valid=true を matched_candidate ごとに集計し、得票数（count）の降順で返す（Req 9.4）
 * - is_valid=false は得票集計から除外し invalid にのみ計上する（Req 9.5）
 * - 票が空の場合は total=0, valid=0, invalid=0, tally=[]
 *
 * 並び順の決定性: count 降順を第一キーとし、count 同数のときは candidate 名の昇順を第二キーとして
 * ソートを安定・決定的にする。
 *
 * @param votes      Backend が返した票レコード一覧
 * @param electionId 集計対象の election_id（表示用ラベル）
 */
export function tally(
  votes: readonly VoteRecordSummary[],
  electionId: string,
): ElectionResults {
  let valid = 0;
  let invalid = 0;
  const counts = new Map<string, number>();

  for (const vote of votes) {
    if (vote.is_valid) {
      valid += 1;
      // 有効票のみ候補者ごとに集計する（Req 9.4）。
      // is_valid=true の投票の matched_candidate は候補者名を持つ想定だが、
      // 万一 null の場合は集計キーにできないためスキップする（valid には計上済み）。
      const candidate = vote.matched_candidate;
      if (candidate !== null) {
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
    } else {
      // 無効票は得票集計から除外し invalid にのみ計上する（Req 9.5）。
      invalid += 1;
    }
  }

  const tallyList: CandidateTally[] = Array.from(counts, ([candidate, count]) => ({
    candidate,
    count,
  })).sort((a, b) => {
    // 第一キー: count 降順（非増加順）（Req 9.4）
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    // 第二キー: candidate 名の昇順（同数時の決定的な並び順）
    return a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0;
  });

  return {
    election_id: electionId,
    total: valid + invalid,
    valid,
    invalid,
    tally: tallyList,
  };
}
