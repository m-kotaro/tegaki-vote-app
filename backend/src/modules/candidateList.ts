// backend/src/modules/candidateList.ts
// 候補者リスト（Candidate_List）妥当性検証の純粋関数。
// 副作用を持たず、Analyzer（normalizeAnalysis / 3.6）から独立して呼び出せる。
// 検証ルールは design.md Property 16、Requirements 10.4 / 10.7 に従う。

import type { Candidate } from "@tegaki/shared";

/** name の最小・最大長（Req 10.4: 1 文字以上 50 文字以下の非空文字列） */
const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 50;

/**
 * 候補者リスト妥当性検証の結果。
 * - `ok: true`  … リストは妥当（空でない / id 重複なし / 全 name が 1〜50 文字の非空）
 * - `ok: false` … リストは不正（code は常に "LIST_INVALID"、message に理由）
 */
export type CandidateListValidation =
  | { ok: true }
  | { ok: false; code: "LIST_INVALID"; message: string };

/**
 * Candidate_List の妥当性を検証する純粋関数（Req 10.4 / 10.7, Property 16）。
 *
 * 不正と判定する条件（いずれかに該当すれば LIST_INVALID）:
 * - リストが空である
 * - 重複した id を含む
 * - いずれかの name が空、または 50 文字を超える
 *
 * 上記いずれにも該当しない（空でない / id 重複なし / 全 name が 1〜50 文字の非空）
 * 場合にのみ妥当（ok: true）と判定する。
 *
 * 副作用を持たず、入力を変更しない。Analyzer は LIST_INVALID の場合に
 * 当該 Election の有効票判定を行わず Bedrock を呼び出さない（Property 16）。
 */
export function validateCandidateList(
  candidates: readonly Candidate[],
): CandidateListValidation {
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "LIST_INVALID",
      message: "候補者リストが空です。",
    };
  }

  const seenIds = new Set<string>();
  for (const candidate of candidates) {
    if (seenIds.has(candidate.id)) {
      return {
        ok: false,
        code: "LIST_INVALID",
        message: `候補者 id が重複しています: "${candidate.id}"。`,
      };
    }
    seenIds.add(candidate.id);
  }

  for (const candidate of candidates) {
    const nameLength = candidate.name.length;
    if (nameLength < NAME_MIN_LENGTH || nameLength > NAME_MAX_LENGTH) {
      return {
        ok: false,
        code: "LIST_INVALID",
        message: `候補者 name は 1〜50 文字の非空文字列である必要があります（id: "${candidate.id}"）。`,
      };
    }
  }

  return { ok: true };
}
