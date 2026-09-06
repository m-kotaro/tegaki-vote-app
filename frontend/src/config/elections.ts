// frontend/src/config/elections.ts — フロント専用の設定ローダ・検証・純粋な参照ヘルパ
// （Req 10.1 / 10.3 / 10.7 / 10.8 / 10.9 / 11.3）
//
// 設計判断（design.md「リポジトリ構成」/「Data Models」参照）:
// 開票回設定データ（Elections_Config）とその設定ローダは **フロントエンド専用** として
// `frontend/src/config/` 配下に置く（shared は型・API 契約のみ）。Election 群と、現在
// 投票を受け付けている **アクティブ開票回を示す `activeElectionId`** はコードにハードコード
// せず、管理者が管理する設定ファイル `elections.config.json`（Elections_Config, Req 10.1 / 10.3）
// に定義する。本モジュールはその設定を JSON import で取り込み（取り込み自体はビルド /
// バンドルが解決する副作用のない操作）、形状・`election_id` 一意性・candidate の id 一意性 /
// name 長・`activeElectionId` と `elections` の整合を検証したうえで、型付き `Election[]`
// （`ELECTIONS`）と `activeElectionId`（`ACTIVE_ELECTION_ID`）として公開する。
// フロントのみが **ビルド時** にこれを参照する（Req 10.2）。Backend は Elections_Config を
// 参照せず、開票回・候補者の定義を一切持たない。

import type { Election } from "@tegaki/shared";
// tsconfig の resolveJsonModule により JSON を import で取り込む（Vite/ビルドが解決）
import electionsConfig from "./elections.config.json";

/** Candidate name の最小・最大長（Req 10.8: 1 文字以上 50 文字以下の非空文字列）。 */
const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 50;

/** Elections_Config スキーマ検証の結果 */
export type ConfigValidationResult =
  | { ok: true; activeElectionId: string; elections: Election[] }
  | { ok: false; code: "CONFIG_INVALID"; message: string };

function isCandidateShape(value: unknown): value is { id: string; name: string } {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.name === "string";
}

/**
 * Elections_Config（未検証の unknown）を検証し、妥当なら型付きの
 * { activeElectionId, elections } を返す純粋関数（フロント専用, Property 17）。
 * 検証項目（Req 10.3 / 10.5 / 10.6 / 10.7 / 10.8 / 10.9）:
 * - トップレベルがオブジェクトであること（オブジェクトでない/JSON 不正は取り込み時点で失敗）
 * - activeElectionId が非空文字列であること（Req 10.3）
 * - elections が配列であること
 * - 各 Election が election_id（非空文字列）・title（非空文字列）・candidates（配列）を持つ
 * - candidates 各要素が { id: string, name: string } の形であること
 * - election_id が elections 内で一意（重複は CONFIG_INVALID, Req 10.5）
 * - 各 Election の candidate id が一意であり name が 1〜50 文字の非空であること（Req 10.6 / 10.8）
 * - activeElectionId が elections 内のいずれかの election_id と一致（不一致は CONFIG_INVALID, Req 10.9）
 * この関数は副作用・I/O を持たない。
 */
export function validateElectionsConfig(raw: unknown): ConfigValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      code: "CONFIG_INVALID",
      message: "Elections_Config のトップレベルがオブジェクトではありません",
    };
  }

  const config = raw as Record<string, unknown>;

  const activeElectionId = config.activeElectionId;
  if (typeof activeElectionId !== "string" || activeElectionId.length === 0) {
    return {
      ok: false,
      code: "CONFIG_INVALID",
      message: "activeElectionId が非空文字列ではありません",
    };
  }

  const rawElections = config.elections;
  if (!Array.isArray(rawElections)) {
    return {
      ok: false,
      code: "CONFIG_INVALID",
      message: "elections が配列ではありません",
    };
  }

  const elections: Election[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < rawElections.length; i++) {
    const item = rawElections[i] as Record<string, unknown> | null;
    if (typeof item !== "object" || item === null) {
      return {
        ok: false,
        code: "CONFIG_INVALID",
        message: `elections[${i}] がオブジェクトではありません`,
      };
    }

    const electionId = item.election_id;
    if (typeof electionId !== "string" || electionId.length === 0) {
      return {
        ok: false,
        code: "CONFIG_INVALID",
        message: `elections[${i}] の election_id が非空文字列ではありません`,
      };
    }

    const title = item.title;
    if (typeof title !== "string" || title.length === 0) {
      return {
        ok: false,
        code: "CONFIG_INVALID",
        message: `elections[${i}] (election_id=${electionId}) の title が非空文字列ではありません`,
      };
    }

    const candidates = item.candidates;
    if (!Array.isArray(candidates)) {
      return {
        ok: false,
        code: "CONFIG_INVALID",
        message: `elections[${i}] (election_id=${electionId}) の candidates が配列ではありません`,
      };
    }
    if (!candidates.every(isCandidateShape)) {
      return {
        ok: false,
        code: "CONFIG_INVALID",
        message: `elections[${i}] (election_id=${electionId}) の candidates に { id: string, name: string } でない要素があります`,
      };
    }

    // 各 Election 内の candidate id 一意性・name 長（Req 10.6 / 10.8）。
    const seenCandidateIds = new Set<string>();
    for (const candidate of candidates) {
      if (seenCandidateIds.has(candidate.id)) {
        return {
          ok: false,
          code: "CONFIG_INVALID",
          message: `elections[${i}] (election_id=${electionId}) の candidate id が重複しています: ${candidate.id}`,
        };
      }
      seenCandidateIds.add(candidate.id);

      const nameLength = candidate.name.length;
      if (nameLength < NAME_MIN_LENGTH || nameLength > NAME_MAX_LENGTH) {
        return {
          ok: false,
          code: "CONFIG_INVALID",
          message: `elections[${i}] (election_id=${electionId}) の candidate name は 1〜50 文字の非空文字列である必要があります（id: ${candidate.id}）`,
        };
      }
    }

    if (seenIds.has(electionId)) {
      return {
        ok: false,
        code: "CONFIG_INVALID",
        message: `election_id が重複しています: ${electionId}`,
      };
    }
    seenIds.add(electionId);

    elections.push({
      election_id: electionId,
      title,
      candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  if (!seenIds.has(activeElectionId)) {
    return {
      ok: false,
      code: "CONFIG_INVALID",
      message: `activeElectionId '${activeElectionId}' が elections のいずれの election_id とも一致しません`,
    };
  }

  return { ok: true, activeElectionId, elections };
}

/**
 * 検証を実行し、妥当なら { activeElectionId, elections } を返す。不正なら設定不正エラーを投げる。
 * Frontend のビルド時（バンドル評価時）に呼ばれ、不正な設定
 * （activeElectionId 欠落・不整合、election_id 重複・必須フィールド欠落・JSON 形状不正）を
 * 検出する（Req 10.7 / 10.8）。
 */
export function parseElectionsConfig(raw: unknown): {
  activeElectionId: string;
  elections: Election[];
} {
  const result = validateElectionsConfig(raw);
  if (!result.ok) {
    throw new Error(`Elections_Config 設定不正: ${result.message}`);
  }
  return { activeElectionId: result.activeElectionId, elections: result.elections };
}

const parsed = parseElectionsConfig(electionsConfig); // ビルド時に評価・検証

/**
 * 設定ファイル由来の Elections。ビルド時（バンドル評価時）に検証済み。
 * フロントのみが参照する。Backend は Elections を持たない（Req 10.2）。
 */
export const ELECTIONS: readonly Election[] = parsed.elections;

/**
 * アクティブ開票回の election_id。管理者が Elections_Config で指定する（Req 10.3）。
 * ビルド時に elections 内の election_id を指すことが検証済み（Req 10.7 / 10.9）。
 */
export const ACTIVE_ELECTION_ID: string = parsed.activeElectionId;

/**
 * election_id から Election を引く純粋な参照ヘルパ（フロント専用）。
 * ELECTIONS 配列（設定ファイル由来）に対する副作用のない検索のみ。
 */
export function findElection(
  electionId: string,
  elections: readonly Election[] = ELECTIONS,
): Election | undefined {
  return elections.find((e) => e.election_id === electionId);
}

/**
 * アクティブ開票回の Election を引く純粋な参照ヘルパ（Req 2.1）。
 * ACTIVE_ELECTION_ID は検証済みで必ず elections 内に存在するため Election を返す。
 * フロントはこの Election のタイトルと Candidate_List を固定表示する。
 */
export function getActiveElection(
  elections: readonly Election[] = ELECTIONS,
  activeElectionId: string = ACTIVE_ELECTION_ID,
): Election {
  const election = findElection(activeElectionId, elections);
  if (!election) {
    // 検証済みのため通常は到達しない。防御的に設定不正を通知する。
    throw new Error(
      `Elections_Config 設定不正: activeElectionId '${activeElectionId}' が elections に存在しません`,
    );
  }
  return election;
}
