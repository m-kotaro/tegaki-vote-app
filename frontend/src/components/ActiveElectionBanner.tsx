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
    <section aria-label="議題">
      {/* 見出しは議題名（election.title）を直接表示する。文言は設定ファイル
          （elections.config.json の title）で可変。 */}
      <h2>{election.title}</h2>
      <div aria-label="現在の議題">
        {election.candidates.length === 0 ? (
          <p role="status">この議題には候補者が登録されていません。</p>
        ) : (
          <ul
            aria-label="候補者リスト"
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: "1rem",
              listStyle: "none",
              padding: 0,
              margin: "0.5rem 0",
            }}
          >
            {election.candidates.map((candidate) => (
              <li
                key={candidate.id}
                style={{
                  // 候補者名を縦書きで表示する。
                  writingMode: "vertical-rl",
                  textOrientation: "upright",
                  fontSize: "1.25rem",
                  lineHeight: 1.4,
                  letterSpacing: "0.1em",
                  // 黒枠で囲った短冊（縦長の札）風にする。
                  border: "2px solid #111111",
                  borderRadius: 4,
                  background: "#ffffff",
                  padding: "1rem 0.6rem",
                  minHeight: "8rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "2px 2px 0 rgba(17, 17, 17, 0.15)",
                }}
              >
                {candidate.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
