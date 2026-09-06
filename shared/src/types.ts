// shared/src/types.ts — 型定義・契約のみ（実行ロジックを含まない, Requirement 11.3）

/** 候補者。id と name を持つ（Req 10.4 / 10.7） */
export interface Candidate {
  id: string; // 一意（Req 10.4 / 10.7）
  name: string; // 1〜50 文字の非空文字列（Req 10.4）
}

/** 開票回（Election）。election_id・タイトル・Candidate_List を持つ（Req 10.1 / 10.3） */
export interface Election {
  election_id: string; // 一意（Req 10.3）例: "round-1"
  title: string; // 表示名（開票回セレクタの選択肢, Req 2.2）
  candidates: readonly Candidate[]; // 当該 Election の Candidate_List（Req 10.1）
}

/** POST /votes リクエスト契約 */
export interface VoteRequest {
  image: string; // base64 PNG
  election_id: string; // アクティブ開票回の election_id（= activeElectionId, Req 2.3 / 3.3）保存ラベル
  candidates: Candidate[]; // アクティブ開票回の Candidate_List（Req 2.4 / 3.3）。Backend が判定基準に用いる（Req 5.1）
}

/** Analyzer が正規化して出力する解析結果（保存前の内部型） */
export interface AnalyzedVote {
  recognized_text: string | null;
  matched_candidate: string | null;
  is_valid: boolean;
  confidence: number; // 0.0〜1.0 に正規化済み
  reason: string;
}

/** POST /votes 200 レスポンス契約（Req 7.1） */
export interface VoteResult extends AnalyzedVote {
  vote_id: string;
  created_at: string; // ISO 8601 UTC
}

/** DynamoDB Votes_Table の 1 レコード */
export interface VoteRecord extends VoteResult {
  election_id: string;
  image_key: string; // S3 オブジェクトキー
}

/**
 * GET results の 1 票レコード（Backend が返す。集計はしない, Req 9.1）。
 * フロント集計に必要な matched_candidate・is_valid を中心に、識別用の vote_id を含む。
 */
export interface VoteRecordSummary {
  vote_id: string;
  matched_candidate: string | null;
  is_valid: boolean;
}

/** GET results 200 レスポンス契約（Backend は票レコード一覧を返す, Req 9.1 / 9.2） */
export interface ElectionResultsResponse {
  election_id: string;
  votes: VoteRecordSummary[];
}

/**
 * フロント側の集計結果型（Req 9.3〜9.5）。
 * Frontend が VoteRecordSummary[] を tally して生成する。Backend は生成しない。
 */
export interface ElectionResults {
  election_id: string;
  total: number; // = valid + invalid
  valid: number;
  invalid: number;
  tally: CandidateTally[]; // 得票数降順
}

export interface CandidateTally {
  candidate: string;
  count: number;
}

/** 共通エラーレスポンス契約（Backend が返すコードのみ。CONFIG_INVALID はフロントのビルド時検証で使われ Backend は返さない） */
export interface ErrorResponse {
  error: {
    code:
      | "VALIDATION_ERROR"
      | "ANALYSIS_FAILED"
      | "STORAGE_FAILED"
      | "LIST_INVALID";
    message: string;
  };
}
