#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { StaticHostingStack } from '../lib/static-hosting-stack.js';
import { ApiStack } from '../lib/api-stack.js';

const app = new App();

// 環境（account / region）は cdk コンテキストまたは環境変数から解決する。
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// 静的配信スタック（S3 + CloudFront OAC）。
new StaticHostingStack(app, 'TegakiVoteStaticHostingStack', { env });

// API/バックエンドスタック（API Gateway + Lambda + DynamoDB + S3 + Bedrock + X-Ray）。
// CORS の allowedOrigins は未指定（デモ用途で全許可）。本番相当では静的配信の
// CloudFront ドメインを渡してオリジンを絞る。
new ApiStack(app, 'TegakiVoteApiStack', { env });

app.synth();
