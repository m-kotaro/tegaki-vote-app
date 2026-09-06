// @tegaki/shared — 型定義・API 契約のみを保持する共有パッケージ。
// 開票回設定データ（Elections_Config）やその設定ローダはフロント専用として
// frontend/src/config/ 配下へ移した。状態管理・I/O・副作用を伴う実行ロジックは
// 一切含めない（Requirement 11.3）。frontend / backend は shared の型・契約のみを
// 共有し、リクエスト / レスポンスのスキーマを一元管理する。

export type {
  Candidate,
  Election,
  VoteRequest,
  AnalyzedVote,
  VoteResult,
  VoteRecord,
  VoteRecordSummary,
  ElectionResultsResponse,
  ElectionResults,
  CandidateTally,
  ErrorResponse,
} from "./types.js";
