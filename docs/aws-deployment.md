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

## Guest sessions and Cognito

The app starts in guest mode. Each browser receives a random HttpOnly, SameSite=Lax cookie, Secure over HTTPS, renewed for 30 days with activity. DynamoDB stores the session under a hash of the cookie. Guest work survives browser restarts while that cookie remains valid. Account sessions keep Cognito tokens server-side and refresh them when needed; an expired session asks the user to sign in or explicitly start a new guest session.

The sidebar opens Cognito hosted login with authorization code + S256 PKCE, one-time browser-bound state, and nonce. Lambda verifies both token types, subject, issuer, app client and expiry. The existing user pool and WebClient logical IDs are retained. Email signup/verification stays on Cognito; users without a Cognito name enter a display name on their first return. There is one profile per account.

CDK adds a session table with TTL, a Cognito domain, and an SSM parameter containing public runtime auth configuration. Lambda reads `/adaptlearn/AdaptLearnStack/auth`; this avoids a circular CloudFormation dependency and eliminates frontend build-time Cognito IDs. Registered callbacks are the CloudFront origin plus `/api/auth/callback`, and localhost ports 3000 and 5173. Logout returns to `/`. A local API uses `SITE_URL` and the three `COGNITO_*` variables in `.env.example`; leave `AUTH_CONFIG_PARAMETER` unset locally so it does not redirect to production. Without Cognito configuration, guest learning works and the sign-in button is disabled.

Every learning API operation requires a session. Repository access is scoped to the session's learner ID (`guest-<uuid>` or `user-<verified subject>`). Client-supplied IDs cannot select another workspace. Mutations require the exact configured Origin and session CSRF header. Responses are `no-store`, and CloudFront already disables caching on `/api/*`. Uploads are mediated by Lambda, so the uploads bucket does not need browser CORS.

## Durable storage and guest imports

Workspace records retain DynamoDB optimistic version checks. Workspaces over 300 KB are stored as immutable S3 JSON snapshots with a DynamoDB pointer and summary, avoiding the 400 KB item limit. Originals and extracted document text are stored under workspace-specific `knowledge/` prefixes. Retrieval reads S3 after a cold start and applies the existing learner/goal filters. Local development retains JSON/filesystem adapters.

Login combines guest work with saved account progress. Imports preserve item IDs and goal references; an existing account's preferences, active goal and level take precedence. XP and completed-assessment totals are added once, badges are deduplicated, and independently created courses remain separate. Pending and completed import IDs are recorded on the account. Guest writes are frozen before copying documents, and failed imports remain retryable even after a later login. Source guest data is retained for recovery. Per-workspace mutation leases prevent a document deletion or upload from racing the import snapshot; crashed requests release by expiry after five minutes.

Existing legacy profiles are not automatically assigned to accounts and are not publicly listed. Keep backups; any deliberate legacy-data assignment needs a separate migration with a verified owner. Old local-file documents on Lambda cannot be reconstructed if their original temporary files have already disappeared. S3 originals, import source copies and immutable snapshots are retained; future garbage collection must preserve currently referenced snapshots and incomplete imports. Bedrock Knowledge Base integration remains optional and is not enabled by this change.

## Validation and rollout

Run `npm run typecheck`, `npm test`, `npm run test:auth`, `npm run build`, and `npm --prefix infra run synth -- --no-lookups`. Tests use mock Cognito/AWS transports and exercise actual Express routes, S3 adapters, import retry/concurrency, CSRF, session expiry and account isolation. They do not contact a live user pool.

Before deploying, run CDK diff against the intended account and verify that the retained UserPool, WorkspaceTable and UploadsBucket are not replaced. Deploy with the existing script. In the deployed site, create a guest course and upload a small document; sign up, verify email, provide a name, and confirm imported progress. Sign out, log back in, and verify restoration from another browser. Verify that a second account cannot access the first account's workspace. Also test a canceled login and a failed import followed by retry.

CloudFront and Lambda/API Gateway must forward Cookie, Origin and CSRF headers unchanged. Existing Lambda request/timeout limits still apply to uploads and model calls; use small documents for the deployment smoke test. Check Lambda errors and failed-import reports during rollout. No AWS deployment or live Cognito signup is performed by local validation.
