// frontend/src/components/EraseAnimation.tsx
// 消去アニメーション（案B: 数回ゴシゴシして徐々に消える）。
//
// 消しゴムが canvas 上を数往復し、通過した帯を実際に削っていく。削りは親（VotePage）が
// 保持する CanvasComponent の eraseAt(x, y, radius, strength) を通じて行うため、本コンポーネントは
// requestAnimationFrame で消しゴムの位置を進め、各フレームでその中心座標を onErase で親へ通知する。
// destination-out 合成による半透明削りを重ねることで「ゴシゴシして徐々に消える」質感になる。

import { useEffect, useRef } from "react";

export interface EraseAnimationProps {
  /** 再生するか。true になった瞬間から往復削りを開始する。 */
  active: boolean;
  /** 重ねる canvas の幅（px, 内部解像度と一致）。 */
  width: number;
  /** 重ねる canvas の高さ（px, 内部解像度と一致）。 */
  height: number;
  /**
   * 各フレームで呼ばれ、消しゴム中心座標（canvas 内部解像度基準）を渡す。
   * 親はこの座標で CanvasComponent.eraseAt を呼び、実際に削る。
   */
  onErase(x: number, y: number, radius: number, strength: number): void;
  /** 往復削りが完了したときに呼ばれる。親はここで最終クリアと後始末を行う。 */
  onDone(): void;
}

/** 消しゴム本体のサイズ（px）。大きめにして太い帯で消す。 */
const ERASER_WIDTH = 144;
const ERASER_HEIGHT = 96;
/** 横断回数。縦を上→下へ片道で下ろす間にこの回数だけ横往復する。
    大きい消しゴムなので少ない往復でも全面をカバーでき、1 横断あたりの縦移動が大きくなる。 */
const SWEEPS = 3;
/** アニメーション全体の長さ（ミリ秒）。ゆったり動かす。 */
const DURATION_MS = 2200;
/** 1 フレームあたりの削り強度（0〜1）。1 = 通った帯をその場で完全に消す。 */
const ERASE_STRENGTH = 1;

/**
 * 消しゴムが往復しながら canvas を実際に削るアニメーション（案B）。
 * active が false のときは何も描画しない。
 */
export function EraseAnimation({
  active,
  width,
  height,
  onErase,
  onDone,
}: EraseAnimationProps): React.JSX.Element | null {
  const eraserRef = useRef<HTMLDivElement | null>(null);
  // 最新の onErase / onDone を参照するための ref（アニメループ内で古い関数を掴まないため）。
  const onEraseRef = useRef(onErase);
  const onDoneRef = useRef(onDone);
  onEraseRef.current = onErase;
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!active) {
      return;
    }

    const left = 6;
    const right = Math.max(left, width - ERASER_WIDTH - 6);
    const travel = right - left;
    // 削り半径。縦の隣接パスやフレーム間の移動を重なりでカバーするよう大きめに取る。
    // 消す面積を広く取り、消し残しなく全面が消えるようにする。
    const radius = ERASER_HEIGHT * 1.4;

    let rafId = 0;
    let start = 0;

    const step = (now: number): void => {
      if (start === 0) {
        start = now;
      }
      const elapsed = now - start;
      const t = Math.min(1, elapsed / DURATION_MS);

      // 横方向: 速く往復させる（SWEEPS 回の横断）。三角波 0→1→0。
      const phase = t * SWEEPS;
      const triX = Math.abs((phase % 2) - 1);
      const eraserX = left + travel * (1 - triX);

      // 縦方向: 進行に沿って上端→下端へ片道で下ろす。横の速い往復と組み合わせて
      // canvas 全体をラスター状に満遍なく舐め、消し残しなく全面が消える。
      const top = 6;
      const bottom = Math.max(top, height - ERASER_HEIGHT - 6);
      const eraserY = top + (bottom - top) * t;

      // 消しゴム本体（overlay）の位置を更新する。
      const el = eraserRef.current;
      if (el !== null) {
        el.style.transform = `translate(${eraserX}px, ${eraserY}px) rotate(${(triX - 0.5) * 10}deg)`;
      }

      // 削り中心は消しゴム本体の中心。
      const cx = eraserX + ERASER_WIDTH / 2;
      const cy = eraserY + ERASER_HEIGHT / 2;
      onEraseRef.current(cx, cy, radius, ERASE_STRENGTH);

      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        onDoneRef.current();
      }
    };

    rafId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [active, width, height]);

  if (!active) {
    return null;
  }

  return (
    <div
      data-testid="erase-animation"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <div
        ref={eraserRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: ERASER_WIDTH,
          height: ERASER_HEIGHT,
          borderRadius: 6,
          // 消しゴムらしい二層（本体 + 使用面）の見た目。
          background: "linear-gradient(#ffd5e0 0 58%, #f4a6bb 58% 100%)",
          border: "1px solid #c97b93",
          boxShadow: "0 3px 6px rgba(0,0,0,0.25)",
          willChange: "transform",
        }}
      />
    </div>
  );
}
