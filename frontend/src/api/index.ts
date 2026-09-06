// frontend/src/api/index.ts
// API クライアント層のエントリポイント。
// UI/状態遷移は VoteApi インターフェース越しにのみ backend と会話する（Requirement 11.2）。
// モック起動時（MSW）も HttpVoteApi のまま相対パスへ発行し、Service Worker が横取りする。

export type {
  VoteApi,
  ApiResult,
  ApiSuccess,
  ApiFailure,
  ApiFailureKind,
  ApiErrorCode,
  ApiCallOptions,
} from "./types.js";

export { HttpVoteApi } from "./httpVoteApi.js";
export type { HttpVoteApiConfig } from "./httpVoteApi.js";

import { HttpVoteApi } from "./httpVoteApi.js";
import type { VoteApi } from "./types.js";

/**
 * 既定の VoteApi クライアントを生成する。
 * - VITE_API_BASE_URL が設定されていればそのオリジンへ、未設定なら同一オリジン相対パスへ発行する。
 * - MSW モック有効時は baseUrl を空にして相対パスへ流し、Service Worker で捕捉させる。
 */
export function createVoteApi(): VoteApi {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  return new HttpVoteApi({ baseUrl });
}
