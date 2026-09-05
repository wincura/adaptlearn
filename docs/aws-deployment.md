# AWS deployment

The `infra/` CDK application provisions AdaptLearn's private static website bucket, CloudFront distribution with Origin Access Control, API Gateway and Lambda, Cognito user pool, DynamoDB workspace table, document upload bucket, and Bedrock Nova model permissions.

## Prerequisites

- AWS CLI v2 authenticated with the intended SSO profile.
- CDK bootstrap completed once per account and Region: `npx --prefix infra cdk bootstrap`.
- Bedrock access enabled for `amazon.nova-2-lite-v1:0` in the deployment Region.

## Deploy

### E2B sandbox credential

`keys/key.txt` is git-ignored and is never included in the Lambda bundle. The deployment script reads its `E2B_API_KEY=e2b_...` entry locally and passes it to the Lambda environment. Alternatively, export `E2B_API_KEY` before deploying.

For GitHub Actions, add an environment secret named `E2B_API_KEY` to the `aws-production` environment. The workflow injects that secret during deployment. Do not commit this key or add it to a GitHub repository variable.

This hackathon-oriented setup stores the value as a Lambda environment variable. For a production deployment, move it to AWS Secrets Manager and grant the Lambda permission to read that secret.

From the repository root:

```bash
export AWS_PROFILE=your-sso-profile
export AWS_REGION=ap-southeast-1
export CDK_DEFAULT_REGION="$AWS_REGION"
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
./scripts/deploy-aws.sh
```

The deployment script builds `dist/`, deploys it privately to S3, and invalidates CloudFront through CDK's `BucketDeployment` resource.

## Optional Knowledge Base

S3 Vectors and the Bedrock Knowledge Base are disabled by default so this stack can deploy in the Innovation Sandbox. After the sandbox administrator allows `s3vectors` actions, create them with:

```bash
npm --prefix infra run deploy -- -c enableKnowledgeBase=true
```

## Important current boundary

The stack deploys Cognito and the AWS data resources, and Lambda uses DynamoDB workspace storage plus Bedrock model invocation. The browser authentication flow, direct S3 uploads, and Bedrock Knowledge Base repository adapter still need application-level integration before treating the deployment as production-ready. Do not make user-isolation guarantees until API routes derive the learner ID from a verified Cognito JWT.
