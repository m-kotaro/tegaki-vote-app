// frontend/src/components/VoteAnimation.tsx
// 投票アニメーション（Requirement 3.4）。Framer Motion で投票用紙が投票箱へ
// 投函される様子を表現する。
//
// 送信後 3 秒以内に再生を開始する必要がある（Req 3.4）。本コンポーネントは active が
// true になった瞬間にマウントされ、アニメーションが即座に（同一フレーム / 遅延 0）開始する
// ため、状態遷移側（App, task 7.7）が送信と同時に active=true にすれば 3 秒以内の開始要件を
// 満たす。表示/非表示の制御は App が担い、ここは見た目とアニメーションのみを担う。

import { AnimatePresence, motion } from "framer-motion";

export interface VoteAnimationProps {
  /**
   * アニメーションを再生するか。投票送信と同時に true を渡すと、
   * 即座に投函アニメーションが開始する（Req 3.4）。
   */
  active: boolean;
}

/**
 * 投票用紙が投票箱へ投函されるアニメーション。
 * active が true の間だけ描画・再生する。遅延なしで開始するため送信からの
 * 再生開始は 3 秒以内を満たす（Req 3.4）。
 */
export function VoteAnimation({ active }: VoteAnimationProps): React.JSX.Element {
  return (
    <div
      data-testid="vote-animation"
      data-active={active ? "true" : "false"}
      aria-hidden="true"
      style={{
        position: "relative",
        height: active ? 140 : 0,
        overflow: "hidden",
        transition: "height 0.2s ease",
        margin: active ? "0.75rem 0" : 0,
      }}
    >
      <AnimatePresence>
        {active && (
          <motion.div
            key="ballot"
            // 投票箱（下部の固定要素）。
            style={{
              position: "absolute",
              left: "50%",
              bottom: 0,
              transform: "translateX(-50%)",
              width: 96,
              height: 64,
              borderRadius: 6,
              background: "#3a5a8c",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 8,
                left: "50%",
                transform: "translateX(-50%)",
                width: 56,
                height: 6,
                borderRadius: 3,
                background: "#1f3557",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {active && (
          <motion.div
            key="paper"
            // 投票用紙。上から投票箱の投入口へ落ちていく（遅延 0 で即開始）。
            initial={{ y: -110, opacity: 0, rotate: -6 }}
            animate={{ y: 8, opacity: [0, 1, 1, 0], rotate: [-6, 3, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut", delay: 0 }}
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              transform: "translateX(-50%)",
              width: 64,
              height: 84,
              borderRadius: 4,
              background: "#ffffff",
              border: "1px solid #c7c7c7",
              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
