# AI Code Sandbox & Socratic Test Generator Guide

## Overview

AdaptLearn includes an interactive, local-first, and AWS-portable **AI Code Sandbox and Test Generator**. Built natively in Node.js and TypeScript, this feature enables learners to write and test code directly in the browser when studying programming topics, while receiving automated test verification and Socratic pedagogical feedback from the AI Tutor.

---

## What Was Implemented

### 1. Pure Node.js & TypeScript Architecture

- Integrated directly into the existing AdaptLearn codebase without external Python services.
- **Provider-Neutral `SandboxExecutor` Contract** (`server/sandbox/contracts.ts`):
  - **`LocalSandboxExecutor`** (`server/sandbox/local-executor.ts`):
    - Zero-credential, isolated sub-process execution for local development.
    - Supports **Python**, **JavaScript / TypeScript**, and **SQL** (via in-memory SQLite/DuckDB runner).
    - Includes memory caps and strict execution timeouts (default 8s) to prevent infinite loops from hanging the process.
  - **`E2BSandboxExecutor`** (`server/sandbox/e2b-executor.ts`):
    - Cloud Firecracker MicroVM executor using the official `@e2b/code-interpreter` TypeScript SDK.
    - Executes code inside secure microVMs over TLS API.
    - Works identically from local Node.js or directly inside **AWS Lambda** without requiring Docker-in-Docker or root permissions.
  - **Swappable Runtime Composition Root** (`server/runtime/providers.ts`):
    - Selected via environment variable `SANDBOX_EXECUTOR=local` (default) or `SANDBOX_EXECUTOR=e2b`.

### 2. Selective Execution by Topic

- **Topic Classifier** (`server/sandbox/topic-detector.ts`):
  - **Non-code topics** (e.g. *Conversational Spanish*, *French grammar*, *Project Management*, *History*, *Math proofs*) are automatically detected and **never display a code sandbox**. They retain standard reading sections and multiple-choice quizzes.
  - **Code topics** (e.g. *Python*, *SQL*, *JavaScript*, *C++*, *Java*) automatically unlock the practical coding challenge and execution sandbox.

### 3. Socratic Test Generator & AI Evaluator

- Implemented in `server/sandbox/code-evaluator.ts`:
  - **Dynamic Challenge Generation**: Generates problem prompts, constraints, starter templates, and hidden assertion test harnesses matching the learner's level and lesson topic.
  - **Socratic Pedagogical Evaluation**:
    - When code is submitted, the code and test harness execute in the sandbox.
    - The AI Tutor inspects runtime output (stdout, stderr, exit code, assertion failure vs pass).
    - **Passing code**: Congratulates the learner, explains time/space complexity insights ($O(n)$ Big-O analysis), and awards XP.
    - **Failing code**: Diagnoses the root cause conceptually and provides a targeted hint **without revealing or spoiling the corrected code**, coaching the student to solve it themselves.

### 4. Express API Endpoints

- In `server/app.ts`:
  - `GET /health`: Reports sandbox status (`local-process` or `e2b-microvm`).
  - `POST /api/sandbox/run`: Fast test run endpoint for immediate stdout/stderr preview.
  - `POST /api/sandbox/evaluate`: Full agentic Socratic evaluation against challenge test cases.
  - `POST /api/materials/:materialId/coding-challenge`: Generates a practical coding test on-demand for any existing material.

### 5. Interactive Frontend UI

- **`CodeSandbox.tsx`** (`components/workspace/CodeSandbox.tsx`):
  - Modern dark IDE panel with line numbers, Tab indentation support, Copy and Reset controls.
  - "Run Code" button for fast output preview.
  - "Test & Get AI Feedback" button for comprehensive test assertion and tutor analysis.
  - Terminal tab with formatted stdout/stderr and execution duration in milliseconds.
  - Socratic AI Tutor tab with Markdown formatting, pass/fail status banners, and XP celebration.
- **`MaterialDialog` Integration** (`components/workspace/WorkspaceDialogs.tsx`):
  - Embeds the sandbox in coding lessons and practice labs.
  - Keeps non-coding topics completely clean and unencumbered.

---

## How to Test This Feature

### Method 1: Automated Test Scripts

Two automated test suites are included in `package.json`:

#### 1. Sandbox Engine & Topic Detection Test

Tests topic detection, Python execution, assertion failure handling, JavaScript execution, and timeout protection:

```bash
npm run test:sandbox
```

**Expected Output:**

- `Topic Detection: 8/8 tests passed` (correctly differentiates code vs non-code topics).
- `Testing Python Execution`: Status `passed`, exitCode `0`.
- `Testing Python Assertion Error Handling`: Status `runtime_error`, captures `AssertionError`.
- `Testing JavaScript Execution`: Status `passed`.
- `Testing Timeout Handling`: Status `timeout` after `~1500ms`.
- `=== ALL SANDBOX TESTS PASSED SUCCESSFULLY! ===`

#### 2. Express API & Live Socratic Tutor Test

Starts an in-memory Express server and tests the `/health`, `/api/sandbox/run`, and `/api/sandbox/evaluate` endpoints:

```bash
npm run test:api
```

**Expected Output:**

- `/health` reports `sandbox: 'local-process'`.
- `/api/sandbox/run` executes Python code and returns stdout.
- `/api/sandbox/evaluate` runs an intentionally flawed function (forgot to check for odd/even), detects the assertion failure, and prints Socratic AI Tutor guidance explaining the root cause without spoiling the code.

#### 3. TypeScript Compilation Check

Verify type soundness across the entire application:

```bash
npm run typecheck
```

---

### Method 2: Interactive Browser Walkthrough

1. **Start the local application**:

   ```bash
   npm run dev:all
   ```

   - Web app opens at: `http://localhost:3000`
   - Express API runs at: `http://localhost:8787`
2. **Test a Programming Goal (Code Sandbox Activated)**:

   - Click **Add goal** or **New goal**.
   - Set the goal to a coding topic, e.g.:
     - Title: `Learn Python Data Structures`
     - Focus: `Lists, dictionaries, and algorithms`
   - Complete the initial 12-question placement test.
   - Click **Create first lesson** or **Create practice activity**.
   - Open the generated lesson or practice activity:
     - Notice the **PRACTICAL TEST** section below the reading material.
     - You will see the problem prompt, starter code template, and verification scenarios.
   - Click **Run Code** to execute code and view the terminal stdout.
   - Introduce an intentional bug and click **Test & Get AI Feedback**:
     - The AI Tutor detects the failure and gives conceptual hints.
   - Fix the bug and click **Test & Get AI Feedback**:
     - The green "All Verification Tests Passed!" banner appears, with Big-O complexity notes and +25 XP awarded!
3. **Test a Non-Coding Goal (No Sandbox Displayed)**:

   - Create a non-coding goal, e.g.:
     - Title: `Conversational Spanish for Travelers`
     - Focus: `Ordering food and asking for directions`
   - Open any lesson generated for this goal:
     - The lesson displays the standard reading sections, activities, and multiple-choice knowledge check.
     - **No code sandbox or code buttons are displayed**, keeping the learning experience clean and appropriate for the subject.

---

## Configuration & AWS Deployment

### Team & Cloud MicroVMs with E2B (Default)

To ensure that **no one on the team needs Python, Java (JDK), or C++ (GCC) installed locally**, `e2b` is the default executor. Code runs in ephemeral Linux Firecracker microVMs in the cloud where all runtimes and compilers are pre-installed.

1. Obtain a free API key from [e2b.dev](https://e2b.dev).
2. Set in `.env` or add to `keys/key.txt`:
   ```bash
   SANDBOX_EXECUTOR=e2b
   E2B_API_KEY=e2b_...
   ```

### Offline / Local Process Fallback

If you are developing offline or without an E2B key, you can easily switch to your local system runtimes:

```bash
# In .env
SANDBOX_EXECUTOR=local
```

*(Requires `python` on PATH for Python/SQL execution).*

### AWS Lambda / Cloud Portability

Because `@e2b/code-interpreter` communicates with ephemeral Firecracker MicroVMs over HTTPS/TLS:

- The backend container or AWS Lambda function requires **zero Docker-in-Docker setup and zero root privileges**.
- In AWS Lambda, simply set `SANDBOX_EXECUTOR=e2b` and `E2B_API_KEY=...` in the Lambda environment variables.
- When migrating AI from OpenAI to AWS Bedrock, the `SandboxExecutor` remains unchanged because it uses the provider-neutral `AIProvider` contract (`server/ai/provider.ts`).
