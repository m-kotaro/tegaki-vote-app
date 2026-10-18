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
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * 既定の VoteApi クライアントを生成する。
 * - API のベース URL は実行時設定（runtimeConfig）から取得する。
 *   runtimeConfig は起動時に loadRuntimeConfig() が確定させ、ビルド時 VITE_API_BASE_URL >
 *   /config.json > 空文字（同一オリジン相対）の優先順位で解決する。
 * - MSW モック有効時は baseUrl が空文字になり、相対パスへ流して Service Worker で捕捉させる。
 */
export function createVoteApi(): VoteApi {
  const baseUrl = getRuntimeConfig().apiBaseUrl;
  return new HttpVoteApi({ baseUrl });
}
