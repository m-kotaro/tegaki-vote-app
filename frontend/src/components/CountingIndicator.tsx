// frontend/src/components/CountingIndicator.tsx
// 「開票中...」状態表示（Requirement 3.5 / 3.8）。
//
// 応答を待機している間（counting 状態）に表示し、200 応答受信 or 失敗表示への遷移で
// 非表示にする。表示/非表示の制御は投票送信の状態遷移（App, task 7.7）が行い、
// このコンポーネントは「開票中...」の見た目のみを担う。

export interface CountingIndicatorProps {
  /**
   * 表示するか。counting 状態のとき true を渡す。
   * false のときは何も描画しない。
   */
  active: boolean;
}

/**
 * 応答待機中に「開票中...」を示す状態表示（Req 3.5）。
 * active が false のときは何も表示しない。
 */
export function CountingIndicator({
  active,
}: CountingIndicatorProps): React.JSX.Element | null {
  if (!active) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="counting-indicator"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        margin: "0.75rem 0",
        color: "#1d6fe0",
        fontWeight: 600,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: "3px solid #cdd9ec",
          borderTopColor: "#1d6fe0",
          display: "inline-block",
          animation: "tegaki-spin 0.8s linear infinite",
        }}
      />
      <span>開票中...</span>
      {/* スピナー回転用のキーフレーム。単一コンポーネント内で完結させる。 */}
      <style>{`@keyframes tegaki-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
