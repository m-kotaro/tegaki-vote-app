# Design Document: tegaki-vote-app

## Overview

tegaki-vote-app は、日本語の候補者名を手書きし、Amazon Bedrock のマルチモーダル LLM（Claude Sonnet 4 系）で解析して「有効票 / 無効票」を判定する、エンタメ / デモ / 学習用のネタアプリである。ブラウザ上の Canvas に候補者名を手書きして「投票」すると、バックエンドが画像を解析し、候補者リストとの一致可否から有効票かどうかを判定して即座に結果を返す。

本アプリは **デモ用途** であり、本物の投票システムに求められる匿名性・改竄防止・二重投票防止・監査証跡は対象外とする（Requirement Introduction および本設計 Security / 非機能セクション参照）。ただし将来の開票結果表示（Requirement 9 want 要件）を「読むだけ」で追加できるよう、書き込み時のデータスキーマは初期段階から正しく設計する。

**複数開票回（Election）方針**: 1 つのアプリを忘年会の会場投票など複数のシーンに流用するため、投票・開票の単位である **Election（開票回）** を複数定義する。各 Election は `election_id`・タイトル・`Candidate_List` を持つ。Election 群と、現在投票を受け付けている **アクティブ開票回を示す `activeElectionId`** はコードにハードコードせず、アプリケーション保有者（管理者）が管理する **フロントエンド専用の設定ファイル `frontend/src/config/elections.config.json`（Elections_Config）** で保持する（Requirement 10.1 / 10.3）。この設定ファイルは **フロントエンド専用** であり、**Backend は開票回・候補者の定義を一切保持せず、Elections_Config を参照しない**（Requirement 10.2）。UI の管理画面は設けず（軽量方針）、保有者が設定ファイルを編集して Frontend をデプロイすることで開票回・候補者を差し替え、`activeElectionId` を編集することで現在の開票回を切り替える。`frontend/src/config/elections.ts` はこの設定ファイルを **型付きの `{ activeElectionId, elections }` として読み込み・検証して公開するローダ** であり、フロントのみが **ビルド時** にこれを参照する（Requirement 10.3）。投票者は開票回を選択せず、フロントは `activeElectionId` に対応する Election を **固定表示** する（Requirement 2）。フロントは投票時に `activeElectionId` を `election_id` として、かつアクティブ開票回の `Candidate_List` を `candidates` として投票リクエストに含める（Requirement 2.3 / 2.4 / 3.3）。バックエンドは開票回・候補者の定義を持たず、**リクエストで受け取った `candidates` をそのまま判定基準に用いる**（Requirement 5.1）。`election_id` は保存用のラベルとして受け入れ、開票回定義との照合は行わない（Requirement 4.6 / 10.6）。

**PoC の整合性方針**: 本アプリは PoC（概念実証）であり、判定基準となる候補者リストがクライアント（フロント）由来であるため、候補者リストの真正性・整合性のエンタープライズ的な保証は対象外とする（Requirement Introduction）。バックエンドは受け取った `candidates` の構成的な妥当性（空・重複・name 長）のみを判定前に検証する。

**v1 の構成方針**: バックエンドは **Lambda 同期 1 本** の構成とする。受付（Receiver）・解析（Analyzer）・保存（Storage）を 1 つの Lambda 内の内部モジュールとして分割し、Step Functions / SQS は採用しない。同期呼び出しで受付から結果応答までを完結させることで、デモに必要な即時フィードバック（Requirement 7.1: 3 秒以内応答）を素直に実現する。

本設計は Requirement 1〜11 のすべてをカバーする。各セクションで対応する Requirement 番号を参照する。

### 未決事項の解決状況

Requirements 文書末尾の「未決事項（設計フェーズで決定する）」は、本設計で以下の通りすべて解決済みである。

| 未決事項 | 決定内容 |
|---|---|
| バックエンド言語 | **TypeScript 統一**（Lambda は Node.js ランタイム。`shared/` の型を frontend / backend の両方が参照） |
| IaC | **AWS CDK（TypeScript）** |
| 開票回（Election）ごとの候補者リスト | **複数の Election をフロントエンド専用の設定ファイルで管理**する。Election 群は `frontend/` の設定ファイル **`src/config/elections.config.json`（Elections_Config）** に定義し、アプリケーション保有者が編集・デプロイして差し替える（コードにハードコードしない）。Backend は Election 定義を持たない。各 Election が `election_id`・タイトル・`Candidate_List` を持つ。**第1回（`round-1`）**: サンプル候補者 まるまる (`candidate-1`) / バツバツ (`candidate-2`) / 三角三角 (`candidate-3`) を設定ファイルに定義。**第2回（`round-2`）・第3回（`round-3`）**: 保有者が後から候補者を追加する空プレースホルダ（`"candidates": []`）。`election_id` は `round-1` / `round-2` / `round-3` |
| Elections_Config の配置・スキーマ・読み込み方式 | **配置**: `frontend/src/config/elections.config.json`（**フロントエンド専用**）。**スキーマ**: トップレベルはオブジェクト `{ "activeElectionId": string, "elections": [{ "election_id": string, "title": string, "candidates": [{ "id": string, "name": string }] }] }`。`activeElectionId` と Election 群 `elections` をトップレベルに並置し、`activeElectionId` は `elections` 内のいずれかの `election_id` を指す（Req 10.1 / 10.3 / 10.9）。**読み込み**: `frontend/src/config/elections.ts` が `resolveJsonModule` による JSON import で設定を取り込み、`validateElectionsConfig`（純粋関数）で形状・`election_id` 一意性・`activeElectionId` と `elections` の整合を検証したうえで、型付きの `ELECTIONS: Election[]` と `ACTIVE_ELECTION_ID: string` を export し、アクティブ Election を引く `getActiveElection()` ヘルパを提供する。**フロントのみ**が Vite で JSON を import でバンドル（**ビルド時**）に検証・確定する。Backend はこの設定を参照しない。実行時の外部 I/O は行わず、ビルド/バンドル時に設定を固める |
| POST /votes に candidates を含める API 契約 | フロントは投票時に `image`・`election_id` に加えて、アクティブ開票回の `Candidate_List` を `candidates: [{ id, name }]` として POST /votes に含める（Req 2.4 / 3.3 / 4.2）。Backend は受け取った `candidates` をそのまま判定基準に用いる（Req 5.1）。契約型 `VoteRequest` は `shared/types.ts` に定義する（設定データではなく API 契約のため shared に置く） |
| 表記ゆれの許容度 | **ゆるめ**（表記ゆれ・ひらがな/漢字ゆれ・姓のみなども一致扱い。判定は Bedrock LLM のプロンプトに委譲し「最も一致する候補者を選び、明らかに別人・判読不能なら `is_valid=false`」と指示） |
| Bedrock 利用モデル ID | **Claude Sonnet 4 系マルチモーダルモデルを推論プロファイル ID 経由で呼び出す**。モデル ID は Lambda 環境変数 `BEDROCK_MODEL_ID` で差し替え可能。デフォルトは推論プロファイル形式（`us.` / `apac.` / `eu.` プレフィックス付き） |
| エラーレスポンス設計 | HTTP ステータス（400 / 502 / 500 / 404）と JSON ボディ `{ "error": { "code": "...", "message": "..." } }` 形式を確定（Error Handling セクション参照） |

---

## Architecture

システムは 2 つの独立した経路を持つ。静的配信経路（フロントエンド資産の配信）と API 経路（投票処理・開票集計）である。

```mermaid
flowchart TD
    Browser["ブラウザ<br/>React + Vite + Canvas"]

    subgraph Static["静的配信経路"]
        CF["CloudFront<br/>(OAC)"]
        S3Web["S3: 静的ホスティング<br/>(非公開バケット)"]
    end

    subgraph APIPath["API 経路"]
        APIGW["API Gateway<br/>(REST / CORS)"]
        Lambda["Lambda (Node.js / TypeScript)<br/>Receiver → Analyzer → Storage"]
        S3Img["S3: Image_Store<br/>(手書き画像)"]
        Bedrock["Amazon Bedrock<br/>Claude Sonnet 4 系"]
        DDB["DynamoDB: Votes_Table<br/>(PK = vote_id)"]
    end

    Browser -->|"GET / (HTML/JS/CSS)"| CF
    CF --> S3Web

    Browser -->|"POST /votes { image, election_id, candidates }<br/>GET /elections/{election_id}/results<br/>※ election_id は管理者が activeElectionId で指定<br/>※ candidates（候補者リスト）は投票リクエストでフロントから渡す<br/>※ Elections はフロント専用設定 elections.config.json 由来<br/>※ 集計はフロントが実施（Backend は票レコードを返すのみ）"| APIGW
    APIGW --> Lambda
    Lambda -->|"1. 画像保存"| S3Img
    Lambda -->|"2. 画像解析（受け取った candidates で判定）"| Bedrock
    Lambda -->|"3. 結果書き込み / 票レコード読み取り"| DDB
```

**投票処理のシーケンス（POST /votes）**:

```mermaid
sequenceDiagram
    participant B as ブラウザ
    participant G as API Gateway
    participant R as Receiver_Module
    participant A as Analyzer_Module
    participant St as Storage_Module
    participant Bd as Bedrock_LLM
    participant S3 as Image_Store
    participant D as Votes_Table

    B->>G: POST /votes { image, election_id, candidates }
    G->>R: invoke Lambda
    R->>R: 入力検証（JSON / 画像 / election_id 非空 / candidates 形式 / 5MB）
    alt 検証失敗（入力不正）
        R-->>B: 400 VALIDATION_ERROR
    end
    R->>A: 検証済み画像 + election_id + 受け取った candidates
    A->>A: candidates 構成検証（空 / id重複 / name長）
    alt candidates 構成不正
        A-->>B: 400 LIST_INVALID（Bedrock 呼ばず・保存せず）
    end
    A->>Bd: 画像 + プロンプト（受け取った candidates / JSON 強制）
    alt 解析失敗（タイムアウト / JSON 不正 / 最大2回リトライ後）
        A-->>B: 502 ANALYSIS_FAILED（保存せず）
    end
    A->>St: VoteResult（正規化済み）
    St->>S3: 画像保存
    St->>D: 結果書き込み
    alt DynamoDB 書き込み失敗
        St->>S3: 画像削除（ロールバック）
        St-->>B: 500 STORAGE_FAILED
    end
    St-->>B: 200 VoteResult
```

**トレーサビリティ**: Lambda と下流呼び出し（S3 / Bedrock / DynamoDB）に **AWS X-Ray** トレースを有効化し、受付 → 解析 → 保存のフローとレイテンシをセグメント単位で可視化する。デモ時の遅延要因（多くは Bedrock 呼び出し）を切り分けやすくする目的である。

---

## リポジトリ構成

monorepo として以下のトップレベルディレクトリを持つ（Requirement 11.1）。

```
tegaki-vote-app/
├── frontend/          # React + Vite アプリ（Canvas・投票 UI・結果表示・開票集計）
│   └── src/config/    # elections.config.json（フロント専用設定）+ elections.ts（ローダ/検証/findElection/getActiveElection）
├── backend/           # Lambda ハンドラと Receiver / Analyzer / Storage モジュール（開票回定義は持たない）
├── infra/             # AWS CDK（TypeScript）スタック定義
├── shared/            # types.ts（型定義・API 契約のみ。設定データ・ローダは含まない）
└── docs/              # 設計・運用ドキュメント
```

**疎結合ルール 3 点（Requirement 11.2 / 11.3 / 11.4）**:

1. **HTTP API のみで会話する**: `frontend/` と `backend/` は直接的なコード参照やモジュールインポートを行わない。両者の通信は API Gateway 経由の HTTP API のみを通じて行う（Requirement 11.2）。
2. **`shared/` は型・契約のみ**: `shared/` には TypeScript の型定義（`types.ts`）と API 契約（リクエスト / レスポンス型）のみを置く。開票回設定データ（Elections_Config）や設定ローダは `shared/` に置かず（フロント専用として `frontend/` 配下へ移す）、状態管理・I/O・副作用を伴う実行ロジックも一切含めない（Requirement 11.3）。`frontend/` と `backend/` は `shared/` の型・契約を共有することで、リクエスト / レスポンスのスキーマを一元管理する。開票回・候補者リスト・`activeElectionId` は Backend が持たず、フロント専用設定として `frontend/` 配下でのみ管理される（Requirement 10.1 / 10.2）。
3. **API レスポンスは整形して返す**: `frontend/` は `backend/` から受信した API レスポンスを、表示に必要な形（例: confidence を 0〜100% へ変換、票レコード一覧を集計）へ整形してから描画する（Requirement 11.4 / 7.4 / 9.3）。

`shared/` を frontend / backend の両方から参照する方法は、monorepo のワークスペース参照（例: npm/pnpm workspaces の `@tegaki/shared` パッケージ）とする。これは「モジュールインポートの禁止（11.2）」が指す frontend↔backend 間の直接参照とは別レイヤであり、共有される対象は **型・契約のみ** に限定される（実行ロジック・設定データを含まないため疎結合は保たれる）。

**Election ルックアップの扱い（設計判断）**: `election_id` から Election を引くルックアップおよびアクティブ開票回を引く参照ヘルパ（`findElection(id): Election | undefined` / `getActiveElection(): Election`）は、開票回設定を保持する **フロント専用モジュール `frontend/src/config/elections.ts`** に置く。これは設定ファイル由来の配列 `ELECTIONS`（`elections.config.json` を読み込み・検証した結果）に対する副作用のない検索であり、フロントのみが使用する。Backend は開票回・候補者の定義を持たないため、こうしたルックアップを一切行わない。Candidate_List の構成的な妥当性検証（空・重複・name 長）や有効票判定は backend 側（Analyzer）が、リクエストで受け取った `candidates` に対して実施する。

---

## Components and Interfaces

### Frontend

React + Vite + Canvas API + Framer Motion で構成する。主なコンポーネントとその責務は以下の通り。

**画面構成とルーティング方針（独立画面）**: フロントは react-router-dom で `/`（投票ページ `VotePage`）と `/results`（開票結果ページ `ResultsView`）の 2 ルートを持つ。この 2 ルート構成は維持するが、**投票ページと開票結果ページは相互のナビゲーションリンクを一切持たない独立画面**とし、それぞれ **URL 直接アクセスでのみ到達する**（投票ページに「開票結果を見る」等のリンクは置かず、開票結果ページにも「投票に戻る」等のリンクは置かない）。開票結果ページ（`/results`）は運営者向けの独立画面という位置づけであり、投票者の通常フローからは到達しない（投票者は `/` のみを使う）。

| コンポーネント | 責務 | 関連 Requirement |
|---|---|---|
| `CanvasComponent` | 手書き入力領域。タッチ / マウスドラッグ対応、消去、PNG 取得。最小サイズ 300x200、線幅 1〜10px | 1.1〜1.6 |
| `ActiveElectionBanner` | アクティブ開票回の固定表示。`getActiveElection()`（フロント専用 config モジュール）が返す Election のタイトルと Candidate_List を表示するのみ（選択 UI なし）。`activeElectionId` が不整合な設定不正時は「現在受け付けていない」旨を表示 | 2.1, 2.2, 2.5 |
| `VoteButton` | 投票送信ボタン。送信中は操作不可 | 3.1, 3.5 |
| `VoteAnimation` | Framer Motion による投票アニメ（送信後 3 秒以内に開始） | 3.4 |
| `CountingIndicator` | 「開票中...」状態表示 | 3.5, 3.8 |
| `ResultView` | 判定結果表示（有効/無効、matched_candidate、confidence の %、reason） | 7.2〜7.4 |
| `ResultsView`（want） | `/results` の開票結果ページ。運営者向けの独立画面（投票ページと相互ナビゲーションを持たず URL 直接アクセスでのみ到達）。指定開票回の票レコード一覧を Backend から取得し、フロント側で集計（総数・有効/無効・候補者別得票）して表示 | 9.3〜9.5 |
| `ErrorNotice` | エラー種別表示（解析失敗 / 保存失敗 / 通信タイムアウト / 未入力 / 受付停止中） | 1.6, 2.5, 3.6, 3.7, 7.5, 8.4, 8.5, 11.5 |

**Canvas 手書きコンポーネントのインターフェース**:

```typescript
// frontend/src/components/CanvasComponent.tsx
export interface CanvasComponentProps {
  /** 描画領域サイズ。最小 300x200 を保証する（Req 1.1） */
  width: number;   // >= 300
  height: number;  // >= 200
  /** 線幅。1〜10px の範囲にクランプする（Req 1.2 / 1.3） */
  lineWidth: number; // 1 <= lineWidth <= 10
}

export interface CanvasComponentHandle {
  /** 全消去して空状態に戻す（Req 1.4） */
  clear(): void;
  /** 手書き内容が存在するか（Req 1.6 / 3.6 の未入力判定に使用） */
  isEmpty(): boolean;
  /**
   * 描画内容を base64 PNG 文字列として返す（Req 1.5 / 3.2）。
   * 未入力時は null を返し、呼び出し側が未入力エラー通知を出す（Req 1.6）。
   */
  toPngBase64(): string | null;
}
```

**アクティブ開票回表示コンポーネントのインターフェース**:

投票者は開票回を選択しない。フロントは Elections_Config（フロント専用）の `activeElectionId` に対応する Election を固定表示するのみである（Requirement 2.1 / 2.2）。表示専用のため `onSelect` のような選択コールバックは持たない。

```typescript
// frontend/src/components/ActiveElectionBanner.tsx
import type { Election } from "@tegaki/shared";

export interface ActiveElectionBannerProps {
  /**
   * 固定表示するアクティブ開票回。getActiveElection() の結果。
   * タイトルと Candidate_List を表示するのみで、選択 UI は持たない（Req 2.1 / 2.2）。
   */
  election: Election;
}
```

**アクティブ開票回の前提（フロント側）**:

- `activeElectionId` はフロント専用 Elections_Config で管理者が指定する。投票者は変更できず、フロントは常にアクティブ開票回を確定した状態で起動する（Requirement 2.2）。したがって「未選択」状態は存在しない。
- 正常時は `getActiveElection()`（`frontend/src/config/elections.ts`）が返す Election のタイトルと `Candidate_List` を `ActiveElectionBanner` で固定表示し（Requirement 2.1）、投票時は `ACTIVE_ELECTION_ID` を `election_id` として、かつアクティブ開票回の `Candidate_List` を `candidates` としてリクエストに含める（Requirement 2.3 / 2.4 / 3.3）。
- ただし `activeElectionId` が Elections のいずれの `election_id` にも該当しない **設定不正** の場合は、フロントを投票送信できない状態にし、「現在投票を受け付けていない」旨を表示する（Requirement 2.5）。この受付不可はビルド時の設定検証（`CONFIG_INVALID`）でも検出されるが（Data Models 参照）、実行時フォールバックとしてもガードを持たせる。

```
[アクティブ開票回 確定]  --正常--> POST /votes に election_id(=activeElectionId) と candidates(=Candidate_List) を含めて送信（Req 2.3 / 2.4 / 3.3）
        |
        | activeElectionId が Elections に無い（設定不正）
        v
   投票不可 + 「現在受け付けていない」表示（Req 2.5）
```

**投票送信フロー（フロント側の状態遷移）**:

- `idle` → 「投票」押下 → `activeElectionId` が設定不正で受付不可の状態なら「現在投票を受け付けていない」旨を表示して送信しない（Requirement 2.5）。
- 受付可能で `CanvasComponent.isEmpty()` が true なら未入力メッセージ表示して `idle` のまま（Requirement 3.6 / 1.6）。
- 受付可能かつ非空なら `toPngBase64()` を取得し、`POST /votes` に `image` と `ACTIVE_ELECTION_ID`（= `activeElectionId`）を `election_id` として、かつアクティブ開票回の `Candidate_List` を `candidates` として含めて送信（Requirement 3.2 / 3.3）。同時に投票アニメを 3 秒以内に開始（Requirement 3.4）、`counting` 状態へ遷移して「開票中...」表示・ボタン無効化（Requirement 3.5）。
- フロント側の通信タイムアウトは **35 秒**（Requirement 8.5）。加えて Requirement 3.7 / 11.5 の 10 秒以内に成功応答がない場合の失敗表示も行う（詳細は Error Handling）。
- 200 応答受信で `counting` 終了 → `ResultView` 表示（Requirement 3.8 / 7.2〜7.4）。エラー応答または期限超過で `ErrorNotice` 表示し `idle` に戻す（直前表示は保持: Requirement 11.5）。

confidence の表示は `Math.round(confidence * 100)` として 0〜100% に変換する（Requirement 7.4）。

**開票結果表示と集計（want, Req 9.3〜9.5）**: フロントは `GET /elections/{election_id}/results` で **票レコード一覧**（各レコードは `matched_candidate`・`is_valid` を含む）を受け取り、フロント側の純粋関数 `tally` で集計する。集計は Backend では行わない。

```typescript
// frontend/src/logic/tally.ts
import type { VoteRecordSummary, ElectionResults } from "@tegaki/shared";

/**
 * 票レコード一覧を集計する純粋関数（Req 9.3〜9.5）。Backend では実行しない。
 * - total = valid + invalid（Req 9.3）
 * - is_valid=true を matched_candidate ごとに集計し得票数降順で返す（Req 9.4）
 * - is_valid=false は得票集計から除外し invalid にのみ計上（Req 9.5）
 * - 票が空の場合は total=0, valid=0, invalid=0, tally=[]
 */
export function tally(votes: readonly VoteRecordSummary[]): ElectionResults;
```

`ResultsView`（want）は `readVotesByElection` 相当の API 呼び出しでレコード一覧を取得し、`tally` の結果（総投票数・有効票数・無効票数・候補者別得票の降順一覧）を表示する。本設計では記述のみとし、want 要件として実装は後続とする。

### Backend Lambda

単一 Lambda（Node.js / TypeScript）内で、ハンドラが Receiver → Analyzer → Storage の順に内部モジュールを呼び出す。各モジュールは純粋なロジックと副作用を分離し、テスト容易性を確保する。

```typescript
// backend/src/handler.ts
import type { VoteRequest, VoteResult, ErrorResponse } from "@tegaki/shared";

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // POST /votes → Receiver → Analyzer → Storage
  // GET /elections/{election_id}/results → Results 集計
};
```

#### Receiver_Module（入力検証）

Requirement 4 全体を担う。副作用を持たない純粋な検証関数として実装する。

```typescript
// backend/src/modules/receiver.ts
import type { VoteRequest, Candidate } from "@tegaki/shared";

export type ValidationResult =
  | { ok: true; image: Buffer; electionId: string; candidates: Candidate[] }
  | { ok: false; code: "VALIDATION_ERROR"; message: string };

/**
 * 生のリクエストボディ文字列を検証する。
 * - JSON として解釈できない / 空 → VALIDATION_ERROR（Req 4.9）
 * - image フィールド欠落 / 空 → VALIDATION_ERROR（Req 4.3）
 * - election_id 欠落 / 空 → VALIDATION_ERROR（Req 4.5）
 * - candidates 欠落 / 配列でない / 要素が id・name を持たない → VALIDATION_ERROR（Req 4.7）
 * - image が base64 PNG として復号不可 → VALIDATION_ERROR（Req 4.4）
 * - 復号後サイズ > 5MB → VALIDATION_ERROR（Req 4.8）
 * すべて通過したら復号済み画像 Buffer・election_id・受け取った candidates を返す（Req 4.2）。
 *
 * election_id は保存用ラベルとして非空チェックのみ行い、開票回定義との照合は行わない（Req 4.6）。
 * Backend は Elections を保持しないため、未知 election_id の NOT_FOUND 検証は存在しない。
 * candidates の「構成的妥当性」（空 / id 重複 / name 長）は判定前段の Analyzer が検証する（Req 5.2 / LIST_INVALID）。
 * ここでの candidates 検証は形式検証（配列であり各要素が id・name を持つ）のみ。
 */
export function validateVoteRequest(rawBody: string | null): ValidationResult;
```

PNG 判定は復号後バイト列の先頭 8 バイトのマジックナンバー（`89 50 4E 47 0D 0A 1A 0A`）を確認する。サイズ上限 `MAX_IMAGE_BYTES = 5 * 1024 * 1024`。

**election_id の扱い（Req 4.6）**: 入力の `election_id` は保存用のラベルとして非空チェックのみ行う。Backend は開票回定義を保持しないため、開票回定義との照合や未知 election_id の拒否（NOT_FOUND）は行わない。`election_id` フィールドの欠落・空は入力不正 `VALIDATION_ERROR`（400, Req 4.5）とする。

**candidates の検証（Req 4.7）**: `candidates` フィールドの有無・配列であること・各要素が `id` と `name` を持つことを **形式検証** する。いずれかを満たさなければ入力不正 `VALIDATION_ERROR`（400）。形式が妥当なら受け取った `candidates` をそのまま下流（Analyzer）へ渡す。`candidates` の **構成的妥当性**（空リスト・`id` 重複・`name` 長 1〜50 文字）の検証は判定直前に Analyzer が行い、不正なら `LIST_INVALID`（Req 5.2）とする。

#### Analyzer_Module（Bedrock 解析）

Requirement 5 全体を担う。判定基準には、**リクエストで受け取った `candidates`（Candidate_List）** をそのまま用いる（Req 5.1）。Backend は開票回・候補者の定義を持たず、Analyzer は Receiver から渡された `candidates` を直接使う。

```typescript
// backend/src/modules/analyzer.ts
import type { Candidate, AnalysisOutcome } from "@tegaki/shared";

export interface AnalyzerConfig {
  modelId: string;          // env BEDROCK_MODEL_ID（推論プロファイル ID）
  timeoutMs: number;        // 30_000（Req 5.10）
  maxRetries: number;       // 2（Req 5.10）
}

/**
 * 検証済み画像と、リクエストで受け取った candidates（Candidate_List）を Bedrock へ渡し、
 * 正規化済みの解析結果を返す（Req 5.1）。
 * candidates は Receiver が形式検証した、クライアント（フロント）由来の候補者リスト。
 * Backend は開票回定義を持たないため、対象 Election の照合は行わない。
 *
 * 判定前段の構成検証（Req 5.2）:
 * - candidates が空 / id 重複 / name が 1 文字未満 or 50 文字超 → LIST_INVALID エラー
 *   （Bedrock を呼ばず、有効票判定を実行しない）
 *
 * 正規化ルール:
 * - LLM 応答が有効 JSON でない / 必須フィールド欠落 → 解析失敗（Req 5.9）
 * - confidence 欠落 or <0.0 or >1.0 → confidence=0.0, is_valid=false（Req 5.8）
 * - confidence < 0.5 → 判読不能: recognized_text=null, matched_candidate=null, is_valid=false（Req 5.6）
 * - matched_candidate が受け取った candidates に含まれる → is_valid=true（Req 5.4）
 * - 含まれない / null → is_valid=false（Req 5.5）
 * - タイムアウト / エラーは最大 maxRetries 回リトライ、全滅で解析失敗（Req 5.10）
 */
export function analyze(
  image: Buffer,
  candidates: readonly Candidate[],
  config: AnalyzerConfig,
): Promise<AnalysisOutcome>;

// AnalysisOutcome:
// | { ok: true; result: AnalyzedVote }   // recognized_text, matched_candidate, is_valid, confidence, reason
// | { ok: false; code: "ANALYSIS_FAILED" | "LIST_INVALID"; message: string }
```

candidates 構成検証は純粋関数 `validateCandidateList(candidates): { ok: true } | { ok: false; code: "LIST_INVALID" }` に切り出し、`analyze` の前段で実行する（Req 5.2）。正規化は純粋関数 `normalizeAnalysis(raw: unknown, candidates): AnalysisOutcome` に切り出し、Bedrock 呼び出し（副作用）と分離する。これにより Requirement 5.4〜5.9 の判定ロジックを property test で検証できる。`candidates` はリクエスト由来の候補者集合であり、有効票判定（Property 4）はこの受け取った候補者集合に対して行う。

#### Storage_Module（S3 + DynamoDB 保存）

Requirement 6 全体および Requirement 8.2 / 8.3 のロールバック・リトライを担う。

```typescript
// backend/src/modules/storage.ts
import type { AnalyzedVote, VoteResult } from "@tegaki/shared";

export type StorageResult =
  | { ok: true; result: VoteResult }
  | { ok: false; code: "STORAGE_FAILED"; message: string };

/**
 * 手順（Req 6.1〜6.8, 8.2, 8.3）:
 * 1. vote_id = UUID 生成（Req 6.3）
 * 2. 画像を Image_Store へ保存し S3 キー取得（Req 6.1 / 6.2）。失敗なら DDB 書き込みせず STORAGE_FAILED（Req 6.7）
 * 3. created_at = ISO 8601 UTC（Req 6.6）
 * 4. Votes_Table へ全属性書き込み（Req 6.4 / 6.5）
 * 5. DDB 書き込み失敗時は保存済み S3 画像を削除してロールバック（Req 6.8 / 8.2）
 * S3 / DDB 双方の操作は最大 3 回リトライ（Req 8.3）。
 */
export function store(
  analyzed: AnalyzedVote,
  electionId: string,
  image: Buffer,
): Promise<StorageResult>;
```

#### Results 読み取り（GET /elections/{election_id}/results）

Requirement 9 の Backend 側を担う。Backend は開票回定義を持たないため、指定 `election_id` を **保存用ラベル** として扱い、開票回定義との照合を行わない（Req 9.1）。DynamoDB から当該 `election_id` の票レコードを読み取り、**集計はせずレコード一覧をそのまま返す**。集計（総数・有効/無効・候補者別得票）は Frontend が行う（Req 9.3〜9.5）。

```typescript
// backend/src/modules/results.ts
import type { VoteRecordSummary } from "@tegaki/shared";

/**
 * 指定 election_id を持つ票レコード一覧を返す（Req 9.1 / 9.2）。
 * - Backend は集計しない。matched_candidate・is_valid 等を含むレコード一覧を返すのみ。
 * - 指定 election_id を持つレコードが存在しない場合は空配列を返す（Req 9.2）。
 * - election_id は保存ラベルとして扱い、開票回定義との照合は行わない（Req 9.1）。
 */
export function readVotesByElection(
  electionId: string,
): Promise<VoteRecordSummary[]>;
```

v1 の読み取りは `Votes_Table` のスキャン + `election_id` フィルタで実装する。将来の効率化のための GSI は後付け可能（Data Models 参照）。集計ロジックは Backend には持たず、フロント側の純粋関数 `tally(votes): ElectionResults` として `frontend/` に実装する（Frontend セクション / Testing Strategy 参照）。

---

## API 契約

すべての契約型は `shared/types.ts` に定義し、frontend / backend が参照する。

### POST /votes

**Request**（Requirement 3.2 / 3.3 / 4.2）:

```json
{
  "image": "<base64 encoded PNG>",
  "election_id": "round-1",
  "candidates": [
    { "id": "candidate-1", "name": "まるまる" },
    { "id": "candidate-2", "name": "バツバツ" },
    { "id": "candidate-3", "name": "三角三角" }
  ]
}
```

フロントは `election_id` にアクティブ開票回の `activeElectionId` を、`candidates` にアクティブ開票回の `Candidate_List` を含めて送信する（Requirement 2.3 / 2.4 / 3.3）。Backend は `candidates` をそのまま判定基準に用いる（Requirement 5.1）。

**Response 200**（Requirement 7.1）:

```json
{
  "vote_id": "3f2a9c1e-...",
  "recognized_text": "まるまる",
  "matched_candidate": "まるまる",
  "is_valid": true,
  "confidence": 0.92,
  "reason": "候補者リストの『まるまる』と一致",
  "created_at": "2026-04-01T12:34:56Z"
}
```

無効票の例（`is_valid=false`、`matched_candidate=null`、`recognized_text` は判読不能時 null）:

```json
{
  "vote_id": "8b7d...",
  "recognized_text": "しかく",
  "matched_candidate": null,
  "is_valid": false,
  "confidence": 0.61,
  "reason": "いずれの候補者とも一致しなかった",
  "created_at": "2026-04-01T12:35:10Z"
}
```

`election_id` は保存用ラベルとして非空チェックのみ行い、開票回定義との照合は行わない（Requirement 4.6）。`election_id` フィールドが欠落・空の場合は入力不正として 400 `VALIDATION_ERROR`（Requirement 4.5）。`candidates` フィールドが欠落・非配列・要素が `id`/`name` を持たない場合も 400 `VALIDATION_ERROR`（Requirement 4.7）。受け取った `candidates` が構成的に不正（空・`id` 重複・`name` 長）な場合は判定前段で 400 `LIST_INVALID`（Requirement 5.2）。

### GET /elections/{election_id}/results

Backend は指定 `election_id` を保存用ラベルとして扱い、**当該 `election_id` を持つ票レコード一覧を返す**（集計は行わない, Requirement 9.1）。集計（総数・有効/無効・候補者別得票）は Frontend が行う（Requirement 9.3〜9.5）。

**Response 200**（Requirement 9.1 / 9.2）:

```json
{
  "election_id": "round-1",
  "votes": [
    { "vote_id": "3f2a9c1e-...", "matched_candidate": "まるまる", "is_valid": true },
    { "vote_id": "8b7d...", "matched_candidate": null, "is_valid": false },
    { "vote_id": "1c4e...", "matched_candidate": "バツバツ", "is_valid": true }
  ]
}
```

各レコードはフロント集計に必要な `matched_candidate` と `is_valid` を中心に、識別のための `vote_id` を含む票レコード（`VoteRecordSummary`）である。指定 `election_id` を持つ票レコードが存在しない場合は空配列 `"votes": []` を返す（Requirement 9.2）。Backend は開票回定義を持たないため、未知 election_id でも照合・拒否は行わず、単に該当レコードなし（空配列）として扱う。

### エラーレスポンス形式

全エラーは共通ボディ形式を返す。

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "election_id は必須です"
  }
}
```

| HTTP ステータス | code | 発生源 | 関連 Requirement |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | 入力不正（JSON 不正 / 画像欠落・非 PNG / election_id 欠落・空 / candidates 形式不正 / 5MB 超） | 4.3〜4.5, 4.7, 4.8, 4.9 |
| 400 | `LIST_INVALID` | 受け取った candidates の構成不正（空 / id 重複 / name 長） | 5.2 |
| 502 | `ANALYSIS_FAILED` | 上流 LLM 起因の解析失敗（JSON 不正 / タイムアウト / リトライ全滅） | 5.9, 5.10, 8.1 |
| 500 | `STORAGE_FAILED` | 保存失敗（S3 / DynamoDB、リトライ全滅） | 6.7, 6.8, 8.2, 8.3 |

**election_id の扱い（設計判断）**: Backend は開票回定義を持たないため、投票時（POST /votes）・開票時（GET results）ともに `election_id` を **保存用ラベル** として受け入れ、開票回定義との照合や未知 election_id の拒否（NOT_FOUND）は行わない（Req 4.6 / 9.1）。`election_id` フィールド自体の欠落・空のみ入力形式の不備として `VALIDATION_ERROR`/400（Req 4.5）とする。GET results では、指定 election_id を持つレコードがなければ空配列を返す（Req 9.2）。

**candidates 不正のマッピング（設計判断）**: `candidates` の **形式不正**（欠落・非配列・要素が id/name を持たない）は受付検証段階で `VALIDATION_ERROR`/400（Req 4.7）。受け取った `candidates` の **構成不正**（空・id 重複・name 長）は判定前段の Analyzer で `LIST_INVALID`/400（Req 5.2）。要件末尾の未決事項（VALIDATION_ERROR とするか LIST_INVALID とするか）は、形式検証＝VALIDATION_ERROR・構成検証＝LIST_INVALID という切り分けで確定する。

**CONFIG_INVALID の扱い（設計判断）**: Elections_Config はフロント専用のため、その検証はフロントの **ビルド時** に行われ（`validateElectionsConfig`）、Backend の API レスポンスには現れない。設定不正は Frontend のビルド失敗として提示され（Data Models 参照）、`ErrorResponse.code` には含めない（Backend が返さないため）。

---

## Data Models

### shared/types.ts

```typescript
// shared/types.ts — 型定義・契約のみ（実行ロジックを含まない）

export interface Candidate {
  id: string;    // 一意（Req 10.6）
  name: string;  // 1〜50 文字の非空文字列（Req 10.6）
}

/** 開票回（Election）。election_id・タイトル・Candidate_List を持つ（Req 10.1 / 10.5） */
export interface Election {
  election_id: string;                 // 一意（Req 10.5）例: "round-1"
  title: string;                       // 表示名（アクティブ開票回の固定表示, Req 2.1）
  candidates: readonly Candidate[];    // 当該 Election の Candidate_List（Req 10.1）
}

/** POST /votes リクエスト契約 */
export interface VoteRequest {
  image: string;               // base64 PNG
  election_id: string;         // アクティブ開票回の election_id（= activeElectionId, Req 2.3 / 3.3）保存ラベル
  candidates: Candidate[];     // アクティブ開票回の Candidate_List（Req 2.4 / 3.3）。Backend が判定基準に用いる（Req 5.1）
}

/** Analyzer が正規化して出力する解析結果（保存前の内部型） */
export interface AnalyzedVote {
  recognized_text: string | null;
  matched_candidate: string | null;
  is_valid: boolean;
  confidence: number;   // 0.0〜1.0 に正規化済み
  reason: string;
}

/** POST /votes 200 レスポンス契約（Req 7.1） */
export interface VoteResult extends AnalyzedVote {
  vote_id: string;
  created_at: string;   // ISO 8601 UTC
}

/** DynamoDB Votes_Table の 1 レコード */
export interface VoteRecord extends VoteResult {
  election_id: string;
  image_key: string;    // S3 オブジェクトキー
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
  total: number;        // = valid + invalid
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
```

**設計判断（型の配置）**: `VoteRequest`・`VoteRecordSummary`・`ElectionResultsResponse`・`ErrorResponse` は API 契約であり `shared/types.ts` に置く（`candidates` は設定データではなく契約の一部）。集計結果型 `ElectionResults` / `CandidateTally` は、集計をフロントが行うためフロント側の型として `frontend/` に置いてもよいが、want 要件で backend との将来的な再利用余地を残し、本設計では `shared/types.ts` に残置してフロントが生成する扱いとする（実行ロジックは含まないため疎結合に反しない）。

### frontend/src/config/elections.config.json（Elections_Config: フロント専用設定ファイル）

Election 群とアクティブ開票回は **フロントエンド専用の設定ファイル `frontend/src/config/elections.config.json`（Elections_Config）** で管理する（Req 10.1 / 10.2 / 10.3）。この設定は Backend には存在せず、Backend は開票回・候補者の定義を持たない。アプリケーション保有者（管理者）はこの JSON を編集して Frontend をデプロイすることで開票回・候補者を差し替え、`activeElectionId` を編集して現在の開票回を切り替える（UI 管理画面なし）。スキーマはトップレベルがオブジェクトで、`activeElectionId`（文字列）と `elections`（Election の配列）を並置する。各 Election は `election_id`（文字列）・`title`（文字列）・`candidates`（`{ id, name }` の配列）を持つ。`activeElectionId` は `elections` 内のいずれかの `election_id` を指す（Req 10.9）。第1回（`round-1`）はサンプル候補者を定義し、第2回（`round-2`）・第3回（`round-3`）は保有者が後から候補者を追加する空プレースホルダ（`"candidates": []`）とする。初期の `activeElectionId` は `round-1`。

```json
// frontend/src/config/elections.config.json（Elections_Config）— 保有者が編集・デプロイするフロント専用設定ファイル
{
  "activeElectionId": "round-1",
  "elections": [
    {
      "election_id": "round-1",
      "title": "第1回 開票",
      "candidates": [
        { "id": "candidate-1", "name": "まるまる" },
        { "id": "candidate-2", "name": "バツバツ" },
        { "id": "candidate-3", "name": "三角三角" }
      ]
    },
    {
      "election_id": "round-2",
      "title": "第2回 開票",
      "candidates": []
    },
    {
      "election_id": "round-3",
      "title": "第3回 開票",
      "candidates": []
    }
  ]
}
```

### frontend/src/config/elections.ts（Elections_Config ローダ / 検証 / Election ルックアップ — フロント専用）

`frontend/src/config/elections.ts` は、`elections.config.json` を **JSON import で取り込み、形状（Elections_Config スキーマ）・`election_id` 一意性・`activeElectionId` と `elections` の整合を検証したうえで、型付きの `elections: Election[]` と `activeElectionId: string` として公開する**フロント専用ローダである（Req 10.1 / 10.3 / 10.7 / 10.8 / 10.9）。JSON の取り込みは TypeScript の `resolveJsonModule`（`tsconfig.json` で有効化）による import で行う（環境により import assertion `with { type: "json" }` を用いてもよい。実装しやすい方を採用する）。検証関数 `parseElectionsConfig` / `validateElectionsConfig` は **副作用・I/O を持たない純粋関数** である（JSON の import 自体はビルド / バンドルが解決する）。型 `Election` / `Candidate` は `@tegaki/shared` から import する（契約は shared、設定データとローダは frontend）。

フロント（Vite）のみがこの JSON を import でバンドルに取り込む（**ビルド時**）。Backend はこの設定を参照せず、開票回・候補者の定義を一切持たない。実行時の外部 I/O は行わず、設定はビルド / バンドル時に固められる。

```typescript
// frontend/src/config/elections.ts — フロント専用の設定ローダ・検証・純粋な参照ヘルパ（Req 10.1 / 10.3 / 10.7 / 10.8）
import type { Election } from "@tegaki/shared";
// tsconfig の resolveJsonModule により JSON を import で取り込む（ビルド/バンドルが解決）
import electionsConfig from "./elections.config.json";

/** Elections_Config スキーマ検証の結果 */
export type ConfigValidationResult =
  | { ok: true; activeElectionId: string; elections: Election[] }
  | { ok: false; code: "CONFIG_INVALID"; message: string };

/**
 * Elections_Config（未検証の unknown）を検証し、妥当なら型付きの
 * { activeElectionId, elections } を返す純粋関数。
 * 検証項目（Req 10.3 / 10.5 / 10.6 / 10.7 / 10.8 / 10.9）:
 * - トップレベルがオブジェクトであること（オブジェクトでない/JSON 不正は取り込み時点で失敗）
 * - activeElectionId が非空文字列であること
 * - elections が配列であること
 * - 各 Election が election_id（非空文字列）・title（非空文字列）・candidates（配列）を持つ
 * - election_id が elections 内で一意（重複は CONFIG_INVALID, Req 10.5）
 * - 各 Candidate が一意な id と 1〜50 文字の非空 name を持つ（Req 10.6 / 10.8）
 * - activeElectionId が elections 内のいずれかの election_id と一致（不一致は CONFIG_INVALID, Req 10.7 / 10.9）
 * この関数は副作用・I/O を持たない。フロント専用（Backend は Elections_Config を持たない）。
 */
export function validateElectionsConfig(raw: unknown): ConfigValidationResult;

/**
 * 検証を実行し、妥当なら { activeElectionId, elections } を返す。不正なら設定不正エラーを投げる。
 * Frontend のビルド時（バンドル評価時）に呼ばれ、
 * 不正な設定（activeElectionId 欠落・不整合、election_id 重複・必須フィールド欠落・JSON 形状不正）を
 * 検出する（Req 10.7 / 10.8）。
 */
export function parseElectionsConfig(
  raw: unknown,
): { activeElectionId: string; elections: Election[] } {
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
    throw new Error(`Elections_Config 設定不正: activeElectionId '${activeElectionId}' が elections に存在しません`);
  }
  return election;
}
```

**設定不正の検出（Req 10.7 / 10.8 / 10.9）**: `validateElectionsConfig` は、JSON が読み込めない / 形状が不正（トップレベルがオブジェクトでない、`activeElectionId` が非空文字列でない、`elections` が配列でない、各 Election の必須フィールド `election_id`・`title`・`candidates` の欠落）、`election_id` が重複する、各 Candidate の `id` が重複するもしくは `name` が 1〜50 文字でない、または **`activeElectionId` が `elections` のいずれの `election_id` とも一致しない** 設定を **不正** と判定する（`CONFIG_INVALID`）。`parseElectionsConfig` はビルド時（バンドル評価時）にこれを実行し、不正なら例外を投げて設定不正を検出する。これにより Frontend はビルド時に不正な設定を早期に検出する（Req 10.7 / 10.8）。この検証はフロント専用であり、Backend の API レスポンスには現れない。

**Candidate_List が空のプレースホルダ Election の扱い**: `round-2` / `round-3` は候補者未定義（空配列）である。空リストはフロントの Elections_Config スキーマ検証（`validateElectionsConfig`）では許容される（スキーマ上 `candidates` は配列であればよく、Req 10.8 の name 長検証は要素があるときのみ適用）。ただしこの状態で当該開票回の投票が Backend に届いた場合、Backend は受け取った `candidates`（空）を判定前段の構成検証で `LIST_INVALID`（空リスト）として弾く（Req 5.2）。候補者を設定ファイルに定義してから運用に供する前提とする。

### DynamoDB: Votes_Table スキーマ

| 属性 | 型 | 説明 | Requirement |
|---|---|---|---|
| `vote_id` (PK) | String (UUID) | パーティションキー。一意 | 6.3, 6.4 |
| `election_id` | String | 開票回識別子 | 6.4 |
| `image_key` | String | S3 画像キー | 6.2, 6.4 |
| `recognized_text` | String \| Null | 読み取りテキスト（判読不能時 null） | 6.4 |
| `matched_candidate` | String \| Null | 一致候補者名（なしは null） | 6.4, 6.5 |
| `is_valid` | Boolean | 有効票判定 | 6.4 |
| `confidence` | Number | 0.0〜1.0 | 6.4 |
| `reason` | String | 判定理由 | 6.4 |
| `created_at` | String | ISO 8601 UTC | 6.4, 6.6 |

**将来の GSI（後付け可能）**: 開票（Requirement 9）の票レコード読み取りを効率化するため、`election_id` をパーティションキーとする GSI を後から追加できる。v1 ではスキャン + フィルタで十分（デモ規模・想定 ~50 人）だが、スキーマは GSI 追加をそのまま許容する形（`election_id` を全レコードが保持）で設計済みである。Backend は指定 `election_id` の票レコード一覧（`matched_candidate`・`is_valid` を含む）を返すのみで、集計（`is_valid=true` を `matched_candidate` ごとにカウント）は Frontend が行う（Requirement 9.3〜9.5）。

### S3: Image_Store

- 手書き画像 PNG を保管。オブジェクトキーは `votes/{election_id}/{vote_id}.png` 形式。
- 非公開バケット（Security セクション参照）。

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

以下は、prework 分析で PROPERTY / EDGE_CASE に分類し、冗長性を排除した確定 correctness properties である。各プロパティは property-based testing で検証する。UI 描画・外部サービス配線・構造制約（INTEGRATION / SMOKE / 一部の EXAMPLE）は Testing Strategy 側でユニット / 統合 / E2E テストとして扱う。

### Property 1: 有効なリクエストは検証を通過し復号値・candidates を返す

*For any* `image` が有効な base64 PNG（先頭マジックナンバー一致）かつ復号後サイズ 5MB 以下で、`election_id` が非空文字列で、`candidates` が各要素に `id` と `name` を持つ配列である JSON リクエストボディについて、`validateVoteRequest` は `ok: true` を返し、返される画像 Buffer は入力 base64 をデコードしたバイト列と一致し、`electionId` は入力の `election_id` と一致し（照合はせず保存ラベルとして受理）、返される `candidates` は入力の `candidates` と一致する。

**Validates: Requirements 4.2, 4.6**

### Property 2: 不正なリクエストは必ず拒否される

*For any* 次のいずれかに該当するリクエストボディ — (a) 有効な JSON でない、または空文字列（Req 4.9）、(b) `image` フィールド欠落または空（Req 4.3）、(c) `election_id` フィールド欠落または空（Req 4.5）、(d) `candidates` フィールド欠落、配列でない、またはいずれかの要素が `id` もしくは `name` を持たない（Req 4.7）、(e) `image` が base64 PNG として復号できない（Req 4.4）、(f) 復号後サイズが 5MB を超える（Req 4.8） — について、`validateVoteRequest` は `ok: false` かつ `code: "VALIDATION_ERROR"` を返し、画像・electionId・candidates を下流へ渡さない。

**Validates: Requirements 4.3, 4.4, 4.5, 4.7, 4.8, 4.9**

### Property 3: 構成不正な candidates は判定されず LIST_INVALID になる

*For any* 検証済みリクエスト（形式は妥当）で受け取った `candidates` について、リストが空である、重複した `id` を含む、またはいずれかの `name` が空もしくは 50 文字超である場合、Analyzer は判定前段の構成検証で `ok: false` かつ `code: "LIST_INVALID"` を返し、有効票判定を実行せず Bedrock を呼び出さない。空でも重複でもなくすべての `name` が 1〜50 文字の非空である場合にのみ構成検証を通過する。

**Validates: Requirements 5.2**

### Property 4: 有効票判定は受け取った候補者リストへの所属と一致する

*For any* リクエストで受け取った `candidates`（Candidate_List）と Bedrock 生応答について、正規化後の confidence が 0.5 以上である場合、`is_valid` が true であることと `matched_candidate` が受け取った `candidates` の名前集合に含まれることは同値である。さらに `is_valid` が false のとき `matched_candidate` は null である。

**Validates: Requirements 5.1, 5.4, 5.5**

### Property 5: 低信頼度は判読不能として無効化される

*For any* Bedrock 生応答について、正規化後の confidence が 0.0 以上 0.5 未満である場合、正規化結果は `recognized_text = null`、`matched_candidate = null`、`is_valid = false` となる。

**Validates: Requirements 5.6**

### Property 6: confidence は常に [0.0, 1.0] に正規化され、欠落・範囲外は無効化される

*For any* Bedrock 生応答について、正規化後の `confidence` は常に 0.0 以上 1.0 以下の数値である。かつ、生応答の confidence が欠落している、または 0.0 未満もしくは 1.0 超であった場合、正規化後の `confidence` は 0.0 となり `is_valid = false` となる。

**Validates: Requirements 5.7, 5.8**

### Property 7: 不正な LLM 応答は解析失敗として扱われる

*For any* 有効な JSON でない、または `recognized_text` / `matched_candidate` / `is_valid` / `confidence` / `reason` のいずれかが欠落している Bedrock 生応答について、正規化は `ok: false` かつ `code: "ANALYSIS_FAILED"` を返す。

**Validates: Requirements 5.9**

### Property 8: 解析失敗時は一切の永続化が行われない

*For any* 検証済みリクエストについて、Analyzer が解析失敗（`ANALYSIS_FAILED`）を返す場合、Image_Store への保存も Votes_Table への書き込みも一切行われない。

**Validates: Requirements 8.1**

### Property 9: vote_id は一意な UUID である

*For any* 生成回数 N について、生成された N 個の `vote_id` はすべて有効な UUID 形式であり、かつ相互に重複しない。

**Validates: Requirements 6.3**

### Property 10: 保存レコードは全属性を正しく保持する

*For any* 正規化済み `AnalyzedVote`、`election_id`、S3 画像キーについて、Storage が構築する Votes_Table レコードは `vote_id`、`election_id`、`image_key`、`recognized_text`、`matched_candidate`、`is_valid`、`confidence`、`reason`、`created_at` のすべての属性を含み、各値は入力に対応する。`matched_candidate` が存在しない入力では null として格納され、`created_at` は ISO 8601 UTC 形式（`YYYY-MM-DDThh:mm:ssZ`）である。

**Validates: Requirements 6.4, 6.5, 6.6**

### Property 11: 保存失敗時は部分データが残らない（ロールバック）

*For any* 入力について、画像保存成功後に Votes_Table 書き込みが失敗した場合、保存済みの S3 画像は削除され、`STORAGE_FAILED` が返される。処理完了後に当該投票の部分的なデータ（DDB 項目なしの S3 画像、または画像なしの DDB 項目）は残らない。

**Validates: Requirements 6.8, 8.2**

### Property 12: 200 レスポンスボディは契約を満たす

*For any* 保存まで成功したパイプライン結果について、返される `VoteResult` は `vote_id`、`recognized_text`、`matched_candidate`、`is_valid`、`confidence`、`reason`、`created_at` を含み、`is_valid` は真偽値、`confidence` は 0.0 以上 1.0 以下の数値である。

**Validates: Requirements 7.1**

### Property 13: confidence のパーセント変換は 0〜100 に収まる

*For any* 0.0 以上 1.0 以下の `confidence` について、フロントの表示変換 `round(confidence * 100)` は 0 以上 100 以下の整数となる。

**Validates: Requirements 7.4, 11.4**

### Property 14: フロント集計の総数保存則

*For any* `VoteRecordSummary` の集合について、フロント側 `tally` の結果は `total === valid + invalid` を満たし、`valid` は `is_valid = true` の件数、`invalid` は `is_valid = false` の件数に一致する。

**Validates: Requirements 9.3**

### Property 15: フロント集計は有効票のみを候補者ごとに降順で計上する

*For any* `VoteRecordSummary` の集合について、フロント側 `tally` の結果の `tally` の各要素の `count` は当該 `matched_candidate` を持つ `is_valid = true` の投票数に等しく、`is_valid = false` の投票は集計に一切現れず、`count` の総和は `valid` に等しく、要素は `count` の降順（非増加順）に並ぶ。投票が空集合の場合は `total = valid = invalid = 0` かつ `tally = []` となる。

**Validates: Requirements 9.4, 9.5**

### Property 16: 線幅は 1〜10px にクランプされる

*For any* 要求された線幅の数値について、Canvas に適用される線幅は 1 以上 10 以下にクランプされる（マウス・タッチのいずれの入力源でも同一）。

**Validates: Requirements 1.2, 1.3**

### Property 17: フロント Elections_Config スキーマ検証は妥当な設定のみを受理する

*For any* Elections_Config 候補（`{ activeElectionId, elections }` 相当オブジェクトについて、`activeElectionId` の有無・空否・`elections` 内 `election_id` との整合、各 Election のフィールド有無・`election_id` の重複有無、各 Candidate の `id` 重複・`name` 長をランダムに変えたもの）について、フロント専用の `validateElectionsConfig` は、(a) トップレベルがオブジェクトであり、(b) `activeElectionId` が非空文字列であり、(c) `elections` が配列であり、(d) 各 Election が非空文字列の `election_id` と非空文字列の `title` と配列 `candidates` を持ち、(e) `election_id` が `elections` 内で一意であり、(f) 各 Election の `candidates` の各要素が一意な `id` と 1〜50 文字の非空 `name` を持ち、(g) `activeElectionId` が `elections` 内のいずれかの `election_id` と一致する、これらをすべて満たす設定のみを妥当（`ok: true`）と判定する。逆に、トップレベルがオブジェクトでない・`activeElectionId` が欠落もしくは空・`elections` が配列でない・いずれかの必須フィールド（`election_id` / `title` / `candidates`）が欠落している・`election_id` が重複する・`candidate id` が重複する・`name` が 1〜50 文字でない・`activeElectionId` が `elections` のいずれの `election_id` とも一致しない、これらのいずれかに該当する設定は不正（`ok: false`, `code: "CONFIG_INVALID"`）と判定する。特に、**`activeElectionId` が `elections` のいずれの `election_id` とも一致しない設定は `CONFIG_INVALID` である**。

**Validates: Requirements 10.3, 10.5, 10.6, 10.7, 10.8, 10.9**

---

## Error Handling

### ステータスコード表

| 発生源 | 条件 | HTTP | code | Backend 動作 | 関連 Req |
|---|---|---|---|---|---|
| 入力検証 | JSON 不正 / 画像欠落・非 PNG / election_id 欠落・空 / candidates 形式不正 / 5MB 超 | 400 | `VALIDATION_ERROR` | 解析・保存を行わない | 4.3〜4.5, 4.7, 4.8, 4.9 |
| 候補者リスト構成 | 受け取った candidates が 空 / id 重複 / name 長不正 | 400 | `LIST_INVALID` | Bedrock を呼ばない | 5.2 |
| 解析（上流 LLM） | JSON 不正 / 必須欠落 / タイムアウト(30s) / リトライ全滅(2回) | 502 | `ANALYSIS_FAILED` | S3・DDB 保存を行わない。エラーは 1 秒以内に返す | 5.9, 5.10, 8.1 |
| 保存 | S3 失敗 / DDB 失敗（リトライ全滅 3回） | 500 | `STORAGE_FAILED` | DDB 失敗時は S3 画像を削除しロールバック | 6.7, 6.8, 8.2, 8.3 |

エラーボディは全ケース共通: `{ "error": { "code": "...", "message": "..." } }`。

**election_id の扱い**: Backend は開票回定義を持たないため、投票時・開票時ともに `election_id` を保存ラベルとして受理し、未知 election_id の `NOT_FOUND` 拒否は行わない（Req 4.6 / 9.1）。GET results で該当レコードがなければ空配列を返す（Req 9.2）。

**CONFIG_INVALID の扱い**: Elections_Config はフロント専用のため、その検証（`validateElectionsConfig`）は Frontend の **ビルド時** に行われ、設定不正はビルド失敗として提示される（Req 10.7 / 10.8）。Backend の API レスポンスには `CONFIG_INVALID` は現れない。

### タイムアウト・リトライ値

| 対象 | 値 | 根拠 |
|---|---|---|
| Bedrock 呼び出しタイムアウト | 30 秒 | Req 5.10, 8.1 |
| Bedrock リトライ | 最大 2 回 | Req 5.10 |
| 保存（S3 / DynamoDB）リトライ | 最大 3 回 | Req 8.3 |
| フロント通信タイムアウト | 35 秒 | Req 8.5 |
| フロント成功応答期限（失敗表示トリガ） | 10 秒 | Req 3.7, 11.5 |

### フロント側のエラー種別表示

Backend のエラー `code`（および通信タイムアウト）を、投票者向けの分かりやすいメッセージに変換して 5 秒以内に表示する（Requirement 8.4）。表示後は直前の表示状態を保持し「投票」ボタンを再操作可能に戻す（Requirement 3.7, 11.5）。

| 状況 | code / 事象 | フロント表示 |
|---|---|---|
| 受付停止中（設定不正） | クライアント検証（activeElectionId が Elections に無い） | 「現在、投票を受け付けていません」 |
| 入力不正 | `VALIDATION_ERROR` | 「送信内容に問題があります。もう一度手書きしてください」 |
| 候補者リスト構成不正 | `LIST_INVALID` (400) | 「送信内容に問題があります。もう一度お試しください」 |
| 解析失敗 | `ANALYSIS_FAILED` (502) | 「解析に失敗しました。もう一度お試しください」 |
| 保存失敗 | `STORAGE_FAILED` (500) | 「投票の保存に失敗しました。もう一度お試しください」 |
| 通信タイムアウト | 35 秒無応答 | 「通信がタイムアウトしました」 |
| 未入力 | クライアント検証 | 「候補者名を手書きしてください」 |

**設計判断**: 旧「開票回未選択」種別・投票時の「対象の開票回なし（NOT_FOUND）」種別は、Backend が election_id を照合しなくなったため削除した。代わりに、`activeElectionId` が Elections のいずれの `election_id` にも該当しない設定不正時の「受付停止中（設定不正）」種別を維持し、投票不可のフォールバック表示（Req 2.5）に対応させる。この設定不正はフロントのビルド時検証でも検出される。`candidates` の構成不正（`LIST_INVALID`）は通常はフロントの設定検証で事前に弾かれるため運用上はまれだが、Backend からの応答として受け取る可能性を考慮し種別を用意する。

---

## Testing Strategy

### 方針

- **Unit tests**: 具体例・エッジケース・エラー条件を検証（UI 分岐、外部呼び出し配線、境界値）。
- **Property tests**: Correctness Properties セクションの各プロパティを、全入力にわたって検証。
- **Integration / E2E tests**: 外部サービス（Bedrock / S3 / DynamoDB）との配線・レイテンシ・エンドツーエンドの動作を代表例で検証。

本機能には純粋ロジック（backend の入力検証・candidates 構成検証・解析結果の正規化、frontend の開票集計 tally・Elections_Config 検証・confidence 変換）が多く含まれるため PBT が有効である。一方で UI 描画・タイミング・外部サービス配線（Bedrock/S3/DynamoDB）は PBT に不向きなため、ユニット / 統合 / E2E で扱う。特に Backend の票レコード読み取り（DynamoDB 依存・集計なし）は統合テストで扱う。

### Property-Based Testing

- ライブラリは **fast-check**（TypeScript）を採用する。自前実装はしない。
- 各プロパティテストは **最小 100 回の反復**（`{ numRuns: 100 }` 以上）で実行する。
- 各プロパティテストには対応する設計プロパティを参照するコメントを付与する。
  - タグ形式: `// Feature: tegaki-vote-app, Property {number}: {property_text}`
- 各 Correctness Property は **単一の** property-based テストで実装する。

| Property | 対象モジュール | 主なジェネレータ |
|---|---|---|
| 1, 2 | `receiver.validateVoteRequest`（backend） | 有効/無効な JSON・base64・PNG バイト列・サイズ境界・candidates 形式（有無/非配列/id・name 欠落） |
| 3 | `analyzer.validateCandidateList` + Analyzer 入口（Bedrock モック） | ランダム candidates（空/重複id/name 長）、Bedrock 未呼び出しを検査 |
| 4, 5, 6, 7 | `analyzer.normalizeAnalysis`（backend, Bedrock はモック） | 受け取った candidates 集合 + LLM 生応答（フィールド有無・confidence 範囲内外） |
| 8 | Analyzer→Storage 連携（backend, S3/DDB モック） | 解析失敗を注入し呼び出し記録を検査 |
| 9 | `vote_id` 生成（backend） | 反復回数 N |
| 10 | `storage.buildRecord`（backend） | ランダム `AnalyzedVote` + election_id + key |
| 11 | `storage.store`（backend, S3/DDB モック） | DDB 失敗注入、put/delete 呼び出し記録 |
| 12 | パイプライン成功結果ビルダ（backend） | ランダム成功結果 |
| 13 | フロント confidence 変換（frontend） | [0,1] の乱数 |
| 14, 15 | `frontend tally`（フロント集計関数） | ランダム `VoteRecordSummary[]`（空集合含む） |
| 16 | Canvas 線幅クランプ（frontend） | 任意数値 |
| 17 | `frontend config.validateElectionsConfig`（フロント Elections_Config スキーマ検証） | ランダムな Elections_Config 候補（妥当/トップレベル非オブジェクト/activeElectionId 欠落・空/elections 非配列/必須フィールド欠落/election_id 重複/candidate id 重複/name 長不正/activeElectionId が elections と不整合） |

### Unit / Integration / E2E の役割分担

- **Unit（例・エッジ）**: UI 分岐（Req 1.1, 1.4〜1.6, 3.1〜3.8, 7.2, 7.3, 7.5, 8.4, 8.5, 11.5）、アクティブ開票回表示コンポーネント（`ActiveElectionBanner`）が `getActiveElection()` の Election のタイトルと Candidate_List を固定表示すること、および `activeElectionId` 設定不正時の投票不可・受付停止フォールバック表示（Req 2.1, 2.2, 2.5）、投票時に election_id と candidates をリクエストへ含めること（Req 2.3, 2.4, 3.3）、リトライ回数（Req 5.10, 6.7, 8.3）。React 側は React Testing Library、タイマー系は fake timers を使用。
- **Integration**: Bedrock 呼び出し配線とプロンプト内容（受け取った candidates を渡すこと, Req 5.1）、S3 保存・キー取得（Req 6.1, 6.2）、`GET /elections/{election_id}/results` が指定 election_id の票レコード一覧を返し、該当なしで空配列を返すこと（集計しないこと, Req 9.1, 9.2）。**Bedrock は必ずモック**し、コストと非決定性を排除する。DynamoDB は **DynamoDB Local** を用いて実接続に近い検証を行う（moto 等の代替も可）。S3 は `aws-sdk-client-mock` 等でモック。
- **構造制約（SMOKE / static）**: monorepo ディレクトリ存在（Req 11.1）、frontend↔backend 直接 import なし（Req 11.2、依存グラフ / lint ルールで検査）、`shared/` が型・契約のみで設定データ・ローダ・実行ロジックを含まない（Req 11.3、静的検査）、Elections がフロント専用設定ファイル `frontend/src/config/elections.config.json`（Elections_Config）で管理され Backend が開票回・候補者定義を持たず Elections_Config を参照しない構成（Req 10.1, 10.2、コードに Election をハードコードしていないこと・backend が Elections を参照しないことを静的検査）。加えて、実際の `frontend/src/config/elections.config.json` が `parseElectionsConfig` の検証を通過すること（同梱設定の妥当性。`activeElectionId` が `elections` 内の `election_id` を指すことを含む）をフロントのビルド時に確認する smoke テストを置く。設定形式の妥当性検証そのもの（election_id 一意・必須フィールド具備・candidate id 一意・name 長・activeElectionId 整合、Req 10.3, 10.5, 10.6, 10.7, 10.8, 10.9）は Property 17 で網羅的に検証する。
- **E2E**: ブラウザから CloudFront 経由の静的配信、アクティブ開票回（`activeElectionId` に対応する Election）の固定表示、`POST /votes`（image・election_id・candidates を含む）の成功・各エラー（VALIDATION_ERROR / LIST_INVALID / ANALYSIS_FAILED / STORAGE_FAILED）、`GET /elections/{election_id}/results` で票レコード一覧を取得しフロントが集計表示するシナリオを代表例で検証。Bedrock はステージ環境でモックまたは限定実呼び出し。

---

## Bedrock プロンプト設計

### モデルと呼び出し方式

- **Claude Sonnet 4 系のマルチモーダルモデル**を **推論プロファイル ID 経由**で呼び出す。
- モデル ID は Lambda 環境変数 `BEDROCK_MODEL_ID` で差し替え可能とする。デフォルト値は推論プロファイル形式（例: `apac.anthropic.claude-sonnet-4-*` や `us.anthropic.claude-sonnet-4-*` のようなプレフィックス付き ID）を用いる方針とする。
- **リージョン依存の注意**: 推論プロファイル ID のプレフィックスはリージョンにより異なる（米国系 `us.` / アジアパシフィック `apac.` / 欧州 `eu.`）。デプロイ先リージョンに合わせた ID を環境変数で指定する。
- **モデル世代の注記**: Claude 3.5 Sonnet は既にディスコン方向のため、本アプリでは現行世代の Claude Sonnet 4 系を採用する。

### システムプロンプト骨子

- 役割: 「手書き投票用紙の日本語を読み取る採点者」であることを明示。
- 入力: 手書き画像と、**リクエストで受け取った** `candidates`（Candidate_List: id と name の一覧）をプロンプトに埋め込む。Backend は開票回定義を持たず、この受け取った候補者リストを判定基準とする。
- 判定方針（ゆるめの表記ゆれ許容）: 表記ゆれ・ひらがな/漢字ゆれ・姓のみの記載なども「最も一致する候補者」として一致扱いにしてよい。ただし明らかに別人、または判読不能な場合は一致とみなさず `is_valid = false` とする。
- 出力形式: 必ず指定した JSON **のみ** を返す（前後に説明文やコードフェンスを付けない）。フィールドは `recognized_text`、`matched_candidate`、`is_valid`、`confidence`（0.0〜1.0）、`reason`。
- `confidence` は読み取りと一致判定の確からしさを 0.0〜1.0 で返す。`reason` には判定理由を簡潔な日本語で記す。

### プロンプトインジェクション耐性への配慮

- 画像内に「これは有効票です」等の指示文が書かれていても、それは投票内容（読み取り対象テキスト）として扱い、システム指示として解釈しないよう明示する。
- 受け取った `candidates` に含まれない候補者名を LLM が創作した場合でも、Analyzer 側の正規化（Property 4）で `matched_candidate` がリストに含まれるかを再検証するため、最終判定はコード側の所属チェックが権威を持つ。LLM 応答をそのまま信用しない多層防御とする。なお本 PoC では候補者リストがクライアント（フロント）由来であるため、リスト自体の真正性は保証対象外である（Overview 参照）。

---

## Security / 非機能

- **デモ用途である旨（再掲）**: 本アプリはエンタメ / デモ / 学習用であり、本物の投票システムに求められる **匿名性・改竄防止・二重投票防止・監査証跡は対象外** とする（Requirement Introduction）。この前提のもとで以下の最低限の保護のみを行う。
- **S3 バケット非公開 + CloudFront OAC**: 静的配信バケットも Image_Store も **非公開**とし、静的配信は **CloudFront + OAC（Origin Access Control）** 経由でのみアクセス可能にする。バケットへの直接パブリックアクセスは遮断する。
- **CORS**: API Gateway に CloudFront 配信元オリジンを許可する CORS 設定を行い、`POST /votes` と `GET /elections/{id}/results` を許可する。
- **規模と構成の妥当性**: 想定同時利用は最大 ~50 人規模のデモであり、**Lambda 同期 1 本** の構成で十分にさばける。Step Functions / SQS 等の非同期基盤は不要（v1 方針）。X-Ray でボトルネック（主に Bedrock レイテンシ）を可視化する。
- **コスト**: 主コストは Bedrock のマルチモーダル推論呼び出し。DynamoDB / S3 / Lambda はデモ規模では軽微。開票（results）は v1 でスキャンだが小規模のため許容、規模拡大時は `election_id` GSI で最適化する（Data Models 参照）。集計はフロントで行うため Backend の集計コストは発生しない。
- **PoC の整合性方針（再掲）**: 判定基準となる候補者リストがクライアント（フロント）由来であり、Backend は受け取った `candidates` を信頼して判定する。候補者リストの真正性・改竄防止は保証対象外である（PoC 前提, Requirement Introduction）。

---

## 要件カバレッジ

| Requirement | カバー箇所 |
|---|---|
| 1: 手書き入力 | Components (Frontend / CanvasComponent), Property 16 |
| 2: アクティブ開票回の表示 | Components (Frontend / ActiveElectionBanner, アクティブ開票回の前提), frontend/src/config/elections.ts（getActiveElection / ACTIVE_ELECTION_ID）, API 契約（candidates 送信）, Testing Strategy(Unit) |
| 3: 投票の送信 | Components (Frontend 状態遷移, election_id + candidates 送信), API 契約, Error Handling |
| 4: 受付と検証 | Components (Receiver_Module: candidates 形式検証・election_id 非空チェック・照合なし), Property 1, 2, API 契約, Error Handling |
| 5: 解析と有効票判定 | Components (Analyzer_Module: 受け取った candidates で判定・構成検証), Property 3, 4〜7, Bedrock プロンプト設計 |
| 6: 投票結果の保存 | Components (Storage_Module), Property 9, 10, 11, Data Models |
| 7: 投票結果の応答 | Components (Frontend ResultView), API 契約, Property 12, 13 |
| 8: エラーハンドリング | Error Handling, Property 8, 11 |
| 9: 開票結果表示（Backend は票レコード一覧を返す / フロント集計） | Components (Backend Results 読み取り, Frontend ResultsView + tally), API 契約（票レコード一覧）, Property 14, 15, Data Models(GSI), Testing Strategy(Integration) |
| 10: 開票回設定の管理（フロントエンド専用, activeElectionId 管理を含む） | frontend/src/config/elections.config.json（Elections_Config: activeElectionId + elections）+ frontend/src/config/elections.ts（parseElectionsConfig / validateElectionsConfig ローダ・検証, findElection, getActiveElection, ACTIVE_ELECTION_ID）, Data Models, Components (Frontend), Property 17, Testing Strategy(構造制約 / 設定妥当性 smoke), Error Handling(CONFIG_INVALID はフロントビルド時) |
| 11: モノレポ構成と疎結合（shared は型・契約のみ） | リポジトリ構成, shared/types.ts（型・API 契約のみ）, Property 13, Testing Strategy(構造制約) |
