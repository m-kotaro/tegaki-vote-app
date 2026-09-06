// backend/src/modules/receiver.ts — Receiver_Module（入力検証）
//
// Requirement 4 全体を担う、副作用を持たない純粋な検証関数を提供する。
// design.md「Components and Interfaces / Receiver_Module」に厳密に従う。
//
// Backend は開票回・候補者の定義を持たない（Req 10.2）。election_id は保存用ラベルとして
// 非空チェックのみ行い、開票回定義との照合（未知 election_id の NOT_FOUND 拒否）は行わない
// （Req 4.6）。判定基準となる candidates はリクエストで受け取り、形式検証（配列であり各要素が
// id・name を持つ）のみをここで行う。構成的妥当性（空 / id 重複 / name 長）は Analyzer が担う。

import type { Candidate } from "@tegaki/shared";

/**
 * 検証結果。
 * - ok: true            すべての検証を通過。復号済み画像 Buffer・electionId・受け取った candidates を返す（Req 4.2）
 * - VALIDATION_ERROR    入力不正（Req 4.3 / 4.4 / 4.5 / 4.7 / 4.8 / 4.9）→ 400 相当
 */
export type ValidationResult =
  | { ok: true; image: Buffer; electionId: string; candidates: Candidate[] }
  | { ok: false; code: "VALIDATION_ERROR"; message: string };

/** 復号後の画像サイズ上限（5 MB, Req 4.8）。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** PNG シグネチャ（先頭 8 バイトのマジックナンバー）。 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * base64 文字列らしさを厳密に判定するための正規表現。
 * data URL プレフィックスは事前に除去してから適用する。
 * 空文字・不正文字を含む場合は不一致となる。
 */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** `data:image/png;base64,....` 形式の data URL プレフィックス。 */
const DATA_URL_PREFIX_RE = /^data:image\/png;base64,/i;

const VALIDATION_ERROR = (message: string): ValidationResult => ({
  ok: false,
  code: "VALIDATION_ERROR",
  message,
});

/**
 * base64 エンコードされた PNG 画像文字列を Buffer に復号する。
 * data URL 形式（`data:image/png;base64,...`）と生の base64 の両方を受け付ける。
 * 復号できない、または PNG マジックナンバーに一致しない場合は null を返す（Req 4.4）。
 */
function decodePngBase64(image: string): Buffer | null {
  // data URL プレフィックスがあれば除去する。
  const stripped = image.replace(DATA_URL_PREFIX_RE, "").trim();

  if (stripped.length === 0) {
    return null;
  }

  // 厳密な base64 文字列かを確認する（不正文字を含む場合は復号不可扱い）。
  if (!BASE64_RE.test(stripped)) {
    return null;
  }

  // base64 の桁数は 4 の倍数でなければならない。
  if (stripped.length % 4 !== 0) {
    return null;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(stripped, "base64");
  } catch {
    return null;
  }

  // 復号結果が空、または PNG マジックナンバーに一致しない場合は不正。
  if (buffer.length < PNG_MAGIC.length) {
    return null;
  }
  if (!buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return null;
  }

  return buffer;
}

/**
 * candidates フィールドの形式検証（Req 4.7）。
 * 配列であり、各要素が string の id と string の name を持つことのみを確認する。
 * 妥当なら正規化した Candidate[] を、不正なら null を返す。
 * 構成的妥当性（空 / id 重複 / name 長）はここでは検証せず Analyzer が担う（Req 5.2）。
 */
function parseCandidates(value: unknown): Candidate[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const candidates: Candidate[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.name !== "string") {
      return null;
    }
    candidates.push({ id: c.id, name: c.name });
  }
  return candidates;
}

/**
 * 生のリクエストボディ文字列を検証する（Req 4.2〜4.9）。副作用を持たない純粋関数。
 *
 * 検証順序:
 * 1. JSON として解釈できない / 空          → VALIDATION_ERROR（Req 4.9）
 * 2. image フィールド欠落 / 空             → VALIDATION_ERROR（Req 4.3）
 * 3. election_id フィールド欠落 / 空       → VALIDATION_ERROR（Req 4.5）
 * 4. candidates 欠落 / 非配列 / 要素が id・name を持たない → VALIDATION_ERROR（Req 4.7）
 * 5. image が base64 PNG として復号不可     → VALIDATION_ERROR（Req 4.4）
 * 6. 復号後サイズ > 5MB                     → VALIDATION_ERROR（Req 4.8）
 * すべて通過したら復号済み画像 Buffer・electionId・受け取った candidates を返す（Req 4.2）。
 *
 * election_id は保存用ラベルとして非空チェックのみ行い、開票回定義との照合は行わない（Req 4.6）。
 * Backend は Elections を保持しないため、未知 election_id の NOT_FOUND 検証は存在しない。
 * candidates の構成的妥当性（空 / id 重複 / name 長）は判定前段の Analyzer が検証する（Req 5.2）。
 */
export function validateVoteRequest(rawBody: string | null): ValidationResult {
  // 1. リクエストボディが空 / null（Req 4.9）
  if (rawBody === null || rawBody.trim().length === 0) {
    return VALIDATION_ERROR("リクエストボディが空です");
  }

  // 1. JSON として解釈できない（Req 4.9）
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return VALIDATION_ERROR("リクエストボディが有効な JSON ではありません");
  }

  // JSON がオブジェクトでない（配列 / プリミティブ / null）場合も入力不正（Req 4.9）
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return VALIDATION_ERROR("リクエストボディが有効な JSON オブジェクトではありません");
  }

  const body = parsed as Record<string, unknown>;
  const { image, election_id: electionId, candidates: candidatesRaw } = body;

  // 2. image フィールド欠落 / 空 / 非文字列（Req 4.3）
  if (typeof image !== "string" || image.length === 0) {
    return VALIDATION_ERROR("image は必須です");
  }

  // 3. election_id フィールド欠落 / 空 / 非文字列（Req 4.5）
  if (typeof electionId !== "string" || electionId.length === 0) {
    return VALIDATION_ERROR("election_id は必須です");
  }

  // 4. candidates の形式検証（Req 4.7）。欠落・非配列・要素が id/name を持たないなら入力不正。
  const candidates = parseCandidates(candidatesRaw);
  if (candidates === null) {
    return VALIDATION_ERROR(
      "candidates は各要素が id・name を持つ配列である必要があります",
    );
  }

  // 5. image が base64 PNG として復号不可（Req 4.4）
  const decoded = decodePngBase64(image);
  if (decoded === null) {
    return VALIDATION_ERROR("image が base64 エンコードされた PNG 画像として復号できません");
  }

  // 6. 復号後サイズ > 5MB（Req 4.8）
  if (decoded.length > MAX_IMAGE_BYTES) {
    return VALIDATION_ERROR("画像サイズが上限（5MB）を超えています");
  }

  // すべて通過（Req 4.2）。election_id は照合せず保存ラベルとして受理する（Req 4.6）。
  return { ok: true, image: decoded, electionId, candidates };
}
