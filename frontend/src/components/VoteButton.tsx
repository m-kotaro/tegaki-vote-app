// frontend/src/components/VoteButton.tsx
// 投票送信ボタン（Requirement 3.1 / 3.5）。
//
// - 「投票」ボタンを表示する（Req 3.1）。
// - 送信中（counting 状態）は disabled により操作不可にする（Req 3.5）。ボタンの無効化・
//   再有効化の制御自体は投票送信の状態遷移（App, task 7.7）が disabled prop で行い、
//   このコンポーネントは表示と onClick 通知のみを担う。

export interface VoteButtonProps {
  /** クリック時に呼ばれる。App 側の投票送信ハンドラを渡す。 */
  onClick(): void;
  /**
   * 操作不可にするか。counting 状態（応答待機中）で true を渡し、
   * 「投票」ボタンを操作不可にする（Req 3.5）。
   */
  disabled: boolean;
  /**
   * 応答待機中（counting）か。true のときラベルを「投票中...」に切り替える。
   * 待機表示をボタン内に収めることで、下に別要素を出さずレイアウト高さを一定に保つ。
   */
  counting?: boolean;
}

/**
 * 投票を送信する「投票」ボタン。
 * disabled が true の間は押下できない（応答待機中の二重送信防止, Req 3.5）。
 * counting が true の間はラベルを「投票中...」にして、待機状態をボタン内で示す。
 */
export function VoteButton({
  onClick,
  disabled,
  counting = false,
}: VoteButtonProps): React.JSX.Element {
  const label = counting ? "投票中..." : "投票";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-busy={counting}
      data-testid="vote-button"
      style={{
        appearance: "none",
        border: "none",
        borderRadius: 8,
        padding: "0.75rem 2rem",
        // ラベルが「投票」「投票中...」で幅が変わってもガタつかないよう最小幅を確保する。
        minWidth: "10rem",
        fontSize: "1.1rem",
        fontWeight: 700,
        color: "#ffffff",
        background: disabled ? "#9bb0c9" : "#1d6fe0",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.15s ease",
      }}
    >
      {label}
    </button>
  );
}
