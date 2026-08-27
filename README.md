# AdaptLearn

AdaptLearn is a local-first adaptive learning studio for beginners through professionals. It combines guided curricula, placement and ongoing assessment, practical activities, gamification, source-grounded teaching, and an always-available learning coach.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev:all
```

Open `http://localhost:3000`. The API runs at `http://localhost:8787` and stores local data under `data/`.

The default `AI_PROVIDER=mock` makes the product usable without credentials. Copy `.env.example` to `.env`, choose `openai` or `anthropic`, and add the matching key to use a hosted model. Never commit `.env`.

## What this prototype includes

- Three-step learning-path onboarding with familiarity and learning-style capture
- Placement-ready flow and persistent local learner preferences
- Guided Python course, adaptive lesson, practical quick check, XP, streaks, badges, and progress evidence
- Side coach with Teacher and free Conversation modes
- Learning-path library for Python, French, Excel, SQL, Java OOP, and specialist documentation
- Researcher suggestions kept optional until the learner accepts them
- Local Express API with provider-neutral AI and profile-store boundaries

## Architecture

The browser app uses React, TypeScript, MUI, and Motion. The local API is Node.js/Express. Two interfaces isolate infrastructure decisions:

- `server/ai/provider.ts` selects mock, OpenAI, or Anthropic today and is the seam for Bedrock/AgentCore later.
- `server/storage/profile-store.ts` defines persistent learner memory; the local JSON implementation can be replaced by an S3-backed store without changing route logic.

The Express app remains a conventional stateless HTTP service so it can be wrapped for AWS Lambda later. Uploaded documentation is kept under `data/uploads` locally; production should place originals in S3 and index extracted chunks through a background ingestion workflow.

See [docs/architecture.md](docs/architecture.md) for the target agent and AWS migration design.
"# adaptlearn" 
