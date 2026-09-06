// frontend/src/mocks/handlers.ts
// MSW モックハンドラ。backend 未起動でも frontend を単体で動かせるよう、
// POST /votes と GET /elections/{id}/results の代表的な応答を返す。
// backend のソースは import せず、@tegaki/shared の契約型と frontend 専用の config のみを参照する（Requirement 11.2）。
// ここで返すのは backend と同一の「生のレスポンス契約」であり、集計・表示整形は UI 側が行う（Requirement 11.4）。

import { http, HttpResponse } from "msw";
import type {
  VoteRequest,
  VoteResult,
  ElectionResultsResponse,
  ErrorResponse,
} from "@tegaki/shared";
function errorBody(
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse {
  return { error: { code, message } };
}

function isVoteRequest(body: unknown): body is VoteRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.image !== "string" || typeof b.election_id !== "string") {
    return false;
  }
  // candidates は各要素が id・name を持つ配列であること（Req 4.7）。
  if (!Array.isArray(b.candidates)) return false;
  return b.candidates.every((c) => {
    if (typeof c !== "object" || c === null) return false;
    const cand = c as Record<string, unknown>;
    return typeof cand.id === "string" && typeof cand.name === "string";
  });
}

// election_id ごとの票レコード一覧モック（デモ用の固定シード）。集計はフロントが行う。
const RESULTS_FIXTURES: Record<string, ElectionResultsResponse> = {
  "round-1": {
    election_id: "round-1",
    votes: [
      { vote_id: "seed-1", matched_candidate: "まるまる", is_valid: true },
      { vote_id: "seed-2", matched_candidate: "まるまる", is_valid: true },
      { vote_id: "seed-3", matched_candidate: "まるまる", is_valid: true },
      { vote_id: "seed-4", matched_candidate: "バツバツ", is_valid: true },
      { vote_id: "seed-5", matched_candidate: "三角三角", is_valid: true },
      { vote_id: "seed-6", matched_candidate: null, is_valid: false },
      { vote_id: "seed-7", matched_candidate: null, is_valid: false },
    ],
  },
};

export const handlers = [
  // POST /votes — 手書き画像と candidates を受け取り、判定結果（VoteResult）を返す。
  http.post("*/votes", async ({ request }) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return HttpResponse.json(
        errorBody("VALIDATION_ERROR", "リクエスト body が不正です"),
        { status: 400 },
      );
    }

    if (!isVoteRequest(body) || body.image.length === 0) {
      return HttpResponse.json(
        errorBody(
          "VALIDATION_ERROR",
          "image・election_id・candidates は必須です",
        ),
        { status: 400 },
      );
    }

    // Backend は開票回定義を持たず、受け取った candidates を判定基準に用いる（Req 5.1）。
    // 受け取った candidates が空なら構成不正として LIST_INVALID（Req 5.2）。
    if (body.candidates.length === 0) {
      return HttpResponse.json(
        errorBody("LIST_INVALID", "候補者リストが空です"),
        { status: 400 },
      );
    }

    // デモ用: 先頭候補に一致した有効票を返す。
    const firstCandidate = body.candidates[0]?.name ?? null;
    const isValid = firstCandidate !== null;
    const result: VoteResult = {
      vote_id: crypto.randomUUID(),
      recognized_text: firstCandidate ?? "（判読不能）",
      matched_candidate: isValid ? firstCandidate : null,
      is_valid: isValid,
      confidence: isValid ? 0.92 : 0.4,
      reason: isValid
        ? `候補者リストの『${firstCandidate}』と一致（モック応答）`
        : "候補者が未定義のため無効票（モック応答）",
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };

    return HttpResponse.json(result, { status: 200 });
  }),

  // GET /elections/{election_id}/results — 票レコード一覧を返す（集計はフロント）。
  // Backend は開票回定義を持たないため未知 election_id でも照合せず、
  // 該当レコードがなければ空配列を返す（Req 9.2）。
  http.get("*/elections/:electionId/results", ({ params }) => {
    const electionId = String(params.electionId);
    const fixture: ElectionResultsResponse = RESULTS_FIXTURES[electionId] ?? {
      election_id: electionId,
      votes: [],
    };

    return HttpResponse.json(fixture, { status: 200 });
  }),
];
