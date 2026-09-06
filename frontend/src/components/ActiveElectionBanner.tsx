// frontend/src/components/ActiveElectionBanner.tsx
// アクティブ開票回の固定表示（Requirement 2.1 / 2.2）。
//
// 投票者は開票回を選択しない。管理者が Elections_Config の activeElectionId で指定した
// アクティブ開票回を、フロントは getActiveElection() で確定した状態で固定表示する。
// 本コンポーネントは getActiveElection() が返す Election のタイトルと Candidate_List を
// 表示するのみで、選択 UI（select / onSelect）は持たない。
//
// activeElectionId が不整合な設定不正時の投票不可・受付停止フォールバックは App 側が担う
// （getActiveElection() の例外を try/catch し、本コンポーネントは描画しない）。

import type { Election } from "@tegaki/shared";

export interface ActiveElectionBannerProps {
  /**
   * 固定表示するアクティブ開票回。getActiveElection() の結果。
   * タイトルと Candidate_List を表示するのみで、選択 UI は持たない（Req 2.1 / 2.2）。
   */
  election: Election;
}

/**
 * アクティブ開票回のタイトルと Candidate_List を固定表示する（Req 2.1 / 2.2）。
 */
export function ActiveElectionBanner({
  election,
}: ActiveElectionBannerProps): React.JSX.Element {
  return (
    <section aria-label="開票回">
      <h2>開票回</h2>
      <div aria-label="現在の開票回">
        <h3>{election.title}</h3>
        {election.candidates.length === 0 ? (
          <p role="status">この開票回には候補者が登録されていません。</p>
        ) : (
          <ul aria-label="候補者リスト">
            {election.candidates.map((candidate) => (
              <li key={candidate.id}>{candidate.name}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
