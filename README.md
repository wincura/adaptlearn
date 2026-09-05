# AdaptLearn

AdaptLearn is a local-first, adaptive learning workspace. It starts with no seeded courses or learning materials. A learner adds a goal, completes a placement test, then creates sourced lessons, assessment tests, practical activities, or current-learning suggestions for that goal.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev:all
```

The Vite single-page app runs at `http://localhost:3000`; its Express API runs at `http://localhost:8787`.

`npm run build` produces a static frontend in `dist/`, suitable for an S3 bucket behind CloudFront. Leave `VITE_API_URL` unset when CloudFront routes `/api/*` and `/health` to API Gateway; set it to a separately hosted API origin only when needed.

The OpenAI client reads `OPENAI_API_KEY` and `OPENAI_MODEL` from `keys/key.txt` by default. That folder is git-ignored. For a key replaced in-place, the former `GROQ_API_KEY` label is accepted temporarily. Environment variables can override the key, model, or key-file location without changing application code.

## What works

- Real OpenAI-backed Learning Guide for concept explanations and follow-up questions; it receives only the active goal shown in the workspace, with no profile, lesson, document, assessment, or progress context, and cannot create app content, run searches, or route work
- Persistent local workspace memory with full learner-profile CRUD and distinct goals, conversation, outputs, assessments, XP, and badges for each profile
- Learning-goal creation, selection, editing, and deletion; lessons, placement evidence, and covered-topic history remain attached to their own goal
- A clear-chat control that removes only conversation history and retains the rest of the workspace
- A minimized learning-guide chat bubble that can be opened, cleared, and minimized again; each explanation ends with one to three keywords that can be copied into the next-lesson focus fields
- Automatic 12-question placement test after a new goal is saved, followed by repeatable assessment tests across multiple skill dimensions and difficulty bands
- Teacher-created lessons grounded in required web search, with clickable public source links and a clickable 4–6 question knowledge check with corrections; learners can let the app choose the next topic or request up to three distinct ideas
- Per-goal lesson continuity: generated lessons persist canonical topic labels, and future research avoids topics already represented in that goal's lesson history
- Placement-gated lessons use both the overall level and dimension-level strengths and focus areas to shape future content
- PDF, DOCX, TXT, Markdown, and CSV documentation ingestion with local text extraction, a document browser, deletion, and structured relevant-passage retrieval for proprietary tools
- Builder-generated practical-lab specifications based on the learner's goal and available Teacher context
- Interactive AI Code Sandbox and Socratic Test Generator for programming and data topics; executes code in an isolated local process or cloud E2B microVM, tests hidden assertions, and delivers Socratic guidance without revealing the answer (see [docs/code-sandbox.md](docs/code-sandbox.md)). Non-code topics (human languages, management, humanities) remain clean and do not show code executors
- Manual “What’s new?” searches using OpenAI's web-search tool: technical and software goals receive relevant feature/change alerts or uncovered topics, while human-language and stable-skill goals receive need-based refreshers or next topics rather than generic product or exam news; every suggestion remains optional until explicitly approved

## Agent boundaries

The application routes every conversational turn through the Overall Coordinator. Each specialist owns a narrow class of output in separate backend modules under `server/agents/`. These implementation details are intentionally hidden from the learner-facing interface.

See [docs/architecture.md](docs/architecture.md) for the detailed ownership map, [docs/code-sandbox.md](docs/code-sandbox.md) for the sandbox and Socratic test generator guide, and [docs/aws-migration.md](docs/aws-migration.md) for the Lambda, S3, Bedrock, AgentCore, RAG, and Knowledge Bases adapter plan.

## Current limitations

- Text extraction is local, but relevant excerpts from uploaded documents are sent to the configured AI provider when a lesson is created. Upload only documentation you are authorized to process that way.
- Scanned/image-only PDFs require OCR, which is not implemented. Legacy `.doc` files are not supported; save them as `.docx`, PDF, or text first.
- Document retrieval uses lightweight local chunk ranking rather than embeddings or a vector database. The contract already returns scored passages, source provenance, and learner/goal filter metadata so a Bedrock Knowledge Bases adapter can replace it without changing the Teacher.
- Placement currently supports generated multiple-choice questions; open-ended rubric grading is not implemented.
- A generated lesson counts its topics as covered for sequencing purposes; explicit read/completion tracking is not implemented yet.
- Lesson quiz attempts and scores are currently session-only and are not added to XP or persisted after the lesson closes.
- Multiple local learner profiles are supported, but authentication is not implemented.
- JSON persistence is intended for local single-user work, not concurrent production traffic.
