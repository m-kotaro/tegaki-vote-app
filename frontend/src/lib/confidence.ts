// frontend/src/lib/confidence.ts
// confidence（0.0〜1.0）の表示整形を担う純粋関数。
// backend から受信した VoteResult.confidence を UI 表示（0〜100%）へ変換する（Requirement 7.4 / 11.4）。
// 副作用・状態を持たない純粋関数として切り出し、ResultView（task 7.9）と
// その property test（Property 13, task 7.10）から import する。

/**
 * confidence（本来 [0.0, 1.0]）を 0〜100 の整数パーセントへ変換する。
 *
 * - Math.round(confidence * 100) で百分率へ変換する（Requirement 7.4）。
 * - 入力は [0, 1] を前提とするが、範囲外の値が来ても結果を 0〜100 にクランプする
 *   ことで、常に 0 以上 100 以下の整数を返す（Property 13: confidence のパーセント
 *   変換は 0〜100 に収まる）。
 * - NaN が渡された場合は 0 を返す（表示を破綻させないためのフォールバック）。
 *
 * @param confidence 判定信頼度。通常 0.0〜1.0。
 * @returns 0 以上 100 以下の整数パーセント。
 */
export function confidenceToPercent(confidence: number): number {
  if (Number.isNaN(confidence)) {
    return 0;
  }
  const percent = Math.round(confidence * 100);
  if (percent < 0) {
    return 0;
  }
  if (percent > 100) {
    return 100;
  }
  return percent;
}
