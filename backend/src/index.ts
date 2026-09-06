// @tegaki/backend — Lambda ハンドラと Receiver / Analyzer / Storage モジュール。
// 実装は後続タスク（3.x / 5.x）で追加する。

export {
  validateVoteRequest,
  MAX_IMAGE_BYTES,
  type ValidationResult,
} from "./modules/receiver.js";

export {
  validateCandidateList,
  type CandidateListValidation,
} from "./modules/candidateList.js";

export {
  normalizeAnalysis,
  analyze,
  type AnalysisOutcome,
  type AnalyzerConfig,
} from "./modules/analyzer.js";

export {
  invokeBedrock,
  buildSystemPrompt,
  createBedrockClient,
  resolveAnalyzerConfig,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_ANALYZER_CONFIG,
  type BedrockInvokeResult,
} from "./modules/bedrock.js";

export { toVoteResult } from "./modules/response.js";

export { toVoteRecordSummaries } from "./modules/results.js";

export { handler } from "./handler.js";

export {
  store,
  buildRecord,
  generateVoteId,
  generateCreatedAt,
  createStorageDeps,
  storageConfigFromEnv,
  STORAGE_MAX_ATTEMPTS,
  type StorageResult,
  type StorageDeps,
  type StorageConfig,
  type StoreOptions,
} from "./modules/storage.js";
