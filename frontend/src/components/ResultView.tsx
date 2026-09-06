// frontend/src/components/ResultView.tsx
// 投票完了表示コンポーネント。
//
// 判定詳細（有効/無効・matched_candidate・confidence・reason・recognized_text）は
// 投票者に見せず、「投票されました」の完了メッセージのみを表示する。
// backend の VoteResult は受け取るが、表示には用いない（受信＝投票登録成功の合図としてのみ扱う）。
// _Requirements: 7.2, 7.3, 7.4（簡素化: 判定内容は非表示とし投票完了のみ提示）_

import type { VoteResult } from "@tegaki/shared";

export interface ResultViewProps {
  /** backend から受信した投票結果（VoteResult）。判定詳細は表示しない。 */
  result: VoteResult;
}

/**
 * 投票が登録されたことを示す完了メッセージのみを表示する。
 * 有効/無効の判定や候補者名・信頼度などの詳細は提示しない。
 */
export function ResultView(_props: ResultViewProps): React.JSX.Element {
  return (
    <section aria-label="投票結果" data-testid="result-view">
      <p role="status" data-testid="result-verdict">
        <strong>投票されました</strong>
      </p>
    </section>
  );
}
