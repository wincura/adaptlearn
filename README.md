# AdaptLearn

AdaptLearn is a local-first, adaptive learning workspace. It starts with no seeded courses or learning materials. A learner adds a goal, completes a short placement check, then creates sourced lessons, assessments, practical activities, or current-learning suggestions for that goal.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev:all
```

The app runs at `http://localhost:3000`; its Express API runs at `http://localhost:8787`.

The OpenAI client reads `OPENAI_API_KEY` and `OPENAI_MODEL` from `keys/key.txt` by default. That folder is git-ignored. For a key replaced in-place, the former `GROQ_API_KEY` label is accepted temporarily. Environment variables can override the key, model, or key-file location without changing application code.

## What works

- Real OpenAI-backed multi-turn chat through one learner-facing guide, with internal task routing hidden from the interface
- Persistent local workspace memory with editable profile context, goals, conversation, outputs, assessments, XP, and badges
- A clear-chat control that removes only conversation history and retains the rest of the workspace
- Automatic four-question placement after a new goal is saved, plus on-demand placement checks
- Teacher-created lessons grounded in required web search, with clickable public source links
- PDF, DOCX, TXT, Markdown, and CSV documentation ingestion with local text extraction and basic relevant-excerpt retrieval for proprietary tools
- Builder-generated practical-lab specifications based on the learner's goal and available Teacher context
- Current-development searches using OpenAI's web-search tool, optional suggestions with sources, and explicit learner approval before a suggestion becomes material

## Agent boundaries

The application routes every conversational turn through the Overall Coordinator. Each specialist owns a narrow class of output in separate backend modules under `server/agents/`. These implementation details are intentionally hidden from the learner-facing interface.

See [docs/architecture.md](docs/architecture.md) for the detailed ownership map and AWS migration seams.

## Current limitations

- Builder outputs are lab specifications, not live executable sandboxes.
- Text extraction is local, but relevant excerpts from uploaded documents are sent to OpenAI when a lesson is created. Upload only documentation you are authorized to process that way.
- Scanned/image-only PDFs require OCR, which is not implemented. Legacy `.doc` files are not supported; save them as `.docx`, PDF, or text first.
- Document retrieval uses lightweight local chunk ranking rather than a vector database; up to 2,000,000 extracted characters are stored per document and up to about 45,000 relevant characters are supplied to one lesson request.
- Placement currently supports generated multiple-choice questions; open-ended rubric grading is not implemented.
- There is one local learner identity and no authentication.
- JSON persistence is intended for local single-user work, not concurrent production traffic.
