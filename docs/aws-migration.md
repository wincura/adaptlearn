# AWS migration and RAG implementation guide

AdaptLearn is local-first today. Its domain services do not depend on Express, local files, OpenAI, or AWS directly; those systems sit behind small interfaces selected at startup. No AWS resource is provisioned by this repository.

## Runtime boundaries

| Concern | Contract or factory | Current adapter | Planned AWS adapter |
|---|---|---|---|
| Learner memory | `WorkspaceRepository` | `WorkspaceStore` / local JSON | `S3WorkspaceRepository` |
| Document ingestion and retrieval | `KnowledgeRepository` | `LocalKnowledgeRepository` / extracted text and lexical ranking | `BedrockKnowledgeBaseRepository` / S3 data source and Bedrock retrieval |
| Model calls | `AIProvider` | `OpenAIProvider` | `BedrockProvider` |
| HTTP process | `createApp()` | Long-running local Express listener | Lambda HTTP adapter or an AgentCore entrypoint |
| Agent coordination | Agent functions plus `runTurn()` | In-process calls | Same functions inside Lambda, or AgentCore Runtime entrypoints |

`server/runtime/providers.ts` is the composition root. New adapters are registered there and selected with environment variables. Business logic receives contracts rather than constructing infrastructure clients.

## Retrieval-Augmented Generation flow

The Teacher deliberately uses retrieval and generation as separate steps:

```text
upload → KnowledgeRepository.ingest(scope metadata)
lesson request → KnowledgeRepository.retrieve(query + scope)
               → ranked RetrievedPassage[] with provenance
               → prompt-safe context formatter
               → Teacher synthesis
               → lesson sources stored with the material
```

This design maps to the Bedrock Knowledge Bases `Retrieve` operation rather than coupling lesson creation to `RetrieveAndGenerate`. AdaptLearn keeps control of the Teacher prompt, placement adaptation, covered-topic history, structured lesson schema, and source handling.

Every retrieval request carries `learnerId`, optional `goalId`, `topK`, and a context-size limit. Every passage carries a score, source document ID/title/URI, excerpt number, and metadata. The local implementation enforces the same scope semantics expected from the cloud adapter:

- `visibility: learner` makes a document reusable across that learner's goals.
- `visibility: goal` restricts a document to its associated goal.
- Legacy local documents without scope metadata remain visible only because this is a single-user migration path.

## Bedrock Knowledge Bases adapter

Implement `BedrockKnowledgeBaseRepository` against `server/knowledge/contracts.ts`.

### Ingestion

1. Upload the original document to an S3 prefix such as `knowledge/{learnerId}/{documentId}/source.ext`.
2. Write the matching metadata sidecar expected by the configured Knowledge Base data source. Store at least:

   ```json
   {
     "metadataAttributes": {
       "learnerId": "...",
       "goalId": "...",
       "visibility": "learner",
       "documentId": "...",
       "title": "..."
     }
   }
   ```

3. Start or enqueue the Knowledge Base data-source sync. Return a `KnowledgeDocument` with `status: processing` until ingestion completes; update it to `ready` after the sync reports success.
4. Store the S3 URI and external Knowledge Base document identifier in `document.provider`.

For faster interactive ingestion, an adapter can instead use Bedrock Knowledge Bases' supported direct-ingestion API and keep the same contract.

### Retrieval

Call the Knowledge Base `Retrieve` operation with `numberOfResults` from `query.topK`. Apply metadata filters equivalent to:

```text
learnerId == query.scope.learnerId
AND (
  visibility == "learner"
  OR (visibility == "goal" AND goalId == query.scope.goalId)
)
```

Map each Bedrock retrieval result into `RetrievedPassage`. Preserve its relevance score, content, location URI, document metadata, and a stable source identifier. Optional Bedrock reranking can be added inside the adapter without changing the Teacher.

Do not rely only on prompt instructions for isolation. Enforce learner/goal filters in retrieval, scope S3 prefixes and IAM access, and test that one learner cannot retrieve another learner's passages.

## Workspace memory on S3

Implement `WorkspaceRepository` using one versioned object per learner, for example `workspaces/{learnerId}/workspace.json`.

- `get()` reads and normalizes that object.
- `update()` reads both body and ETag, applies the mutation, then conditionally writes with `If-Match` so concurrent changes do not silently overwrite each other.
- Retry a bounded number of precondition failures after re-reading the latest object.
- Enable S3 Versioning for recovery and use SSE-KMS for stored learner data.

This satisfies the planned S3 architecture for modest traffic. If partial writes, querying, or high concurrency become important, preserve the repository contract and move structured learner state to DynamoDB while keeping documents and generated artifacts in S3.

## Bedrock model adapter

Implement `AIProvider.respond()` in `server/ai/bedrock-provider.ts` and register `AI_PROVIDER=bedrock` in `server/ai/provider.ts`.

- Translate `AIMessage[]`, structured-output requirements, token limits, and temperature to the selected Bedrock inference API.
- Normalize the response to `AIResult` so the agents do not depend on provider-specific response objects.
- Keep web discovery as a tool capability. If the chosen Bedrock model/endpoint does not supply compatible web search, expose a separately auditable search tool and return its URLs through `AIResult.webSources`.
- Validate model and tool support during startup; fail with a useful configuration error instead of silently producing unsourced lessons.

## Lambda and AgentCore

`server/app.ts` exports `createApp()` without opening a port. A Lambda entrypoint can import it, inject AWS repositories/providers, and wrap the Express app with a Lambda HTTP adapter. `server/index.ts` remains the local listener.

For AgentCore Runtime, keep each specialist's domain function as the unit of work and expose a thin runtime entrypoint that validates input, creates scoped dependencies, and calls the function. AgentCore can host the orchestration without moving persistence or retrieval rules into prompts.

Recommended migration order:

1. Move originals and generated artifacts to S3.
2. Add the S3 workspace repository with conditional writes and versioning.
3. Add the Bedrock Knowledge Bases adapter and run retrieval-isolation tests.
4. Add the Bedrock model provider; verify structured lesson and citation behavior.
5. Package `createApp()` for Lambda behind API Gateway.
6. Move orchestration to AgentCore only where its session/runtime features add value.

## Configuration shape

Local defaults are already represented in `.env.example`. Suggested cloud variables are:

```text
WORKSPACE_REPOSITORY=s3
KNOWLEDGE_REPOSITORY=bedrock-knowledge-base
AI_PROVIDER=bedrock
AWS_REGION=...
WORKSPACE_BUCKET=...
KNOWLEDGE_BUCKET=...
BEDROCK_KNOWLEDGE_BASE_ID=...
BEDROCK_DATA_SOURCE_ID=...
BEDROCK_MODEL_ID=...
```

Use the default AWS credential provider chain and IAM roles in Lambda/AgentCore. Do not add long-lived AWS credentials or API keys to application files.

## AWS references

- [Bedrock Knowledge Bases retrieval and generation](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-how-retrieval.html)
- [Knowledge Base retrieval filters](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_RetrievalFilter.html)
- [Knowledge Base metadata sidecars](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-metadata.html)
- [Testing retrieval and reranking](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-retrieve.html)
- [Amazon S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [AgentCore Runtime overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html)
