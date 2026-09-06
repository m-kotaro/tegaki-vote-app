// frontend/src/lib/clampLineWidth.ts
// 線幅を 1〜10px の範囲にクランプする純粋関数。
// Property 17（線幅は 1〜10px にクランプされる, Req 1.2 / 1.3）のテスト（task 7.3）から
// import しやすいよう、副作用のない単独関数として切り出している。

/** 線幅の下限（px） */
export const MIN_LINE_WIDTH = 1;
/** 線幅の上限（px） */
export const MAX_LINE_WIDTH = 10;

/**
 * 要求された線幅を 1〜10px の範囲にクランプして返す純粋関数（Req 1.2 / 1.3）。
 * - NaN が渡された場合は下限（MIN_LINE_WIDTH）を返す。
 * - 範囲内の値はそのまま返す（小数も許容する）。
 */
export function clampLineWidth(lineWidth: number): number {
  if (Number.isNaN(lineWidth)) {
    return MIN_LINE_WIDTH;
  }
  return Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, lineWidth));
}
