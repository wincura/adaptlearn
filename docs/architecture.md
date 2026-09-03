# AdaptLearn architecture

## Product rule

The workspace starts empty. No generic Python, French, Excel, SQL, or other course catalogue is bundled. A material exists only after the learner requests it for an active goal, or accepts a current-learning suggestion and adds it to their path.

## Agent ownership

| Agent | Owns | Explicitly does not own |
|---|---|---|
| Overall Coordinator | Learner profile, background, preferences, goals, persistent memory, routing, progress overview | Full lesson authoring, lab construction, grading, web freshness claims |
| Teacher | Web-researched lessons, per-goal topic continuity, placement-adapted explanations, uploaded-document synthesis, quizzes, exercises, hands-on activity briefs | Level decisions, final assessment scores, XP, infrastructure |
| Builder | Practice-lab specifications, starter states/files, simulated environments, expected results and reset paths | Curriculum priorities, grading, learner memory |
| Assessor | Placement and mastery checks, rubrics, level decisions, XP and badges | Teaching answers during a test, lesson authoring, web research |
| Researcher | Current web research, official-source discovery, freshness, optional suggestions | Adding curriculum without consent, writing final lessons, grading |

The Coordinator always reads the current workspace and selects a specialist. A specialist response is stored with its actual agent identity. Buttons for material generation call the owning specialist directly through Coordinator-controlled endpoints. Agent identities, routing, and ownership traces are internal architecture and are not displayed to learners.

## Code arrangement

```text
app/
  page.tsx                         Thin application entry
components/
  workspace/
    LearningStudio.tsx             Client orchestration and server state
    LearningChat.tsx               Single learner-facing chat surface
    WorkspaceCanvas.tsx            Goals, material library, suggestions
    WorkspaceDialogs.tsx           Goal, memory, material, placement flows
server/
  agents/
    coordinator/agent.ts           Relationship and routing policy
    teacher/agent.ts               Teaching policy
    teacher/create-material.ts     Web-researched, source-grounded lesson generation
    builder/agent.ts               Builder policy
    builder/create-lab.ts           Builder-owned lab generation
    assessor/agent.ts              Assessment policy
    assessor/placement.ts          Placement and scoring
    researcher/agent.ts            Research policy
    researcher/find-updates.ts     Web-search suggestions
    catalog.ts                     Routing registry
  orchestration/run-turn.ts        Coordinator → specialist execution
  memory/workspace-store.ts        Durable local workspace repository
  knowledge/document-store.ts      Document extraction and relevant-excerpt retrieval
  ai/openai-client.ts              Credential loading and OpenAI Responses transport
  index.ts                         Express HTTP boundary
shared/contracts.ts                Shared domain contracts
```

## Persistence

`data/workspace.json` is the authoritative local workspace. It holds learner context, goals, document metadata, conversations, agent outputs, placement evidence, and progress. Uploaded originals are stored in `data/uploads`; locally extracted text is stored in `data/knowledge`. Neither is returned to the browser. The browser does not use local storage as authoritative memory.

The store is deliberately behind `WorkspaceStore`. For AWS migration, implement the same repository behavior with S3 for the requested architecture. If the product later needs many concurrent partial updates or queries, use DynamoDB for structured memory and reserve S3 for documents and generated artifacts.

## OpenAI and tools

- Normal agent turns use the model configured in `keys/key.txt` or `OPENAI_MODEL`.
- Current-development searches use `gpt-5.4-nano` by default with OpenAI's `web_search` built-in tool.
- Every Teacher lesson requires a web-search call and at least two public source URLs. Relevant excerpts from uploaded documentation are included when applicable and are labeled separately from public sources.
- Lesson generation is stateful per goal. Research receives previous lesson titles and canonical covered topics; each new lesson persists its own topics, assessed level, and placement-assessment identifier.
- A completed placement for the same goal is a prerequisite for lesson generation. Retaking placement changes the adaptation input for future lessons while existing lessons retain their original linkage.
- Uploaded-document text is treated as untrusted reference data, never as instructions. Extraction and lexical chunk ranking happen locally; selected excerpts are then sent to OpenAI for lesson creation.
- The key is read at runtime, never returned by an endpoint, and the entire `keys/` folder is git-ignored.
- Agent prompts state ownership limits and prohibit claims about actions without tool evidence.

## AWS migration seams

| Local | AWS-ready replacement |
|---|---|
| Express process | Lambda adapter behind API Gateway |
| `WorkspaceStore` JSON file | S3 implementation; DynamoDB if write concurrency grows |
| `data/uploads` and `data/knowledge` | S3 objects plus metadata and lifecycle rules; replace lexical retrieval with Bedrock Knowledge Bases if needed |
| Direct OpenAI client | Bedrock model adapter and AgentCore runtime |
| In-process orchestration | Step Functions or AgentCore workflow |
| Startup research call | EventBridge-triggered refresh plus on-demand endpoint |

The current implementation stays local, as requested. No AWS resources are provisioned.
