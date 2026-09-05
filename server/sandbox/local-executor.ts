import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExecutionResult, ExecutionStatus, SandboxExecutionOptions, SandboxExecutor } from './contracts.ts';

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB limit

export class LocalSandboxExecutor implements SandboxExecutor {
  readonly id = 'local-process';

  async execute(options: SandboxExecutionOptions): Promise<ExecutionResult> {
    const { language, code, harness = '', timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const startTime = Date.now();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adaptlearn-sandbox-'));

    try {
      if (language === 'python') {
        return await this.executePython(tempDir, code, harness, timeoutMs, startTime);
      }

      if (language === 'javascript' || language === 'typescript') {
        return await this.executeJavaScript(tempDir, code, harness, timeoutMs, startTime);
      }

      if (language === 'sql') {
        return await this.executeSql(tempDir, code, harness, timeoutMs, startTime);
      }

      if (language === 'cpp') {
        return await this.executeCpp(tempDir, code, harness, timeoutMs, startTime);
      }

      if (language === 'java') {
        return await this.executeJava(tempDir, code, harness, timeoutMs, startTime);
      }

      throw new Error(`Unsupported execution language: ${language}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async executePython(
    tempDir: string,
    code: string,
    harness: string,
    timeoutMs: number,
    startTime: number,
  ): Promise<ExecutionResult> {
    const scriptPath = path.join(tempDir, 'solution.py');
    const fullScript = `${code}\n\n# --- Evaluation Harness ---\n${harness}`;
    await fs.writeFile(scriptPath, fullScript, 'utf-8');

    return this.runProcess('python', [scriptPath], tempDir, timeoutMs, startTime);
  }

  private async executeJavaScript(
    tempDir: string,
    code: string,
    harness: string,
    timeoutMs: number,
    startTime: number,
  ): Promise<ExecutionResult> {
    const scriptPath = path.join(tempDir, 'solution.mjs');
    const fullScript = `${code}\n\n// --- Evaluation Harness ---\n${harness}`;
    await fs.writeFile(scriptPath, fullScript, 'utf-8');

    return this.runProcess('node', [scriptPath], tempDir, timeoutMs, startTime);
  }

  private async executeSql(
    tempDir: string,
    code: string,
    harness: string,
    timeoutMs: number,
    startTime: number,
  ): Promise<ExecutionResult> {
    // Executes SQLite/DuckDB using Python's built-in sqlite3 standard library
    const runnerScript = `
import sqlite3
import sys

con = sqlite3.connect(":memory:")
cur = con.cursor()

try:
    harness = """${harness.replace(/"""/g, '\\"\\"\\"')}"""
    if harness.strip():
        cur.executescript(harness)
    
    code = """${code.replace(/"""/g, '\\"\\"\\"')}"""
    cur.execute(code)
    rows = cur.fetchall()
    
    # Print headers if available
    if cur.description:
        headers = [d[0] for d in cur.description]
        print(" | ".join(headers))
        print("-" * (len(" | ".join(headers)) + 4))
    for row in rows:
        print(" | ".join(str(v) for v in row))
    print(f"\\n({len(rows)} rows returned)")
except Exception as e:
    print(f"SQL Error: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1)
finally:
    con.close()
`;
    const scriptPath = path.join(tempDir, 'sql_runner.py');
    await fs.writeFile(scriptPath, runnerScript, 'utf-8');
    return this.runProcess('python', [scriptPath], tempDir, timeoutMs, startTime);
  }

  private async executeCpp(
    tempDir: string,
    code: string,
    harness: string,
    timeoutMs: number,
    startTime: number,
  ): Promise<ExecutionResult> {
    const srcPath = path.join(tempDir, 'solution.cpp');
    const outPath = path.join(tempDir, process.platform === 'win32' ? 'solution.exe' : 'solution');
    const fullScript = `${code}\n\n// --- Evaluation Harness ---\n${harness}`;
    await fs.writeFile(srcPath, fullScript, 'utf-8');

    // Compile first
    const compileResult = await this.runProcess('g++', ['-O2', '-Wall', srcPath, '-o', outPath], tempDir, 10000, startTime);
    if (compileResult.exitCode !== 0) {
      return {
        ...compileResult,
        status: 'compile_error',
      };
    }

    // Run executable
    return this.runProcess(outPath, [], tempDir, timeoutMs, startTime);
  }

  private async executeJava(
    tempDir: string,
    code: string,
    harness: string,
    timeoutMs: number,
    startTime: number,
  ): Promise<ExecutionResult> {
    const srcPath = path.join(tempDir, 'Solution.java');
    const fullScript = `${code}\n\n// --- Evaluation Harness ---\n${harness}`;
    await fs.writeFile(srcPath, fullScript, 'utf-8');

    // Compile first
    const compileResult = await this.runProcess('javac', [srcPath], tempDir, 10000, startTime);
    if (compileResult.exitCode !== 0) {
      return {
        ...compileResult,
        status: 'compile_error',
      };
    }

    // Run Solution
    return this.runProcess('java', ['Solution'], tempDir, timeoutMs, startTime);
  }

  private runProcess(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    startTime: number,
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killed = false;

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
          },
          shell: false,
        });
      } catch (err) {
        const durationMs = Date.now() - startTime;
        return resolve({
          status: 'runtime_error',
          stdout: '',
          stderr: `Failed to spawn ${command}: ${err instanceof Error ? err.message : String(err)}`,
          exitCode: 1,
          durationMs,
        });
      }

      child.stdout?.on('error', () => {});
      child.stderr?.on('error', () => {});

      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        try {
          child.kill();
        } catch {
          // Process might already be closed
        }
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) {
          stdout += chunk.toString('utf-8');
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) {
          stderr += chunk.toString('utf-8');
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          status: 'runtime_error',
          stdout,
          stderr: stderr || err.message,
          exitCode: 1,
          durationMs,
        });
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const codeNum = exitCode ?? (killed ? 137 : 1);

        let status: ExecutionStatus = 'passed';
        if (timedOut) {
          status = 'timeout';
          stderr = `${stderr}\nExecution timed out after ${timeoutMs}ms.`.trim();
        } else if (codeNum !== 0) {
          status = 'runtime_error';
        }

        resolve({
          status,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: codeNum,
          durationMs,
        });
      });
    });
  }
}
