// frontend/src/api/types.ts
// API クライアント層の契約型。
// backend のソースは一切 import せず、@tegaki/shared の型・契約のみを参照する（Requirement 11.2）。
// クライアントは backend から受信した「生のレスポンス型」（VoteResult / ElectionResults）を
// そのまま返す。confidence の 0〜100% 変換などの表示整形は UI 側（ResultView, task 7.9）が
// 行う方針とし、この層では整形しない（Requirement 11.4）。

import type {
  VoteRequest,
  VoteResult,
  ElectionResultsResponse,
  ErrorResponse,
} from "@tegaki/shared";

/** backend のエラーレスポンス body に含まれるエラーコード（@tegaki/shared 由来）。 */
export type ApiErrorCode = ErrorResponse["error"]["code"];

/**
 * クライアント側で追加で識別する失敗種別。
 * - "http": backend が非 200 の ErrorResponse を返した（code は backend 由来）。
 * - "timeout": 指定した時間内に応答が返らなかった（AbortController による中断）。
 * - "network": 通信自体が失敗した（オフライン等）。
 * - "malformed": 応答 body が期待する契約として解釈できなかった。
 */
export type ApiFailureKind = "http" | "timeout" | "network" | "malformed";

/** API 呼び出しの失敗を表す値。呼び出し側（状態遷移: task 7.7 / 7.11）が種別で分岐できる。 */
export interface ApiFailure {
  ok: false;
  kind: ApiFailureKind;
  /** HTTP ステータス（"http" の場合に設定）。 */
  status?: number;
  /** backend 由来のエラーコード（"http" かつ ErrorResponse を解釈できた場合に設定）。 */
  code?: ApiErrorCode;
  /** ログ・デバッグ向けのメッセージ。UI 表示メッセージは ErrorNotice (task 7.11) が別途決定する。 */
  message: string;
}

/** API 呼び出しの成功を表す値。data は backend から受信した生のレスポンス。 */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

/** 成功 / 失敗を判別できる API 呼び出しの戻り値。例外ではなく値で表現する。 */
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/** 1 回の呼び出し単位で差し込めるオプション。 */
export interface ApiCallOptions {
  /**
   * 呼び出しタイムアウト（ミリ秒）。未指定時は実装既定値を使う。
   * 呼び出し側は AbortController 相当の中断を signal でも渡せる。
   * design の Error Handling（フロント通信 35 秒 / 成功応答期限 10 秒）に沿った値を
   * task 7.7 の状態遷移側から注入できる。
   */
  timeoutMs?: number;
  /** 外部から中断するための AbortSignal。timeoutMs と併用可能。 */
  signal?: AbortSignal;
}

/**
 * 投票 API クライアントのインターフェース。
 * HttpVoteApi（fetch 実装）と、テスト/モック実装（MSW ハンドラや in-memory 実装）を
 * 差し替え可能にするための抽象。UI/状態遷移はこのインターフェースにのみ依存する。
 */
export interface VoteApi {
  /**
   * POST /votes。手書き画像と election_id を送信し、判定結果（生の VoteResult）を得る。
   * 成功/失敗は ApiResult で判別する（Requirement 3.x / 7.x の状態遷移で使用）。
   */
  submitVote(request: VoteRequest, options?: ApiCallOptions): Promise<ApiResult<VoteResult>>;

  /**
   * GET /elections/{election_id}/results。指定開票回の票レコード一覧（生の
   * ElectionResultsResponse）を得る。集計はフロント側の tally が行う。
   */
  getResults(
    electionId: string,
    options?: ApiCallOptions,
  ): Promise<ApiResult<ElectionResultsResponse>>;
}
