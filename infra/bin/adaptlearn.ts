#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AdaptLearnStack } from '../lib/adaptlearn-stack';

const app = new cdk.App();
new AdaptLearnStack(app, 'AdaptLearnStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'AdaptLearn static web application, API, identity, storage, and Bedrock knowledge base.',
});
