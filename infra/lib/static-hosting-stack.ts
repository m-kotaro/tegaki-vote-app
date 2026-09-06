import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

/**
 * 静的配信スタック（Requirement 11.1 / Security セクション）。
 *
 * - 非公開 S3 バケット（パブリックアクセスを全ブロック）にフロントエンド資産を格納する。
 * - CloudFront ディストリビューション + OAC（Origin Access Control）経由でのみ S3 へアクセスさせる。
 * - バケットへの直接パブリックアクセスは遮断し、CloudFront OAC 経由のみ許可する
 *   （`S3BucketOrigin.withOriginAccessControl` がバケットポリシーを自動生成する）。
 * - React SPA 想定のため、デフォルトルートオブジェクトを index.html とし、
 *   403/404 を index.html にフォールバックする。
 */
export class StaticHostingStack extends Stack {
  /** フロントエンド資産を格納する非公開バケット。 */
  public readonly siteBucket: s3.Bucket;

  /** OAC 経由で siteBucket を配信する CloudFront ディストリビューション。 */
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 非公開 S3 バケット: パブリックアクセスを全ブロック、暗号化・SSL 強制。
    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // デモ用途: スタック削除時にバケットも破棄しオブジェクトも自動削除する。
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront ディストリビューション + OAC（Origin Access Control）。
    // withOriginAccessControl は現行の推奨 API で、OAC を作成しバケットポリシーへ
    // CloudFront 経由アクセスのみ許可する条件付きステートメントを自動付与する。
    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket);

    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // SPA 用フォールバック: S3 が返す 403/404 を index.html（200）へ書き換える。
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
      ],
    });

    new CfnOutput(this, 'SiteBucketName', {
      value: this.siteBucket.bucketName,
      description: '静的配信用の非公開 S3 バケット名',
    });

    new CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront ディストリビューションのドメイン名',
    });

    new CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront ディストリビューション ID',
    });
  }
}
