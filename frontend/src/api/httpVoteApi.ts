// frontend/src/api/httpVoteApi.ts
// VoteApi の fetch 実装。HTTP のみで backend と通信する（Requirement 11.2）。
// AbortController によりタイムアウト/外部中断を差し込める構造にしておく
// （具体的な 35 秒 / 10 秒の配線は task 7.7 の状態遷移から timeoutMs で注入する）。

import type {
  VoteRequest,
  VoteResult,
  ElectionResultsResponse,
  ErrorResponse,
} from "@tegaki/shared";
import type {
  ApiCallOptions,
  ApiResult,
  ApiErrorCode,
  VoteApi,
} from "./types.js";

export interface HttpVoteApiConfig {
  /** API のベース URL。空文字なら同一オリジンの相対パスへ発行する（MSW モックもこれで捕捉できる）。 */
  baseUrl?: string;
  /** 既定のタイムアウト（ミリ秒）。呼び出し側が options.timeoutMs で上書きできる。 */
  defaultTimeoutMs?: number;
  /** テスト差し替え用の fetch。未指定時はグローバル fetch を使う。 */
  fetchImpl?: typeof fetch;
}

const KNOWN_ERROR_CODES: readonly ApiErrorCode[] = [
  "VALIDATION_ERROR",
  "ANALYSIS_FAILED",
  "STORAGE_FAILED",
  "LIST_INVALID",
];

function isErrorResponse(body: unknown): body is ErrorResponse {
  if (typeof body !== "object" || body === null) return false;
  const err = (body as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return (
    typeof code === "string" &&
    (KNOWN_ERROR_CODES as readonly string[]).includes(code)
  );
}

/** 複数の AbortSignal（外部 signal + タイムアウト）を 1 つに束ねる。 */
function combineSignals(signals: (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const active = signals.filter((s): s is AbortSignal => Boolean(s));

  const onAbort = (event: Event) => {
    const target = event.target as AbortSignal | null;
    controller.abort(target?.reason);
  };

  for (const s of active) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", onAbort);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const s of active) s.removeEventListener("abort", onAbort);
    },
  };
}

export class HttpVoteApi implements VoteApi {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpVoteApiConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "").replace(/\/+$/, "");
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 35_000;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async submitVote(
    request: VoteRequest,
    options?: ApiCallOptions,
  ): Promise<ApiResult<VoteResult>> {
    return this.request<VoteResult>(
      "POST",
      "/votes",
      request,
      options,
      isVoteResult,
    );
  }

  async getResults(
    electionId: string,
    options?: ApiCallOptions,
  ): Promise<ApiResult<ElectionResultsResponse>> {
    const path = `/elections/${encodeURIComponent(electionId)}/results`;
    return this.request<ElectionResultsResponse>(
      "GET",
      path,
      undefined,
      options,
      isElectionResultsResponse,
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    options: ApiCallOptions | undefined,
    isExpected: (data: unknown) => data is T,
  ): Promise<ApiResult<T>> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(new DOMException("timeout", "TimeoutError")),
      timeoutMs,
    );
    const combined = combineSignals([options?.signal, timeoutController.signal]);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers:
          body === undefined
            ? { Accept: "application/json" }
            : { "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined.signal,
      });

      const parsed = await this.parseJson(response);

      if (!response.ok) {
        if (isErrorResponse(parsed)) {
          return {
            ok: false,
            kind: "http",
            status: response.status,
            code: parsed.error.code,
            message: parsed.error.message,
          };
        }
        return {
          ok: false,
          kind: "http",
          status: response.status,
          message: `HTTP ${response.status}`,
        };
      }

      if (!isExpected(parsed)) {
        return {
          ok: false,
          kind: "malformed",
          message: "レスポンス body が期待する契約と一致しません",
        };
      }

      return { ok: true, data: parsed };
    } catch (error) {
      // タイムアウト起因の中断とネットワーク障害を区別する。
      if (timeoutController.signal.aborted) {
        return { ok: false, kind: "timeout", message: "通信がタイムアウトしました" };
      }
      if (options?.signal?.aborted) {
        return { ok: false, kind: "network", message: "通信が中断されました" };
      }
      return {
        ok: false,
        kind: "network",
        message: error instanceof Error ? error.message : "通信に失敗しました",
      };
    } finally {
      clearTimeout(timer);
      combined.cleanup();
    }
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}

// --- 最小限の構造ガード（生レスポンスの型を絞り込むためのみ。表示整形はしない） ---

function isVoteResult(data: unknown): data is VoteResult {
  if (typeof data !== "object" || data === null) return false;
  const v = data as Record<string, unknown>;
  return (
    typeof v.vote_id === "string" &&
    typeof v.is_valid === "boolean" &&
    typeof v.confidence === "number" &&
    typeof v.reason === "string" &&
    typeof v.created_at === "string" &&
    (v.recognized_text === null || typeof v.recognized_text === "string") &&
    (v.matched_candidate === null || typeof v.matched_candidate === "string")
  );
}

function isElectionResultsResponse(
  data: unknown,
): data is ElectionResultsResponse {
  if (typeof data !== "object" || data === null) return false;
  const r = data as Record<string, unknown>;
  if (typeof r.election_id !== "string" || !Array.isArray(r.votes)) {
    return false;
  }
  return r.votes.every((v) => {
    if (typeof v !== "object" || v === null) return false;
    const rec = v as Record<string, unknown>;
    return (
      typeof rec.vote_id === "string" &&
      typeof rec.is_valid === "boolean" &&
      (rec.matched_candidate === null ||
        typeof rec.matched_candidate === "string")
    );
  });
}
