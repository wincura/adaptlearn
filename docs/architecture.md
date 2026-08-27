# AdaptLearn architecture

## Product agents

The Coordinator owns the persistent learner model: goals, background, demonstrated skills, preferences, pace, and recent context. It delegates bounded work to four agents and records useful evidence after every turn.

- **Teacher** plans and teaches, creates source-grounded reading pages, conversation, exercises, and hands-on activities.
- **Builder** produces safe simulated environments and starter files for practical work. It never receives broader machine access than an activity needs.
- **Assessor** creates placement and mastery checks, evaluates structured and open responses, updates skill evidence, and awards XP or badges.
- **Researcher** checks established public documentation for developments and proposes optional additions. Nothing changes the curriculum until the learner accepts it.

Agent boundaries should be implemented as explicit workflows with typed inputs and outputs, not as five independent chatbots. The Coordinator chooses the next action; the other agents return artifacts or evidence.

## Local-first deployment

| Concern | Local implementation | AWS migration seam |
|---|---|---|
| Web UI | Vinext/React development server | Static/edge hosting or AWS frontend hosting |
| API | Express on port 8787 | Lambda adapter behind API Gateway |
| Learner memory | JSON through `ProfileStore` | S3 implementation of `ProfileStore`; DynamoDB is preferable if concurrent fine-grained writes grow |
| Source files | `data/uploads` | S3 bucket with presigned uploads and lifecycle policies |
| AI routing | `generateReply` provider adapter | Bedrock models plus AgentCore workflow/runtime |
| Search/index | Deferred local ingestion worker | S3 events, Lambda/Step Functions, and a managed vector index |
| Check-ins | Local browser reminders initially | EventBridge Scheduler plus notification service |

## Data and safety

- Store durable learning evidence separately from raw conversation. Evidence should include the skill, task, rubric version, confidence, and source turn.
- Treat uploaded documents as untrusted content. Scan files, limit size and type, extract in isolation, and prevent instructions inside documents from changing agent policy.
- Keep public documentation allowlisted by course, store citations with generated learning material, and show source freshness.
- Require the Assessor to use versioned rubrics and preserve the learner's original answer for auditability.
- Keep XP a motivational display, never a hidden proxy for competence. Level changes must be backed by assessment evidence.
- Add content filters, age-appropriate policy when applicable, deletion/export controls, encryption, and minimal retention before production use.

## Suggested next slices

1. Replace demo profile state with API-backed login and persistent multiple learning projects.
2. Add document extraction, chunking, citations, and retrieval over uploaded and allowlisted sources.
3. Define a skill graph and versioned assessment rubric for one complete course.
4. Add a sandboxed Builder environment for Python exercises.
5. Add scheduled check-ins and a learner-controlled notification preference center.
