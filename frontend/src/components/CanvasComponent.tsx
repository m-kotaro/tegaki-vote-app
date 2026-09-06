// frontend/src/components/CanvasComponent.tsx
// 手書き入力領域（Canvas_Component）。タッチ操作・マウスドラッグの両方に
// Pointer Events で対応し、消去 / 空判定 / PNG 取得のハンドルを公開する。
// 設計の Components / Frontend（CanvasComponentProps / CanvasComponentHandle）に準拠。
// _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { clampLineWidth } from "../lib/clampLineWidth.js";

/** Canvas の最小サイズ（Req 1.1） */
export const MIN_CANVAS_WIDTH = 300;
export const MIN_CANVAS_HEIGHT = 200;

export interface CanvasComponentProps {
  /** 描画領域サイズ。最小 300x200 を保証する（Req 1.1） */
  width: number; // >= 300
  height: number; // >= 200
  /** 線幅。1〜10px の範囲にクランプする（Req 1.2 / 1.3） */
  lineWidth: number; // 1 <= lineWidth <= 10
}

export interface CanvasComponentHandle {
  /** 全消去して空状態に戻す（Req 1.4） */
  clear(): void;
  /** 手書き内容が存在するか（Req 1.6 / 3.6 の未入力判定に使用） */
  isEmpty(): boolean;
  /**
   * 描画内容を base64 PNG 文字列として返す（Req 1.5 / 3.2）。
   * 未入力時は null を返し、呼び出し側が未入力エラー通知を出す（Req 1.6）。
   */
  toPngBase64(): string | null;
}

/** width / height を最小サイズにクランプする（Req 1.1） */
function clampWidth(width: number): number {
  return Math.max(MIN_CANVAS_WIDTH, Math.floor(Number.isNaN(width) ? MIN_CANVAS_WIDTH : width));
}

function clampHeight(height: number): number {
  return Math.max(MIN_CANVAS_HEIGHT, Math.floor(Number.isNaN(height) ? MIN_CANVAS_HEIGHT : height));
}

export const CanvasComponent = forwardRef<CanvasComponentHandle, CanvasComponentProps>(
  function CanvasComponent({ width, height, lineWidth }, ref): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    // 手書き内容が 1 度でも描画されたか（Req 1.6 の未入力判定に使用）。
    const hasContentRef = useRef<boolean>(false);
    // 現在ポインタで描画中かどうか。
    const isDrawingRef = useRef<boolean>(false);
    // 直前のポイント座標。
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    const effectiveWidth = clampWidth(width);
    const effectiveHeight = clampHeight(height);
    const effectiveLineWidth = clampLineWidth(lineWidth);

    /** 2D コンテキストを取得し、共通の線スタイルを適用する。 */
    const getContext = useCallback((): CanvasRenderingContext2D | null => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        return null;
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return null;
      }
      ctx.lineWidth = effectiveLineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111111";
      return ctx;
    }, [effectiveLineWidth]);

    /** ポインタ座標を Canvas 内のローカル座標へ変換する。 */
    const toLocalPoint = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
        const canvas = canvasRef.current;
        if (canvas === null) {
          return { x: 0, y: 0 };
        }
        const rect = canvas.getBoundingClientRect();
        // 表示サイズと内部解像度が異なる場合に備えてスケール補正する。
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: (event.clientX - rect.left) * scaleX,
          y: (event.clientY - rect.top) * scaleY,
        };
      },
      [],
    );

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>): void => {
        event.preventDefault();
        const ctx = getContext();
        if (ctx === null) {
          return;
        }
        isDrawingRef.current = true;
        const point = toLocalPoint(event);
        lastPointRef.current = point;
        // 単発タップ（点）でも痕跡が残るよう即座に描画する。
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + 0.01, point.y + 0.01);
        ctx.stroke();
        hasContentRef.current = true;
        // ポインタキャプチャで Canvas 外へドラッグしても追従させる。
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // 一部環境でキャプチャ不可でも描画は継続する。
        }
      },
      [getContext, toLocalPoint],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>): void => {
        if (!isDrawingRef.current) {
          return;
        }
        event.preventDefault();
        const ctx = getContext();
        const last = lastPointRef.current;
        if (ctx === null || last === null) {
          return;
        }
        const point = toLocalPoint(event);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        lastPointRef.current = point;
        hasContentRef.current = true;
      },
      [getContext, toLocalPoint],
    );

    const endStroke = useCallback((): void => {
      isDrawingRef.current = false;
      lastPointRef.current = null;
    }, []);

    useImperativeHandle(
      ref,
      (): CanvasComponentHandle => ({
        clear(): void {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d") ?? null;
          if (canvas !== null && ctx !== null) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
          hasContentRef.current = false;
          isDrawingRef.current = false;
          lastPointRef.current = null;
        },
        isEmpty(): boolean {
          return !hasContentRef.current;
        },
        toPngBase64(): string | null {
          const canvas = canvasRef.current;
          if (canvas === null || !hasContentRef.current) {
            // 未入力時は画像を返さない（Req 1.6）。
            return null;
          }
          return canvas.toDataURL("image/png");
        },
      }),
      [],
    );

    // サイズ変更時に内部解像度を追従させる。Canvas は width/height 変更で
    // 内容がクリアされるため、空状態にリセットする。
    useEffect((): void => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        return;
      }
      canvas.width = effectiveWidth;
      canvas.height = effectiveHeight;
      hasContentRef.current = false;
      isDrawingRef.current = false;
      lastPointRef.current = null;
    }, [effectiveWidth, effectiveHeight]);

    return (
      <canvas
        ref={canvasRef}
        width={effectiveWidth}
        height={effectiveHeight}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
        style={{
          width: effectiveWidth,
          height: effectiveHeight,
          border: "1px solid #999",
          borderRadius: 4,
          background: "#ffffff",
          // スクロールやピンチ操作に描画を奪われないようにする（タッチ描画対応）。
          touchAction: "none",
          cursor: "crosshair",
        }}
      />
    );
  },
);
