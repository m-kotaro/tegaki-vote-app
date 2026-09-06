import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';

// ESM のため __dirname 相当をファイル URL から解決する。
const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * バックエンド Lambda が呼び出す Bedrock モデル ID（推論プロファイル ID）。
 * design.md「Bedrock プロンプト設計」および backend の DEFAULT_BEDROCK_MODEL_ID に合わせる。
 * デプロイ先リージョンに応じて `us.` / `apac.` / `eu.` プレフィックスへ変更する
 * （props.bedrockModelId で差し替え可能）。
 */
const DEFAULT_BEDROCK_MODEL_ID = 'apac.anthropic.claude-sonnet-4-20250514-v1:0';

export interface ApiStackProps extends StackProps {
  /**
   * CORS で許可するオリジン。design.md Security: CloudFront 配信元オリジンを許可する。
   * v1 のデモ用途のため未指定時は全オリジン許可（緩め）。本番相当では CloudFront の
   * ドメイン（例: https://xxxx.cloudfront.net）を明示する。
   */
  readonly allowedOrigins?: string[];

  /** Bedrock モデル ID（推論プロファイル ID）。未指定時は DEFAULT_BEDROCK_MODEL_ID。 */
  readonly bedrockModelId?: string;
}

/**
 * API / バックエンドスタック（Requirement 4.1 / 6.1 / 6.4 / 9.1、design.md Architecture / API 経路）。
 *
 * 構成要素:
 * - Votes_Table（DynamoDB, PK=vote_id, オンデマンド課金）… 投票レコードの保存（Req 6.4）
 * - Image_Store（S3, 非公開バケット）… 手書き画像 PNG の保管（Req 6.1）
 * - Backend Lambda（Node.js 20, NodejsFunction/esbuild バンドル）… Receiver→Analyzer→Storage（Req 4.1）
 * - REST API Gateway（CORS, POST /votes・GET /elections/{election_id}/results）… HTTP エンドポイント（Req 4.1 / 9.1）
 * - IAM 権限（DynamoDB 読み書き / S3 読み書き / Bedrock InvokeModel）
 * - X-Ray トレース（Lambda + API Gateway）… 受付→解析→保存フローの可視化（design.md トレーサビリティ）
 */
export class ApiStack extends Stack {
  /** 投票レコードを保存する DynamoDB テーブル（PK=vote_id）。 */
  public readonly votesTable: dynamodb.Table;

  /** 手書き画像を保管する非公開 S3 バケット。 */
  public readonly imageBucket: s3.Bucket;

  /** バックエンド処理を担う Lambda 関数。 */
  public readonly handler: NodejsFunction;

  /** POST /votes・GET results を提供する REST API。 */
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: ApiStackProps) {
    super(scope, id, props);

    const bedrockModelId = props?.bedrockModelId ?? DEFAULT_BEDROCK_MODEL_ID;

    // -----------------------------------------------------------------------
    // Votes_Table（DynamoDB）: PK=vote_id、オンデマンド課金（Req 6.4）。
    // 将来の election_id GSI は設計上後付け可能だが v1 では不要（design.md Data Models）。
    // -----------------------------------------------------------------------
    this.votesTable = new dynamodb.Table(this, 'VotesTable', {
      partitionKey: { name: 'vote_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // デモ用途: スタック削除時にテーブルも破棄する。
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: false,
    });

    // -----------------------------------------------------------------------
    // Image_Store（S3）: 非公開バケット（パブリックアクセス全ブロック, Req 6.1 / Security）。
    // 手書き画像はキー `votes/{election_id}/{vote_id}.png` で保管する（storage.ts）。
    // -----------------------------------------------------------------------
    this.imageBucket = new s3.Bucket(this, 'ImageStore', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // デモ用途: スタック削除時にバケットも破棄しオブジェクトも自動削除する。
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -----------------------------------------------------------------------
    // Backend Lambda（Node.js 20, NodejsFunction/esbuild バンドル, X-Ray 有効）。
    //
    // エントリは backend のソース handler.ts を指定し、esbuild にバンドルさせる。
    // workspace 依存（@tegaki/shared, @tegaki/backend）はソース参照で追われバンドルされる。
    // AWS SDK v3（@aws-sdk/*）は Lambda ランタイム（Node.js 20）に同梱されるため external 化し、
    // バンドルサイズとコールドスタートを抑える。format は ESM（backend は "type": "module"）。
    // -----------------------------------------------------------------------
    const handlerEntry = path.join(currentDir, '..', '..', 'backend', 'src', 'handler.ts');

    this.handler = new NodejsFunction(this, 'BackendHandler', {
      entry: handlerEntry,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      // Bedrock マルチモーダル呼び出し（最大 30s）+ リトライを見込んで余裕を持たせる。
      timeout: Duration.seconds(60),
      memorySize: 512,
      // X-Ray トレースを有効化（design.md トレーサビリティ）。
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        IMAGE_BUCKET: this.imageBucket.bucketName,
        VOTES_TABLE: this.votesTable.tableName,
        BEDROCK_MODEL_ID: bedrockModelId,
        // AWS SDK v3 の X-Ray 計装（下流呼び出しのトレース）を有効化する。
        AWS_XRAY_CONTEXT_MISSING: 'IGNORE_ERROR',
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node20',
        sourceMap: true,
        // AWS SDK v3 は Lambda Node.js 20 ランタイムに同梱されるため external 化する。
        externalModules: ['@aws-sdk/*'],
        // ESM 出力で __dirname 等が参照された場合のフォールバック定義。
        banner:
          "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
      },
    });

    // -----------------------------------------------------------------------
    // IAM 権限（最小権限）。
    // - Votes_Table への読み書き（Storage の書き込み / results のスキャン読み取り）
    // - Image_Store への読み書き（画像保存 / ロールバック削除）
    // - Bedrock InvokeModel（マルチモーダル解析）。推論プロファイル ID / foundation model
    //   双方の ARN パターンを許可する。
    // -----------------------------------------------------------------------
    this.votesTable.grantReadWriteData(this.handler);
    this.imageBucket.grantReadWrite(this.handler);

    // Bedrock InvokeModel: 推論プロファイル（inference-profile）とその背後の
    // foundation-model の双方を許可する。推論プロファイル経由の呼び出しは両方の
    // リソースへのアクセスを必要とする。
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
          'arn:aws:bedrock:*::foundation-model/*',
        ],
      }),
    );

    // -----------------------------------------------------------------------
    // REST API Gateway（CORS, X-Ray 有効）。
    // ルート: POST /votes, GET /elections/{election_id}/results（Lambda プロキシ統合）。
    // -----------------------------------------------------------------------
    // design.md Security: CloudFront 配信元オリジンを許可する。デモ用途では緩めに全許可。
    const allowedOrigins = props?.allowedOrigins ?? apigateway.Cors.ALL_ORIGINS;

    this.api = new apigateway.RestApi(this, 'VoteApi', {
      restApiName: 'tegaki-vote-api',
      description: '手書き投票デモ API（POST /votes, GET /elections/{id}/results）',
      deployOptions: {
        // API Gateway の X-Ray トレースを有効化（design.md トレーサビリティ）。
        tracingEnabled: true,
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
      },
    });

    const integration = new apigateway.LambdaIntegration(this.handler, {
      proxy: true,
    });

    // POST /votes
    const votes = this.api.root.addResource('votes');
    votes.addMethod('POST', integration);

    // GET /elections/{election_id}/results
    const elections = this.api.root.addResource('elections');
    const election = elections.addResource('{election_id}');
    const results = election.addResource('results');
    results.addMethod('GET', integration);

    // -----------------------------------------------------------------------
    // 出力（動作確認・フロント配線用）。
    // -----------------------------------------------------------------------
    new CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'REST API のベース URL（POST {url}votes 等）',
    });
    new CfnOutput(this, 'VotesTableName', {
      value: this.votesTable.tableName,
      description: 'Votes_Table（DynamoDB）のテーブル名',
    });
    new CfnOutput(this, 'ImageBucketName', {
      value: this.imageBucket.bucketName,
      description: 'Image_Store（S3）のバケット名',
    });
  }
}
