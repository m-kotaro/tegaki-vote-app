// frontend/src/components/ErrorNotice.tsx
// エラー種別を投票者向けメッセージへ変換して表示する ErrorNotice コンポーネント。
//
// backend の ErrorResponse.code（VALIDATION_ERROR / ANALYSIS_FAILED / STORAGE_FAILED /
// NOT_FOUND / LIST_INVALID）と、クライアント検証由来の事象（開票回未選択 / 未入力 /
// 通信タイムアウト / 通信失敗）を、単一の ErrorKind union として統一的に扱う。
// メッセージ変換は副作用のない純粋関数 errorKindToMessage(kind) に切り出し、
// 投票送信の状態遷移（task 7.7）から再利用できるよう export する。
//
// 「5 秒以内に表示・直前表示保持・ボタン再有効化」の振る舞いは状態遷移側（task 7.7）が
// 制御する。ここでは ErrorKind → メッセージ変換と、その表示のみを担う。
// _Requirements: 7.5, 8.4, 8.5, 11.5_

import type { ApiErrorCode, ApiFailure, ApiFailureKind } from "../api/types.js";

/**
 * 投票者へ提示するエラー種別。
 * backend 由来のエラーコード（ApiErrorCode）と、クライアント側で判定する事象を
 * 1 つの union として統一する。design の「フロント側のエラー種別表示」表に対応する。
 *
 * - "NOT_ACCEPTING":         受付停止中（activeElectionId が Elections に無い設定不正, Req 2.4）
 * - "INPUT_EMPTY":           候補者名が未入力（クライアント検証, Req 1.6 / 3.6）
 * - "VALIDATION_ERROR":      入力不正（backend 400, Req 4.x）
 * - "ANALYSIS_FAILED":       解析失敗（backend 502, Req 5.9 / 8.1）
 * - "STORAGE_FAILED":        保存失敗（backend 500, Req 6.7 / 8.2）
 * - "LIST_INVALID":          候補者リスト構成不正（backend 400, Req 5.2）
 * - "CONFIG_INVALID":        開票回設定が不正（フロントのビルド時検証専用, Req 10.7 / 10.8）。backend は返さない
 * - "TIMEOUT":               通信タイムアウト（35 秒無応答, Req 8.5）
 * - "NETWORK":               通信自体の失敗（オフライン等, Req 11.5）
 * - "MALFORMED":             応答が契約として解釈できない（Req 7.5 / 11.5）
 */
export type ErrorKind =
  | "NOT_ACCEPTING"
  | "INPUT_EMPTY"
  | "VALIDATION_ERROR"
  | "ANALYSIS_FAILED"
  | "STORAGE_FAILED"
  | "LIST_INVALID"
  | "CONFIG_INVALID"
  | "TIMEOUT"
  | "NETWORK"
  | "MALFORMED";

/**
 * ErrorKind を投票者向けの日本語メッセージへ変換する純粋関数。
 * design の Error Handling「フロント側のエラー種別表示」表に従う。
 * 状態遷移（task 7.7）から表示文言を決定するために import して使う。
 */
export function errorKindToMessage(kind: ErrorKind): string {
  switch (kind) {
    case "NOT_ACCEPTING":
      // activeElectionId が Elections に無い設定不正時の受付停止（Req 2.4）。
      return "現在、投票を受け付けていません";
    case "INPUT_EMPTY":
      return "候補者名を手書きしてください";
    case "VALIDATION_ERROR":
      return "送信内容に問題があります。もう一度手書きしてください";
    case "ANALYSIS_FAILED":
      return "解析に失敗しました。もう一度お試しください";
    case "STORAGE_FAILED":
      return "投票の保存に失敗しました。もう一度お試しください";
    case "LIST_INVALID":
      // 受け取った候補者リストの構成不正（Req 5.2）。投票者には入力不正相当として案内する。
      return "送信内容に問題があります。もう一度手書きしてください";
    case "CONFIG_INVALID":
      // 開票回設定の不正（Req 10.7 / 10.8）。フロントのビルド時検証専用で backend は返さない。
      // 万一 UI 種別として使われた場合の防御的な文言。
      return "現在ご利用いただけません。しばらくしてからお試しください";
    case "TIMEOUT":
      return "通信がタイムアウトしました";
    case "NETWORK":
      return "通信に失敗しました。もう一度お試しください";
    case "MALFORMED":
      return "結果を取得できませんでした。もう一度お試しください";
    default: {
      // 網羅性を型で保証する（新しい ErrorKind 追加時にコンパイルエラーで気付ける）。
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * backend 由来のエラーコード（ApiErrorCode）を ErrorKind へ対応付ける純粋関数。
 * ApiFailure（kind: "http"）から取り出した code を状態遷移側で変換する際に使う。
 */
export function apiErrorCodeToErrorKind(code: ApiErrorCode): ErrorKind {
  // ApiErrorCode の各値は ErrorKind にも同名で存在するため、そのまま流用できる。
  return code;
}

/**
 * API 呼び出しの失敗（ApiFailure）を ErrorKind へ変換する純粋関数。
 * - "http": backend 由来の code があればそれを、なければ VALIDATION_ERROR 相当として扱う。
 * - "timeout" / "network" / "malformed": クライアント側の失敗種別を対応する ErrorKind へ。
 * 状態遷移（task 7.7）が ApiResult の失敗を受けて表示メッセージを決めるために使う。
 */
export function apiFailureToErrorKind(failure: ApiFailure): ErrorKind {
  switch (failure.kind) {
    case "http":
      return failure.code
        ? apiErrorCodeToErrorKind(failure.code)
        : "VALIDATION_ERROR";
    case "timeout":
      return "TIMEOUT";
    case "network":
      return "NETWORK";
    case "malformed":
      return "MALFORMED";
    default: {
      const exhaustive: never = failure.kind satisfies ApiFailureKind;
      return exhaustive;
    }
  }
}

export interface ErrorNoticeProps {
  /**
   * 表示するエラー種別。null の場合はエラーなしとして何も表示しない。
   * 直前表示の保持・5 秒以内表示・ボタン再有効化は状態遷移側（task 7.7）が制御し、
   * ここは受け取った kind の表示のみを行う。
   */
  kind: ErrorKind | null;
}

/**
 * エラー種別を投票者向けメッセージに変換して表示するコンポーネント。
 * kind が null のときは何も描画しない（直前の結果表示などを覆い隠さない, Req 11.5）。
 */
export function ErrorNotice({ kind }: ErrorNoticeProps): React.JSX.Element | null {
  if (kind === null) {
    return null;
  }

  const message = errorKindToMessage(kind);

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-error-kind={kind}
      style={{
        border: "1px solid #d33",
        background: "#fdecea",
        color: "#a1160a",
        borderRadius: 6,
        padding: "0.75rem 1rem",
        margin: "0.75rem 0",
        fontSize: "0.95rem",
      }}
    >
      {message}
    </div>
  );
}
