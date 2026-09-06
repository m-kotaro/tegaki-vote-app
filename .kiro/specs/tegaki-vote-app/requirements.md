# Requirements Document

## Introduction

手書き投票デモアプリ（tegaki-vote-app）は、日本語の候補者名を手書きし、AI（Amazon Bedrock マルチモーダル LLM）で解析して「有効票 / 無効票」を判定する、エンタメ / デモ / 学習用のネタアプリである。選挙の投票用紙をモチーフとし、ブラウザ上の Canvas に候補者名を手書きして「投票」すると、バックエンドが画像を解析し、候補者リストとの一致可否から有効票かどうかを判定して結果を返す。

本アプリはデモ用途であり、本物の投票システムに求められる匿名性・改竄防止・二重投票防止・監査証跡は対象外とする。ただし将来の開票結果表示（want 要件）を「読むだけ」で追加できるよう、書き込み時のデータスキーマは初期段階から正しく設計する。

本アプリは PoC（概念実証）であり、シンプルで理解しやすい構成を優先する。開票回・候補者の定義（Elections_Config）はフロントエンド専用で保持し、投票時に候補者リスト（Candidate_List）をリクエストへ含めて Backend へ渡す簡素な構成を採用する。この構成では、判定基準となる候補者リストの真正性をクライアント入力に依存するため、エンタープライズ的な整合性・信頼性の保証は対象外とする。

技術スタックは、フロントエンドが React + Vite + Canvas API + Framer Motion、ホスティングが S3 + CloudFront、バックエンドが Lambda（受付 / 解析 / 保存を内部モジュール分割）、解析が Amazon Bedrock マルチモーダル LLM（Claude 系）、データストアが DynamoDB、画像保管が S3 である。v1 は Lambda 同期 1 本の構成とし、Step Functions / SQS は採用しない。

## Glossary

- **手書き投票デモアプリ / System**: 本アプリ全体。フロントエンド、バックエンド、データストアを含む総称。
- **Frontend**: ブラウザ上で動作する React + Vite アプリケーション。Canvas による手書き入力と投票操作の UI を提供する。
- **Canvas_Component**: フロントエンド内で手書き入力を受け付ける描画領域。タッチ操作とマウスドラッグに対応する。
- **Backend**: API Gateway 経由で呼び出される Lambda。受付・解析・保存の 3 モジュールで構成される。
- **Receiver_Module**: バックエンド内で投票リクエストの受付と入力検証を担うモジュール。
- **Analyzer_Module**: バックエンド内で画像を Bedrock LLM に渡し、解析結果を取得するモジュール。
- **Storage_Module**: バックエンド内で画像を S3 に、投票結果を DynamoDB に保存するモジュール。
- **Bedrock_LLM**: Amazon Bedrock 上のマルチモーダル大規模言語モデル（Claude 系）。手書き画像から日本語テキストを読み取り、候補者との一致判定を JSON 形式で返す。
- **Election（開票回）**: 1 つの投票・開票の単位。election_id、タイトル（表示名）、Candidate_List を持つ。忘年会の会場投票など複数のシーンに流用するため、複数の Election が定義される。
- **Elections_Config（開票回設定）**: フロントエンドが保持する設定ファイル（elections.config.json）。定義済みの Election 群（各 election_id・タイトル・Candidate_List）に加えて、現在投票を受け付けているアクティブな開票回を示す activeElectionId を保持する。フロントエンド専用であり、Backend は参照しない。コードにハードコードせず、アプリケーション保有者（管理者）がリポジトリ内の設定ファイルを編集して Frontend をデプロイすることで開票回・候補者を差し替え、activeElectionId を編集することで現在の開票回を切り替える。UI の管理画面は設けない。
- **activeElectionId（アクティブ開票回）**: 現在投票を受け付けている開票回の election_id。フロントエンド専用の Elections_Config で管理者が指定する。Elections 内のいずれかの Election の election_id を指す。投票者は変更できず、Frontend はこの activeElectionId に対応する Election を固定表示する。
- **Election_List / Elections**: 定義済みの Election の一覧。フロントエンド専用の Elections_Config（設定ファイル）から Frontend がビルド時に読み込む。Backend は Elections を参照・保持しない。
- **Candidate_List**: 各 Election が保持する候補者一覧。Election ごとに異なる。Frontend が Elections_Config から保持し、投票時に POST /votes リクエストへ candidates として含めて Backend へ渡す。Backend は候補者リストを保持・検証せず、リクエストで受け取ったものを判定に使用する。
- **Candidate**: 候補者。id と name を持つ。
- **VoteResult**: 投票 1 件の解析・判定結果。vote_id、recognized_text、matched_candidate（null 可）、is_valid、confidence、reason、created_at を持つ。
- **Votes_Table**: DynamoDB のテーブル。PK は vote_id（UUID）。投票結果を保存する。
- **Image_Store**: S3 バケット。手書き画像を保管する。
- **recognized_text**: Bedrock_LLM が手書き画像から読み取った日本語テキスト。
- **matched_candidate**: recognized_text に最も一致した候補者名。一致なしの場合は null。
- **is_valid**: 投票が有効票か無効票かを表す真偽値。候補者リストと一致した場合 true。
- **confidence**: Bedrock_LLM が返す判定の信頼度。0.0〜1.0 の範囲の数値。
- **election_id**: 各 Election を一意に識別する文字列（例: "round-1"、"round-2"、"round-3"）。
- **Results_View**: 指定した Election（開票回）の開票結果を表示する機能。want 要件。Backend は指定 election_id の票レコード一覧を返し、総投票数・有効票数・無効票数・候補者ごとの得票の集計は Frontend が行う。

## Requirements

### Requirement 1: 手書き入力

**User Story:** 投票者として、候補者名をブラウザ上で手書きしたい。丸や記号の選択ではなく、実際に文字を書く投票体験を得るため。

#### Acceptance Criteria

1. THE Frontend SHALL 選挙の投票用紙を模した画面と、幅 300 ピクセル以上かつ高さ 200 ピクセル以上の Canvas_Component を表示する
2. WHEN 投票者がタッチ操作で Canvas_Component 上をなぞる, THE Canvas_Component SHALL なぞった軌跡を、太さ 1 ピクセル以上 10 ピクセル以下の連続した線として描画する
3. WHEN 投票者がマウスドラッグで Canvas_Component 上をなぞる, THE Canvas_Component SHALL なぞった軌跡を、太さ 1 ピクセル以上 10 ピクセル以下の連続した線として描画する
4. WHEN 投票者が消去操作を実行する, THE Frontend SHALL Canvas_Component 上の描画済みの手書き内容をすべて消去し、Canvas_Component を空の状態に戻す
5. WHEN 投票者が画像取得操作を実行する, THE Canvas_Component SHALL 描画された手書き内容を PNG 形式の画像データとして返す
6. IF Canvas_Component に手書き内容が描画されていない状態で画像取得操作が実行される, THEN THE Canvas_Component SHALL 画像を返さず、手書き内容が未入力である旨を示すエラー通知を投票者に提示する

### Requirement 2: アクティブ開票回の表示

**User Story:** 投票者として、現在受け付けている開票回のタイトルと候補者を確認したい。管理者が設定した開票回に対して投票するため。開票回の選択は管理者が設定ファイルで行い、投票者は選べない。

#### Acceptance Criteria

1. THE Frontend SHALL フロントエンド専用の Elections_Config で指定された activeElectionId に対応する Election（アクティブ開票回）のタイトルと Candidate_List を固定表示する
2. THE Frontend SHALL アクティブ開票回を固定表示し、投票者がアクティブ開票回を変更する手段を提供しない
3. THE Frontend SHALL 投票時に activeElectionId を POST /votes リクエストの election_id として含める
4. THE Frontend SHALL 投票時にアクティブ開票回の Candidate_List を POST /votes リクエストの candidates として含める
5. IF activeElectionId が Elections_Config の Elections のいずれの Election の election_id にも該当しない, THEN THE Frontend SHALL 投票を送信できる状態にせず、現在投票を受け付けられない旨を表示する

### Requirement 3: 投票の送信

**User Story:** 投票者として、手書きした候補者名を「投票」ボタンで送信したい。書いた内容を投票として登録するため。

#### Acceptance Criteria

1. THE Frontend SHALL 投票を送信する「投票」ボタンを表示する
2. WHEN 投票者が「投票」ボタンを操作し、かつ Canvas_Component に手書き内容が存在する, THE Frontend SHALL Canvas_Component の手書き内容を base64 エンコードされた PNG 画像として POST /votes リクエストに含めて Backend へ送信する
3. WHEN 投票者が「投票」ボタンを操作し、かつ Canvas_Component に手書き内容が存在する, THE Frontend SHALL activeElectionId を election_id として、かつアクティブ開票回の Candidate_List を candidates としてリクエストに含めて Backend へ送信する
4. WHEN 投票リクエストが Backend へ送信される, THE Frontend SHALL 投票アニメーションを 3 秒以内に再生を開始する
5. WHILE Backend からの応答を待機している, THE Frontend SHALL 「開票中...」を示す状態表示を行い、「投票」ボタンを操作不可にする
6. IF Canvas_Component に手書き内容が存在しない状態で「投票」ボタンが操作される, THEN THE Frontend SHALL 投票を送信せず、手書き入力を促すメッセージを表示する
7. IF 投票リクエストの送信後 10 秒以内に Backend から成功応答が返らない、または Backend がエラー応答を返す, THEN THE Frontend SHALL 「開票中...」の状態表示を終了し、送信に失敗したことを示すメッセージを表示し、「投票」ボタンを再度操作可能な状態に戻す
8. WHEN Backend から投票登録の成功応答を受信する, THE Frontend SHALL 「開票中...」の状態表示を終了し、投票が登録されたことを示す結果表示を行う

### Requirement 4: 投票リクエストの受付と検証

**User Story:** システム運用者として、受け取った投票リクエストを検証したい。不正な入力を早期に弾き、後続の解析処理を保護するため。

#### Acceptance Criteria

1. THE Receiver_Module SHALL API Gateway 経由で POST /votes リクエストを受け付ける
2. WHEN POST /votes リクエストを受け付ける, THE Receiver_Module SHALL リクエストに base64 エンコードされた PNG 画像、非空の election_id、および candidates が含まれることを検証する
3. IF リクエストに画像フィールドが含まれない、または画像フィールドが空である, THEN THE Receiver_Module SHALL 解析を行わず、投票を記録せず、入力不正を示すエラーレスポンスを返す
4. IF リクエストの画像が base64 エンコードされた PNG 画像として復号できない, THEN THE Receiver_Module SHALL 解析を行わず、投票を記録せず、入力不正を示すエラーレスポンスを返す
5. IF リクエストに election_id フィールドが含まれない、または election_id が空である, THEN THE Receiver_Module SHALL 解析を行わず、投票を記録せず、入力不正を示すエラーレスポンスを返す
6. WHEN リクエストの election_id を受け付ける, THE Receiver_Module SHALL election_id を保存用のラベルとして受け入れ、開票回定義との照合を行わない
7. IF リクエストに candidates フィールドが含まれない、candidates が配列でない、または candidates のいずれかの要素が id と name を持たない, THEN THE Receiver_Module SHALL 解析を行わず、投票を記録せず、入力不正を示すエラーレスポンスを返す
8. IF 復号後の画像サイズが 5 MB を超える, THEN THE Receiver_Module SHALL 解析を行わず、投票を記録せず、入力不正を示すエラーレスポンスを返す
9. IF リクエストボディが有効な JSON として解釈できない、または空である, THEN THE Receiver_Module SHALL 解析を行わず、投票を記録せず、入力不正を示すエラーレスポンスを返す

### Requirement 5: 画像の解析と有効票判定

**User Story:** システム運用者として、手書き画像を AI で解析し候補者リストとの一致から有効票か判定したい。手書き投票の判定を自動化するため。

#### Acceptance Criteria

1. WHEN 検証済みの投票リクエストを処理する, THE Analyzer_Module SHALL 手書き画像と、リクエストで受け取った candidates（Candidate_List）を Bedrock_LLM へ渡す
2. IF リクエストで受け取った candidates が空である、重複した id を含む、または name が 1 文字未満もしくは 50 文字超である, THEN THE Analyzer_Module SHALL 有効票判定を実行せず、候補者リスト構成が不正である旨を示すエラー情報を呼び出し元へ返す
3. THE Analyzer_Module SHALL Bedrock_LLM に対し recognized_text、matched_candidate、is_valid、confidence、reason を含む JSON 形式のみで応答するよう指示する
4. IF recognized_text が受け取った candidates のいずれかの候補者と一致する, THEN THE Analyzer_Module SHALL matched_candidate に一致した候補者名を設定し、is_valid を true とする
5. IF recognized_text が受け取った candidates のいずれの候補者とも一致しない, THEN THE Analyzer_Module SHALL matched_candidate を null とし、is_valid を false とする
6. IF confidence が 0.5 未満である, THEN THE Analyzer_Module SHALL 手書き画像を判読不能とみなし、recognized_text を null、matched_candidate を null、is_valid を false とする
7. THE Analyzer_Module SHALL confidence を 0.0 以上 1.0 以下の数値として取得する
8. IF Bedrock_LLM から confidence が欠落している、または 0.0 未満もしくは 1.0 超の値が返される, THEN THE Analyzer_Module SHALL confidence を 0.0 として扱い、is_valid を false とする
9. IF Bedrock_LLM の応答が有効な JSON 形式でない、または recognized_text、matched_candidate、is_valid、confidence、reason のいずれかが欠落している, THEN THE Analyzer_Module SHALL 当該投票リクエストの判定を失敗として扱い、is_valid を false とし、解析失敗を示すエラー情報を呼び出し元へ返す
10. IF Bedrock_LLM への呼び出しが 30 秒以内に完了しない、またはエラー応答を返す, THEN THE Analyzer_Module SHALL 最大 2 回まで再試行し、すべての試行が失敗した場合は当該投票リクエストの判定を失敗として扱い、解析失敗を示すエラー情報を呼び出し元へ返す

### Requirement 6: 投票結果の保存

**User Story:** システム運用者として、投票の画像と判定結果を保存したい。後から開票結果を集計できるようにするため。

#### Acceptance Criteria

1. WHEN 解析が完了する, THE Storage_Module SHALL 手書き画像を Image_Store に保存する
2. WHEN 手書き画像の保存が成功する, THE Storage_Module SHALL 保存された画像の S3 キーを取得する
3. WHEN 解析が完了する, THE Storage_Module SHALL vote_id として一意な UUID を生成する
4. WHEN 投票結果を保存する, THE Storage_Module SHALL vote_id、election_id、S3 画像キー、recognized_text、matched_candidate、is_valid、confidence、reason、created_at を新規項目として Votes_Table に書き込む
5. WHERE matched_candidate が存在しない, THE Storage_Module SHALL matched_candidate を null として Votes_Table に書き込む
6. THE Storage_Module SHALL created_at を ISO 8601 形式（YYYY-MM-DDThh:mm:ssZ、UTC）のタイムスタンプとして書き込む
7. IF 手書き画像の Image_Store への保存が失敗する, THEN THE Storage_Module SHALL Votes_Table への書き込みを行わず、保存失敗を示すエラーを呼び出し元に返す
8. IF 投票結果の Votes_Table への書き込みが失敗する, THEN THE Storage_Module SHALL Image_Store に保存済みの手書き画像を削除し、保存失敗を示すエラーを呼び出し元に返す

### Requirement 7: 投票結果の応答

**User Story:** 投票者として、投票した結果（有効票か無効票か）を即座に確認したい。自分の手書きが正しく判定されたか知るため。

#### Acceptance Criteria

1. WHEN 投票結果の保存が完了する, THE Backend SHALL リクエスト受信から 3 秒以内に、vote_id、recognized_text、matched_candidate、is_valid（true または false）、confidence（0.00 から 1.00 の範囲の数値）、reason、created_at を含む 200 レスポンスを返す
2. WHEN is_valid が true を含む 200 レスポンスを受け取る, THE Frontend SHALL 有効票である旨の判定結果を表示する
3. WHEN is_valid が false を含む 200 レスポンスを受け取る, THE Frontend SHALL 無効票である旨の判定結果と reason の内容を表示する
4. WHEN 200 レスポンスを受け取る, THE Frontend SHALL matched_candidate と、confidence を 0 から 100 パーセントに変換した値を含む判定内容を表示する
5. IF 投票結果の応答が 200 以外である、または 3 秒以内に応答を受信できない, THEN THE Frontend SHALL 判定結果を確定表示せず、結果を取得できなかった旨のエラー内容を表示する

### Requirement 8: エラーハンドリング

**User Story:** 投票者として、処理が失敗したときに状況を把握したい。何が起きたか分からないまま待たされないため。

#### Acceptance Criteria

1. IF Bedrock_LLM による解析が 30 秒以内に完了しない、または解析エラーを返す, THEN THE Backend SHALL 処理を中止し、解析失敗を示すエラーレスポンスを 1 秒以内に返し、当該投票の Image_Store および Votes_Table への保存を行わない
2. IF Image_Store または Votes_Table への保存が失敗する, THEN THE Backend SHALL 保存失敗を示すエラーレスポンスを返し、当該投票に関する部分的なデータを保持せずロールバックする
3. IF Backend への保存処理が最大 3 回の再試行後も失敗する, THEN THE Backend SHALL 再試行を打ち切り、保存失敗を示すエラーレスポンスを返す
4. WHEN Backend がエラーレスポンスを返す, THE Frontend SHALL 5 秒以内に、発生したエラーの種別（解析失敗または保存失敗）を示すメッセージを投票者に表示する
5. WHEN Backend からのレスポンスが 35 秒以内に受信されない, THE Frontend SHALL 処理待ちを打ち切り、通信タイムアウトが発生したことを示すメッセージを投票者に表示する

### Requirement 9: 開票結果表示（want）

**User Story:** 観覧者として、指定した開票回の開票結果を確認したい。誰が何票獲得したかを把握するため。

#### Acceptance Criteria

1. WHEN GET /elections/{election_id}/results リクエストを受け付ける, THE Backend SHALL 指定 election_id を保存用ラベルとして扱い、開票回定義との照合を行わず、当該 election_id を持つ票レコード一覧（各レコードは matched_candidate、is_valid を含む）を返す
2. WHERE 指定 election_id を持つ票レコードが存在しない, THE Backend SHALL 空の票レコード一覧（空配列）を返す
3. WHEN Backend から票レコード一覧を受信する, THE Frontend SHALL 総投票数、有効票数、無効票数を集計する。ここで総投票数 = 有効票数 + 無効票数 とする
4. WHEN Frontend が開票結果を集計する, THE Frontend SHALL is_valid が true の票を matched_candidate ごとに集計し、候補者ごとの得票数を得票数の降順で表示する
5. WHEN Frontend が開票結果を集計する, THE Frontend SHALL is_valid が false の票を候補者ごとの得票集計から除外し、無効票数としてのみ計上する

### Requirement 10: 開票回設定の管理（フロントエンド専用）

**User Story:** アプリケーション保有者（管理者）として、複数の開票回とそれぞれの候補者リストをフロントエンドの設定ファイルで一元管理したい。UI の管理画面を作らず、設定ファイルの編集と Frontend のデプロイだけで開票回・候補者を差し替えるため。

#### Acceptance Criteria

1. THE Frontend SHALL 開票回（Election）群と、アクティブな開票回を示す activeElectionId の両方をフロントエンド専用の Elections_Config（設定ファイル elections.config.json）として保持し、アプリケーション保有者が設定ファイルを編集・デプロイすることで管理する（コードにハードコードしない）
2. THE Backend SHALL 開票回（Election）および候補者の定義を保持せず、Elections_Config を参照しない
3. THE Frontend SHALL Elections_Config を ビルド時に読み込む
4. THE Frontend SHALL Elections_Config に activeElectionId を保持し、アプリケーション保有者が activeElectionId を編集してアクティブな開票回を切り替える
5. THE Frontend SHALL 各 Election の election_id を一意とする
6. THE Candidate SHALL 一意の id と、1 文字以上 50 文字以下の非空文字列である name を持つ
7. IF activeElectionId が Elections のいずれの Election の election_id にも該当しない, THEN THE Frontend SHALL ビルド時の検証で設定不正として検出し、設定不正を示すエラーを提示する
8. IF Elections_Config が読み込めない、または妥当な形式（activeElectionId が存在し Elections 内の election_id を指し、各 Election が election_id・タイトル・Candidate_List を持ち、election_id が一意で、各 Candidate_List が非空かつ重複しない id を持ち、各 name が 1 文字以上 50 文字以下である）でない, THEN THE Frontend SHALL ビルド時の検証で設定不正を検出し、設定不正を示すエラーを提示する
9. WHEN アプリケーション保有者が Elections_Config を差し替えて Frontend をデプロイする, THE Frontend SHALL 次回のデプロイ時に新しい Election 定義および activeElectionId を参照する

### Requirement 11: モノレポ構成と疎結合

**User Story:** 開発者として、フロントとバックを疎結合に保ちたい。それぞれを独立して変更・保守できるようにするため。

#### Acceptance Criteria

1. THE System SHALL frontend、backend、infra、shared の 4 つのトップレベルディレクトリを持つモノレポとして構成される
2. THE Frontend と THE Backend SHALL 直接的なコード参照やモジュールインポートを行わず、HTTP API のみを通じて通信する
3. THE shared ディレクトリ SHALL 型定義、定数、API 契約のみを保持し、開票回設定データ（Elections_Config）や設定ローダを含まず、実行ロジック（関数実装、状態管理、副作用を伴う処理）を含まない
4. WHEN Frontend が Backend から API レスポンスを受信する, THE Frontend SHALL 当該レスポンスを表示に必要な形へ整形する
5. IF Backend が API リクエストに対してエラー応答を返した、または応答が 10 秒以内に得られない, THEN THE Frontend SHALL 通信失敗を示すエラー表示を行い、直前の表示状態を保持する

## 未決事項（設計フェーズで決定する）

以下は設計フェーズで解決すべき事項であり、要件の内容には影響しないが記録として残す。

- バックエンド言語: TypeScript 統一 or Python
- IaC: SAM or CDK
- 開票回（Election）ごとの候補者の人数と具体名。開票回を複数（例: 第1回 / 第2回 / 第3回）定義し、各開票回が独自の Candidate_List を持つ。これらはフロントエンド専用の Elections_Config（設定ファイル）で管理する。第1回はサンプルの具体名（例: まるまる / バツバツ / 三角三角）を設定ファイルに定義し、第2回・第3回はアプリケーション保有者が後から設定ファイルで候補者を追加する
- Elections_Config（設定ファイル）の具体的なファイル名・配置パス（frontend 配下に置く）・JSON スキーマ（フィールド構造）、および Frontend のビルド時取り込みの具体的な手段。activeElectionId をスキーマ上どう位置づけるか（例: `{ activeElectionId, elections }` 形式でトップレベルに activeElectionId と Election 群を並置する）の詳細は設計フェーズ（design.md）で確定する。要件は「管理者が activeElectionId で指定し投票者は選べない」「Backend は開票回定義を持たない」という振る舞いに集中する
- POST /votes の API 契約詳細（image・election_id に加えて candidates をどのような形式・スキーマでリクエストに含めるか）の詳細は設計フェーズ（design.md）で確定する
- candidates の構成不正時に返すエラーの分類（受付検証段階の VALIDATION_ERROR とするか、判定前段の LIST_INVALID とするか）の切り分けは設計フェーズで確定する
- 表記ゆれの許容度（厳密一致寄り or ゆるめ）
- Bedrock の利用モデル ID（Claude 系のどれか）
- エラーレスポンスの具体的な設計（ステータスコード・ボディ形式）
