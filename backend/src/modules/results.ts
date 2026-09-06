// backend/src/modules/results.ts — Results 読み取りマッピング + presign 合成（Req 9）。
// Backend は集計しない。DynamoDB 読み取り（副作用）は handler 側で行い、読み取った
// VoteRecord 群を本モジュールの純粋関数で VoteRecordSummary[] へ写像して返す。
// 純粋写像は image_url を常に null 出力し、S3 への副作用（presign）は attachImageUrls に
// 切り出して 2 段構成（純粋写像 → presign 合成）とする（design.md「Results 読み取り」）。
// 集計（総数・有効/無効・候補者別得票）はフロント側の tally が担う。

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { VoteRecord, VoteRecordSummary } from "@tegaki/shared";

/**
 * 読み取った VoteRecord 群を、GET results の応答契約である VoteRecordSummary[] に
 * 写像する純粋関数（Req 9.1）。集計は行わず、フロント集計（tally）に必要な
 * vote_id・matched_candidate・is_valid に加え、無効票の詳細表示
 * （Invalid_Votes_View, Req 12.1）に必要な recognized_text（判読不能時 null, Req 12.2）・
 * reason・created_at を抽出する。VoteRecord にはこれらの属性が既に存在するため
 * （Votes_Table スキーマ）、該当フィールドを抽出するのみで集計・抽出は行わない。
 *
 * image_url は「写像の関心の外」であるため常に null を設定する（Property 19）。
 * pre-signed URL の生成は S3 への副作用を伴うため、後段の presign 合成レイヤ
 * attachImageUrls が上書きする（Req 9.6）。これにより本関数は入出力が純粋で
 * 決定的に保たれる。
 *
 * 前提: `votes` は呼び出し側で単一の election_id にフィルタ済みであること。
 */
export function toVoteRecordSummaries(
  votes: readonly VoteRecord[],
): VoteRecordSummary[] {
  return votes.map((vote) => ({
    vote_id: vote.vote_id,
    matched_candidate: vote.matched_candidate,
    is_valid: vote.is_valid,
    recognized_text: vote.recognized_text,
    reason: vote.reason,
    created_at: vote.created_at,
    // 純粋写像では常に null（presign は attachImageUrls が担う, Req 9.6）。
    image_url: null,
  }));
}

// ---------------------------------------------------------------------------
// presign 合成レイヤ（S3 への副作用）— Req 9.6 / 9.7
// design.md「Results 読み取り」: 純粋写像 → presign 合成、の 2 段構成。
// ---------------------------------------------------------------------------

/** pre-signed URL の既定有効期限（秒, Req 9.6）。 */
export const DEFAULT_PRESIGN_TTL_SECONDS = 3600;

/**
 * attachImageUrls が依存する presign 副作用の注入口。実運用では S3 クライアント + バケット名を、
 * テストではモックを差し替える（テスト容易性のため）。
 */
export interface PresignDeps {
  /** Image_Store（S3）の image_key に対する GetObject の pre-signed URL を 1 件生成する。失敗時は例外を投げる。 */
  presignGet(params: { key: string; expiresInSeconds: number }): Promise<string>;
}

/** モジュールスコープで使い回す既定の S3 クライアント（遅延生成）。 */
let defaultS3: S3Client | undefined;

function getDefaultS3(): S3Client {
  if (!defaultS3) {
    defaultS3 = new S3Client({});
  }
  return defaultS3;
}

/**
 * 環境変数 IMAGE_BUCKET から Image_Store のバケット名を解決する。
 * 未設定時は例外を投げる（設定漏れの早期検出）。public リポジトリのため実バケット名は
 * コードに書かず、必ず環境変数から解決する。
 */
export function imageBucketFromEnv(): string {
  const bucket = process.env.IMAGE_BUCKET;
  if (!bucket) {
    throw new Error("環境変数 IMAGE_BUCKET が未設定です");
  }
  return bucket;
}

/**
 * 実 AWS SDK（S3 + s3-request-presigner）を用いた既定の PresignDeps を生成する。
 * S3 クライアント・バケット名は引数で差し替え可能（テスト容易性のため）。
 *
 * @param options バケット名（省略時 env IMAGE_BUCKET）と S3 クライアント（省略時は既定を遅延生成）
 */
export function createPresignDeps(
  options: { bucket?: string; s3?: S3Client } = {},
): PresignDeps {
  const bucket = options.bucket ?? imageBucketFromEnv();
  const s3 = options.s3 ?? getDefaultS3();

  return {
    async presignGet({ key, expiresInSeconds }) {
      return getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    },
  };
}

/** attachImageUrls のオプション引数。DI と有効期限を差し替え可能にする。 */
export interface AttachImageUrlsOptions {
  /** presign 副作用の注入口。省略時は環境変数 + 既定 S3 クライアントから生成する。 */
  deps?: PresignDeps;
  /** pre-signed URL の有効期限（秒, 省略時 DEFAULT_PRESIGN_TTL_SECONDS = 3600, Req 9.6）。 */
  presignTtlSeconds?: number;
}

/**
 * 各票レコードに手書き画像の pre-signed URL を合成する副作用レイヤ（Req 9.6 / 9.7）。
 *
 * - 各 VoteRecordSummary の vote_id に対応する image_key（imageKeysByVoteId 経由で引く。
 *   image_key は VoteRecord 由来の S3 オブジェクトキー）から、Image_Store（非公開バケット）に
 *   対する有効期限付き pre-signed URL（GetObject, 既定 3600 秒）を生成し image_url に載せる。
 * - image_key が見つからないレコード、または presign に失敗したレコードは image_url を null の
 *   ままにする（Req 9.7）。失敗は try/catch で握りつぶしログ出力し、他レコードの処理は継続する。
 * - この関数のみが S3（presign）への副作用を持ち、純粋写像 toVoteRecordSummaries とは分離する。
 *
 * @param summaries         純粋写像済みの VoteRecordSummary[]（image_url は null）
 * @param imageKeysByVoteId vote_id -> image_key（VoteRecord 由来）
 * @param options           DI と有効期限の差し替え（テスト容易性のため）
 */
export async function attachImageUrls(
  summaries: readonly VoteRecordSummary[],
  imageKeysByVoteId: ReadonlyMap<string, string>,
  options: AttachImageUrlsOptions = {},
): Promise<VoteRecordSummary[]> {
  const ttl = options.presignTtlSeconds ?? DEFAULT_PRESIGN_TTL_SECONDS;
  // deps は presign が必要なレコードが 1 件でもある場合にのみ解決する。
  // （全レコードで image_key が無い場合に env 未設定でも落ちないようにする配慮）
  let deps = options.deps;

  return Promise.all(
    summaries.map(async (summary) => {
      const imageKey = imageKeysByVoteId.get(summary.vote_id);
      if (imageKey === undefined) {
        // image_key が引けないレコードは presign せず null のまま（Req 9.7）。
        return summary;
      }
      try {
        if (!deps) {
          deps = createPresignDeps();
        }
        const imageUrl = await deps.presignGet({
          key: imageKey,
          expiresInSeconds: ttl,
        });
        return { ...summary, image_url: imageUrl };
      } catch (error) {
        // presign 失敗レコードは image_url を null のままにし、他レコードは継続（Req 9.7）。
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(
          `pre-signed URL の生成に失敗しました (vote_id=${summary.vote_id}, image_key=${imageKey}): ${message}`,
        );
        return summary;
      }
    }),
  );
}
