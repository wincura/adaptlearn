import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

const retention = RemovalPolicy.RETAIN;
const removal = RemovalPolicy.DESTROY;
const novaFoundationModelId = 'amazon.nova-2-lite-v1:0';
// Nova 2 Lite in this account is available through this active US inference
// profile, rather than through on-demand base-model throughput.
const novaInferenceProfileId = 'us.amazon.nova-2-lite-v1:0';
const novaInferenceProfileRegions = ['us-east-1', 'us-east-2', 'us-west-2'];
const embeddingModelId = 'amazon.titan-embed-text-v2:0';
const embeddingDimension = 1024;

export class AdaptLearnStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    // Innovation Sandbox blocks Amazon S3 Vectors. Keep retrieval infrastructure
    // opt-in so the application can be deployed independently of document RAG.
    const knowledgeBaseEnabled = this.node.tryGetContext('enableKnowledgeBase') === 'true';

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: removal,
      autoDeleteObjects: true,
    });
    const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: retention,
    });
    const workspaceTable = new dynamodb.Table(this, 'WorkspaceTable', {
      partitionKey: { name: 'learnerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: retention,
    });

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      removalPolicy: retention,
    });
    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { userSrp: true, userPassword: true },
      preventUserExistenceErrors: true,
      generateSecret: false,
    });

    const apiFunction = new lambdaNodejs.NodejsFunction(this, 'ApiFunction', {
      entry: path.join(__dirname, '..', '..', 'server', 'lambda.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.seconds(29),
      // The Lambda source lives beside the web app rather than inside the
      // CDK package, so use the repository root for dependency discovery.
      projectRoot: path.join(__dirname, '..', '..'),
      environment: {
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        AI_PROVIDER: 'bedrock',
        BEDROCK_MODEL_ID: novaInferenceProfileId,
        // E2B runs outside AWS, so its credential must be supplied at deploy
        // time. Do not expect the git-ignored local keys/key.txt to exist in
        // the Lambda bundle.
        SANDBOX_EXECUTOR: process.env.SANDBOX_EXECUTOR ?? 'e2b',
        E2B_API_KEY: process.env.E2B_API_KEY ?? '',
        WORKSPACE_REPOSITORY: 'dynamodb',
        WORKSPACE_TABLE: workspaceTable.tableName,
        KNOWLEDGE_REPOSITORY: 'local-filesystem',
        // Lambda only permits writes below /tmp. Document durability will move
        // to the uploads bucket when the S3 knowledge adapter is introduced.
        UPLOAD_DIRECTORY: '/tmp/uploads',
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });
    workspaceTable.grantReadWriteData(apiFunction);
    uploadsBucket.grantReadWrite(apiFunction, 'knowledge/*');
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        ...novaInferenceProfileRegions.map((region) => this.bedrockFoundationModelArn(novaFoundationModelId, region)),
        this.bedrockInferenceProfileArn(novaInferenceProfileId),
      ],
    }));

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      createDefaultStage: true,
      description: 'AdaptLearn application API.',
    });
    const apiIntegration = new apigwv2Integrations.HttpLambdaIntegration('ApiIntegration', apiFunction);
    httpApi.addRoutes({ path: '/health', methods: [apigwv2.HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: '/api/{proxy+}', methods: [apigwv2.HttpMethod.ANY], integration: apiIntegration });

    const staticOrigin = origins.S3BucketOrigin.withOriginAccessControl(websiteBucket);
    const apiDomainName = cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint));
    const apiOrigin = new origins.HttpOrigin(apiDomainName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: staticOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        'api/*': {
          origin: apiOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
        health: {
          origin: apiOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
      },
    });
    uploadsBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.PUT],
      allowedOrigins: [`https://${distribution.distributionDomainName}`],
      allowedHeaders: ['*'],
      exposedHeaders: ['ETag'],
      maxAge: 300,
    });
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'dist'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    if (knowledgeBaseEnabled) {
      const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com', {
          conditions: {
            StringEquals: { 'aws:SourceAccount': this.account },
            ArnLike: { 'aws:SourceArn': `arn:${this.partition}:bedrock:${this.region}:${this.account}:knowledge-base/*` },
          },
        }),
      });
      uploadsBucket.grantRead(knowledgeBaseRole, 'knowledge/*');
      knowledgeBaseRole.addToPolicy(new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [this.bedrockFoundationModelArn(embeddingModelId)],
      }));

      const vectorBucket = new cdk.CfnResource(this, 'KnowledgeVectorBucket', {
        type: 'AWS::S3Vectors::VectorBucket',
        properties: {},
      });
      vectorBucket.applyRemovalPolicy(retention);
      const vectorIndex = new cdk.CfnResource(this, 'KnowledgeVectorIndex', {
        type: 'AWS::S3Vectors::Index',
        properties: {
          VectorBucketArn: vectorBucket.getAtt('VectorBucketArn'),
          IndexName: 'adaptlearn-knowledge',
          DataType: 'float32',
          Dimension: embeddingDimension,
          DistanceMetric: 'cosine',
        },
      });
      vectorIndex.addResourceDependency(vectorBucket);
      vectorIndex.applyRemovalPolicy(retention);
      const vectorIndexArn = vectorIndex.getAtt('IndexArn').toString();
      knowledgeBaseRole.addToPolicy(new iam.PolicyStatement({
        actions: ['s3vectors:PutVectors', 's3vectors:GetVectors', 's3vectors:DeleteVectors', 's3vectors:QueryVectors', 's3vectors:GetIndex'],
        resources: [vectorIndexArn],
      }));

      const knowledgeBase = new cdk.CfnResource(this, 'KnowledgeBase', {
        type: 'AWS::Bedrock::KnowledgeBase',
        properties: {
          Name: 'adaptlearn-knowledge',
          Description: 'Scoped learner documents for AdaptLearn retrieval.',
          RoleArn: knowledgeBaseRole.roleArn,
          KnowledgeBaseConfiguration: {
            Type: 'VECTOR',
            VectorKnowledgeBaseConfiguration: {
              EmbeddingModelArn: this.bedrockFoundationModelArn(embeddingModelId),
            },
          },
          StorageConfiguration: {
            Type: 'S3_VECTORS',
            S3VectorsConfiguration: { IndexArn: vectorIndexArn },
          },
        },
      });
      knowledgeBase.addResourceDependency(vectorIndex);
      knowledgeBase.addResourceDependency(knowledgeBaseRole.node.defaultChild as cdk.CfnResource);
      const dataSource = new cdk.CfnResource(this, 'KnowledgeDataSource', {
        type: 'AWS::Bedrock::DataSource',
        properties: {
          Name: 'adaptlearn-uploads',
          KnowledgeBaseId: knowledgeBase.ref,
          DataDeletionPolicy: 'RETAIN',
          DataSourceConfiguration: {
            Type: 'S3',
            S3Configuration: { BucketArn: uploadsBucket.bucketArn, InclusionPrefixes: ['knowledge/'] },
          },
        },
      });
      dataSource.addResourceDependency(knowledgeBase);
      apiFunction.addToRolePolicy(new iam.PolicyStatement({
        actions: ['bedrock:Retrieve', 'bedrock:StartIngestionJob', 'bedrock:GetIngestionJob'],
        resources: [knowledgeBase.getAtt('KnowledgeBaseArn').toString()],
      }));
      new cdk.CfnOutput(this, 'KnowledgeBaseId', { value: knowledgeBase.ref });
      new cdk.CfnOutput(this, 'KnowledgeDataSourceId', { value: dataSource.ref });
    }

    new cdk.CfnOutput(this, 'WebsiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'WorkspaceTableName', { value: workspaceTable.tableName });
    new cdk.CfnOutput(this, 'UploadsBucketName', { value: uploadsBucket.bucketName });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
  }

  private bedrockFoundationModelArn(modelId: string, region = this.region) {
    return `arn:${this.partition}:bedrock:${region}::foundation-model/${modelId}`;
  }

  private bedrockInferenceProfileArn(profileId: string) {
    return `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${profileId}`;
  }
}
