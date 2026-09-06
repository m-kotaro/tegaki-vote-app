# Implementation Plan: tegaki-vote-app

## Overview

手書き投票デモアプリ（tegaki-vote-app）を、実装しやすい依存順で構築する。monorepo スキャフォールド → `shared/`（型・定数・参照ヘルパ）→ backend 純粋ロジック（+ property-based tests）→ backend 副作用配線 → frontend（早期に API モックで単体起動）→ infra（AWS CDK）→ 統合/E2E とドキュメント、の順で進める。

バックエンドは TypeScript 統一（Node.js Lambda）、IaC は AWS CDK（TypeScript）。純粋ロジックには fast-check による Property-Based Testing（最小 100 反復、各プロパティ単一テスト、タグ `// Feature: tegaki-vote-app, Property {n}: ...`）を割り当てる。Bedrock はテストで必ずモック、DynamoDB は DynamoDB Local、S3 は `aws-sdk-client-mock` でモックする。

各コード実装タスクはテスト実行・ビルド確認まで含む。実際の AWS へのデプロイ（apply）はデモ用途のため任意の最終タスクとして分離し、必須にしない。

## Tasks

- [x] 1. monorepo スキャフォールドと TypeScript workspaces 設定
  - ルートに `frontend/`、`backend/`、`infra/`、`shared/`、`docs/` の 5 トップレベルディレクトリを作成する
  - ルート `package.json` に npm workspaces（`frontend`、`backend`、`infra`、`shared`）を設定し、`shared` を `@tegaki/shared` パッケージとして参照可能にする
  - ルートおよび各パッケージの `tsconfig.json`（base + 各パッケージ extends）を設定する
  - ルートに共通の lint/format 設定（ESLint + Prettier）を追加する
  - _Requirements: 11.1, 11.3_

- [x] 2. shared パッケージ: 型定義・定数・参照ヘルパ
  - [x] 2.1 shared/types.ts に契約型を定義する
    - `Candidate`、`Election`、`VoteRequest`、`AnalyzedVote`、`VoteResult`、`VoteRecord`、`ElectionResults`、`CandidateTally`、`ErrorResponse` を定義する
    - 実行ロジック（関数実装・状態管理・副作用）を含めない（型のみ）
    - _Requirements: 10.1, 11.3_

  - [x] 2.2 shared/elections.ts に ELECTIONS 定数と findElection ヘルパを実装する
    - `round-1`（まるまる/バツバツ/三角三角）、`round-2`・`round-3`（空配列プレースホルダ）を持つ `ELECTIONS` を定義する
    - `findElection(electionId, elections = ELECTIONS): Election | undefined` を副作用のない純粋な参照ヘルパとして実装する
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 2.3 shared の構造制約を検証する静的/ユニットテストを書く
    - 各 Election の `election_id` が一意であることを検証する
    - `shared/` が型・定数・純粋な参照ヘルパのみで実行ロジックを含まないことを静的に検査する
    - frontend↔backend の直接 import が存在しないことを依存グラフ/lint ルールで検査する
    - _Requirements: 10.3, 11.1, 11.2, 11.3_

- [x] 3. backend 純粋ロジックとその property-based テスト
  - [x] 3.1 Receiver: validateVoteRequest（入力検証）を実装する
    - 生リクエストボディ文字列を検証し `ValidationResult`（ok / VALIDATION_ERROR / NOT_FOUND）を返す
    - JSON 不正・空、image 欠落・空、election_id 欠落・空、base64 PNG 復号不可（先頭マジックナンバー確認）、復号後 5MB 超を VALIDATION_ERROR にマップ
    - 定義済み ELECTIONS に該当しない election_id を NOT_FOUND にマップし、該当時のみ復号済み画像 Buffer・electionId・対象 Election を返す
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 10.6_

  - [ ]* 3.2 Receiver 検証の property test（Property 1）を書く
    - **Property 1: 有効なリクエストは検証を通過し復号値を返す**
    - **Validates: Requirements 4.2**

  - [ ]* 3.3 Receiver 検証の property test（Property 2）を書く
    - **Property 2: 不正なリクエストは必ず拒否される**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.7, 4.8**

  - [x] 3.4 候補者リスト妥当性検証関数を実装する
    - Candidate_List が空 / id 重複 / name が空 or 50 文字超なら不正（LIST_INVALID）、そうでなければ妥当と判定する純粋関数を実装する
    - _Requirements: 10.4, 10.7_

  - [ ]* 3.5 候補者リスト妥当性検証の property test（Property 16）を書く
    - **Property 16: 各 Election の候補者リストの妥当性検証**
    - **Validates: Requirements 10.4, 10.7**

  - [x] 3.6 Analyzer: normalizeAnalysis（解析結果正規化）を実装する
    - Bedrock 生応答と対象 Election の Candidate_List から正規化済み `AnalysisOutcome` を返す純粋関数を実装する
    - JSON 不正/必須欠落 → ANALYSIS_FAILED、confidence 欠落 or 範囲外 → 0.0 かつ is_valid=false、confidence<0.5 → 判読不能（各 null, is_valid=false）、matched_candidate の候補者リスト所属で is_valid を決定
    - Candidate_List が空 / id 重複なら LIST_INVALID を返す
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 10.5, 10.7_

  - [ ]* 3.7 normalizeAnalysis の property test（Property 4）を書く
    - **Property 4: 有効票判定は対象 Election の候補者リストへの所属と一致する**
    - **Validates: Requirements 5.1, 5.3, 5.4**

  - [ ]* 3.8 normalizeAnalysis の property test（Property 5）を書く
    - **Property 5: 低信頼度は判読不能として無効化される**
    - **Validates: Requirements 5.5**

  - [ ]* 3.9 normalizeAnalysis の property test（Property 6）を書く
    - **Property 6: confidence は常に [0.0, 1.0] に正規化され、欠落・範囲外は無効化される**
    - **Validates: Requirements 5.6, 5.7**

  - [ ]* 3.10 normalizeAnalysis の property test（Property 7）を書く
    - **Property 7: 不正な LLM 応答は解析失敗として扱われる**
    - **Validates: Requirements 5.8**

  - [x] 3.11 Storage: buildRecord（レコードビルダ）と vote_id 生成を実装する
    - UUID による `vote_id` 生成、`created_at` を ISO 8601 UTC で生成
    - `AnalyzedVote` + election_id + image_key から全属性を含む `VoteRecord` を構築する純粋関数を実装する（matched_candidate なしは null）
    - _Requirements: 6.3, 6.4, 6.5, 6.6_

  - [ ]* 3.12 vote_id 生成の property test（Property 9）を書く
    - **Property 9: vote_id は一意な UUID である**
    - **Validates: Requirements 6.3**

  - [ ]* 3.13 buildRecord の property test（Property 10）を書く
    - **Property 10: 保存レコードは全属性を正しく保持する**
    - **Validates: Requirements 6.4, 6.5, 6.6**

  - [x] 3.14 Results: tally（開票集計）を実装する
    - `VoteRecord[]` から `ElectionResults` を集計する純粋関数を実装する
    - total = valid + invalid、is_valid=true を matched_candidate ごとに集計し得票数降順、is_valid=false は集計除外し invalid のみ計上、空集合は total=valid=invalid=0, tally=[]
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 3.15 tally の property test（Property 14）を書く
    - **Property 14: 開票の総数保存則**
    - **Validates: Requirements 9.1**

  - [ ]* 3.16 tally の property test（Property 15）を書く
    - **Property 15: 得票集計は有効票のみを候補者ごとに降順で計上する**
    - **Validates: Requirements 9.2, 9.3, 9.4**

  - [x] 3.17 200 レスポンスビルダ（VoteResult 構築）を実装する
    - 保存成功結果から契約を満たす `VoteResult` を構築する純粋関数を実装する
    - _Requirements: 7.1_

  - [ ]* 3.18 VoteResult ビルダの property test（Property 12）を書く
    - **Property 12: 200 レスポンスボディは契約を満たす**
    - **Validates: Requirements 7.1**

- [~] 4. Checkpoint - backend 純粋ロジックのテストを通す
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. backend 副作用配線
  - [x] 5.1 Bedrock クライアントラッパを実装する
    - `BEDROCK_MODEL_ID` 環境変数でモデル ID を差し替え可能にし、システムプロンプト（JSON 強制・ゆるめ表記ゆれ許容・プロンプトインジェクション耐性）を構築して呼び出す
    - 30 秒タイムアウト、最大 2 回リトライ、全滅で ANALYSIS_FAILED を返す配線を実装する（normalizeAnalysis と結合）
    - _Requirements: 5.1, 5.2, 5.9_

  - [ ]* 5.2 Analyzer 配線のユニットテストを書く（Bedrock モック）
    - Bedrock を必ずモックし、プロンプト内容・タイムアウト・リトライ回数（最大 2 回）・全滅時 ANALYSIS_FAILED を検証する
    - _Requirements: 5.1, 5.2, 5.9_

  - [x] 5.3 Storage 配線（S3 + DynamoDB）を実装する
    - 画像を Image_Store（キー `votes/{election_id}/{vote_id}.png`）へ保存し S3 キーを取得、Votes_Table へ書き込む
    - S3 失敗時は DDB 書き込みせず STORAGE_FAILED、DDB 書き込み失敗時は保存済み S3 画像を削除してロールバック、S3/DDB 各操作は最大 3 回リトライ
    - _Requirements: 6.1, 6.2, 6.7, 6.8, 8.2, 8.3_

  - [ ]* 5.4 Storage 配線のユニットテストを書く（S3/DDB モック）
    - `aws-sdk-client-mock` で S3、DynamoDB Local で DDB を用い、リトライ回数（最大 3 回）と S3 失敗時の非書き込みを検証する
    - _Requirements: 6.1, 6.2, 6.7, 8.3_

  - [ ]* 5.5 Storage ロールバックの property test（Property 11）を書く
    - **Property 11: 保存失敗時は部分データが残らない（ロールバック）**
    - **Validates: Requirements 6.8, 8.2**

  - [x] 5.6 Lambda handler ルーティングを実装する
    - `POST /votes` を Receiver → Analyzer → Storage → 200 VoteResult の順に配線し、各失敗を対応するエラーレスポンス（400/404/502/500）へマップする
    - `GET /elections/{election_id}/results` を findElection 検証（未知は 404 NOT_FOUND）→ DynamoDB 読み取り → tally → 200 の順に配線する
    - 解析失敗時は S3・DDB 保存を行わず、エラーを 1 秒以内に返す
    - _Requirements: 4.1, 7.1, 8.1, 9.1, 9.5, 10.6_

  - [ ]* 5.7 未知 election_id 非永続化の property test（Property 3）を書く（Bedrock/S3/DDB モック）
    - **Property 3: 未知の election_id は解析・保存されず対象なしエラーになる**
    - **Validates: Requirements 4.6, 10.5, 10.6**

  - [ ]* 5.8 解析失敗時の非永続化の property test（Property 8）を書く（S3/DDB モック）
    - **Property 8: 解析失敗時は一切の永続化が行われない**
    - **Validates: Requirements 8.1**

  - [ ]* 5.9 handler ルーティングとエラーマッピングのユニット/統合テストを書く
    - 各エラー code と HTTP ステータスのマッピング、対象 Election ありで投票なしの results（total=0）を検証する
    - Bedrock はモック、DynamoDB は DynamoDB Local、S3 は `aws-sdk-client-mock`
    - _Requirements: 4.3, 4.5, 4.6, 5.8, 6.7, 9.3, 9.5_

- [~] 6. Checkpoint - backend 全体のテストを通す
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. frontend 実装（早期に API モックで単体起動）
  - [x] 7.1 frontend スキャフォールドと API クライアント（モック差し替え可能）を実装する
    - React + Vite プロジェクトを初期化し、`@tegaki/shared` を参照する
    - `POST /votes` と `GET /elections/{id}/results` を呼ぶ API クライアントを、モック実装（MSW 等）へ差し替え可能なインターフェースで実装する
    - モック API で frontend を単体起動できるよう MSW ハンドラを用意する
    - _Requirements: 11.2, 11.4_

  - [x] 7.2 CanvasComponent を実装する
    - 最小 300x200 の Canvas、タッチ/マウスドラッグ描画、clear / isEmpty / toPngBase64 ハンドルを実装する
    - 線幅を 1〜10px にクランプする
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 7.3 線幅クランプの property test（Property 17）を書く
    - **Property 17: 線幅は 1〜10px にクランプされる**
    - **Validates: Requirements 1.2, 1.3**

  - [ ]* 7.4 CanvasComponent のユニットテストを書く
    - 最小サイズ、消去で空状態、未入力時 toPngBase64 が null を返し未入力エラー通知を出すことを検証する
    - _Requirements: 1.1, 1.4, 1.6_

  - [x] 7.5 ElectionSelector と開票回選択状態を実装する
    - ELECTIONS のタイトルを選択肢表示、選択で候補者リスト・タイトルを反映、選択中 election_id を投票リクエストへ渡す
    - 未定義/未選択時は投票させず選択を促すメッセージを表示する
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 7.6 ElectionSelector のユニットテストを書く
    - タイトル表示、選択反映、未選択ガードを React Testing Library で検証する
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 7.7 VoteButton / VoteAnimation / CountingIndicator と投票送信状態遷移を実装する
    - 「投票」ボタン、Framer Motion アニメ（送信後 3 秒以内開始）、「開票中...」表示・ボタン無効化を実装する
    - idle→送信ガード（開票回未選択/未入力）→counting→結果、通信タイムアウト 35 秒・成功応答期限 10 秒での失敗表示を実装する
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 7.8 投票送信状態遷移のユニットテストを書く（fake timers）
    - 未選択/未入力ガード、counting 表示、10 秒/35 秒タイムアウト時の失敗表示とボタン再有効化を検証する
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 8.5, 11.5_

  - [x] 7.9 ResultView と confidence パーセント変換を実装する
    - 有効/無効票表示、matched_candidate、reason、confidence を round(confidence*100) で 0〜100% 表示する
    - _Requirements: 7.2, 7.3, 7.4_

  - [ ]* 7.10 confidence 変換の property test（Property 13）を書く
    - **Property 13: confidence のパーセント変換は 0〜100 に収まる**
    - **Validates: Requirements 7.4, 11.4**

  - [x] 7.11 ErrorNotice とエラー種別表示を実装する
    - VALIDATION_ERROR / NOT_FOUND / ANALYSIS_FAILED / STORAGE_FAILED / 通信タイムアウト / 未入力 / 開票回未選択 を投票者向けメッセージへ変換して 5 秒以内に表示し、直前表示を保持する
    - _Requirements: 7.5, 8.4, 8.5, 11.5_

  - [ ]* 7.12 ErrorNotice のユニットテストを書く
    - 各エラー種別のメッセージ表示と直前表示保持を検証する
    - _Requirements: 7.5, 8.4, 11.5_

- [~] 8. Checkpoint - frontend のテストを通し、モック API で単体起動を確認する
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. infra 実装（AWS CDK / TypeScript）
  - [x] 9.1 静的配信スタック（S3 + CloudFront OAC）を実装する
    - 非公開 S3 バケット、CloudFront + OAC 経由の静的配信を定義する
    - _Requirements: 11.1_

  - [x] 9.2 API/バックエンドスタック（API Gateway + Lambda + DynamoDB + S3 + Bedrock 権限 + X-Ray）を実装する
    - REST API Gateway（CORS: CloudFront オリジン許可、POST /votes・GET /elections/{id}/results）、Node.js Lambda、Votes_Table（PK=vote_id）、Image_Store（非公開）、Bedrock 呼び出し IAM 権限、Lambda と下流呼び出しの X-Ray を定義する
    - _Requirements: 4.1, 6.1, 6.4, 9.1_

  - [ ]* 9.3 CDK スタックの合成テストを書く
    - `cdk synth` / assertions で主要リソース（非公開バケット、OAC、API メソッド、DDB テーブル、Bedrock 権限、X-Ray 有効化）が生成されることを検証する
    - _Requirements: 11.1_

- [ ] 10. 統合/E2E とドキュメント
  - [~] 10.1 E2E テストを実装する
    - 開票回選択 → POST /votes 成功・各エラー（未知 election_id の 404 含む）→ GET results を代表シナリオで検証する（Bedrock はモック）
    - _Requirements: 2.3, 3.2, 4.6, 7.1, 9.1, 9.5_

  - [x] 10.2 docs/architecture.md を作成する
    - アーキテクチャ図、リポジトリ構成、API 契約、エラーレスポンス、デモ用途の前提を記述する
    - _Requirements: 11.1_

- [~] 11. Final checkpoint - 全テストとビルドを通す
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 12. （任意）実 AWS への CDK デプロイ
  - デモ用途のため任意。`cdk deploy` で静的配信・API スタックを実 AWS へ apply する
  - _Requirements: 11.1_

## Notes

- タスクに `*` が付いたサブタスクは任意（テストや任意デプロイ）であり、MVP を急ぐ場合はスキップ可能。トップレベルタスクには `*` を付けない。
- 各タスクは特定の要件番号を参照しトレーサビリティを確保している。
- Property-Based Testing は fast-check（最小 100 反復、各プロパティ単一テスト、タグ `// Feature: tegaki-vote-app, Property {n}: ...`）で実装する。Bedrock はモック、DynamoDB は DynamoDB Local、S3 は `aws-sdk-client-mock` を使用。
- Correctness Property 1〜17 はすべて対応するテストタスクを持つ（1,2→3.2/3.3、3→5.7、4〜7→3.7〜3.10、8→5.8、9,10→3.12/3.13、11→5.5、12→3.18、13→7.10、14,15→3.15/3.16、16→3.5、17→7.3）。
- UI 描画・外部サービス配線・構造制約はユニット/統合/E2E テストで扱う。
- 実 AWS へのデプロイは任意の最終タスク（12）に分離し、必須にしない。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "3.4", "3.6", "3.11", "3.14", "3.17", "7.1", "9.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.5", "3.7", "3.8", "3.9", "3.10", "3.12", "3.13", "3.15", "3.16", "3.18", "5.1", "5.3", "7.2", "7.5", "7.9", "7.11", "9.2"] },
    { "id": 4, "tasks": ["5.2", "5.4", "5.5", "5.6", "7.3", "7.4", "7.6", "7.7", "7.10", "7.12", "9.3"] },
    { "id": 5, "tasks": ["5.7", "5.8", "5.9", "7.8"] },
    { "id": 6, "tasks": ["10.1", "10.2", "12"] }
  ]
}
```
