import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Sandbox } from '@e2b/code-interpreter';
import type { ExecutionResult, ExecutionStatus, SandboxExecutionOptions, SandboxExecutor } from './contracts.ts';

const DEFAULT_TIMEOUT_MS = 15000;

const stripQuotes = (value: string) => value.trim().replace(/^['"]|['"]$/g, '');

async function resolveE2BApiKey(): Promise<string | undefined> {
  if (process.env.E2B_API_KEY) return process.env.E2B_API_KEY;

  try {
    const keyFile = path.resolve(process.cwd(), process.env.E2B_KEY_FILE ?? process.env.OPENAI_KEY_FILE ?? 'keys/key.txt');
    const raw = await readFile(keyFile, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (match && match[1] === 'E2B_API_KEY') {
        return stripQuotes(match[2]);
      }
    }
  } catch {
    // Key file not present or unreadable
  }
  return undefined;
}

export class E2BSandboxExecutor implements SandboxExecutor {
  readonly id = 'e2b-microvm';

  async execute(options: SandboxExecutionOptions): Promise<ExecutionResult> {
    const apiKey = await resolveE2BApiKey();
    if (!apiKey) {
      throw new Error(
        'E2B_API_KEY is not configured. Add E2B_API_KEY=e2b_... to keys/key.txt or .env, or set SANDBOX_EXECUTOR=local to use your local runtime.',
      );
    }

    const { language, code, harness = '', timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const startTime = Date.now();

    const sandbox = await Sandbox.create({
      apiKey,
      timeoutMs,
    });

    try {
      if (language === 'python') {
        const fullScript = `${code}\n\n# --- Evaluation Harness ---\n${harness}`;
        const res = await sandbox.runCode(fullScript);
        const durationMs = Date.now() - startTime;
        const stdout = res.logs.stdout.join('\n').trim();
        const stderr = res.error
          ? `${res.error.name}: ${res.error.value}\n${res.error.traceback ?? ''}`.trim()
          : res.logs.stderr.join('\n').trim();

        return {
          status: res.error ? 'failed' : 'passed',
          stdout,
          stderr,
          exitCode: res.error ? 1 : 0,
          durationMs,
        };
      }

      if (language === 'sql') {
        const sqlScript = `
import duckdb
con = duckdb.connect(database=":memory:")
try:
    con.execute("""${harness.replace(/"""/g, '\\"\\"\\"')}""")
    actual_df = con.execute("""${code.replace(/"""/g, '\\"\\"\\"')}""").fetchdf()
    print("=== RESULT_SUCCESS ===")
    print(actual_df.to_string(index=False))
except Exception as e:
    print(f"=== RESULT_ERROR ===\\n{type(e).__name__}: {str(e)}")
finally:
    con.close()
`;
        const res = await sandbox.runCode(sqlScript);
        const durationMs = Date.now() - startTime;
        const rawOut = res.logs.stdout.join('\n');
        const isFailed = rawOut.includes('=== RESULT_ERROR ===') || Boolean(res.error);
        const stdout = rawOut.replace('=== RESULT_SUCCESS ===', '').split('=== RESULT_ERROR ===')[0].trim();
        const stderr = isFailed
          ? (rawOut.split('=== RESULT_ERROR ===')[1] ?? res.error?.value ?? 'SQL execution error').trim()
          : '';

        return {
          status: isFailed ? 'failed' : 'passed',
          stdout,
          stderr,
          exitCode: isFailed ? 1 : 0,
          durationMs,
        };
      }

      if (language === 'cpp') {
        const fullScript = `${code}\n\n${harness}`;
        await sandbox.commands.run(`cat << 'EOF' > solution.cpp\n${fullScript}\nEOF`);
        const compileRes = await sandbox.commands.run('g++ -O2 -Wall solution.cpp -o solution');
        if (compileRes.exitCode !== 0) {
          return {
            status: 'compile_error',
            stdout: '',
            stderr: compileRes.stderr,
            exitCode: compileRes.exitCode,
            durationMs: Date.now() - startTime,
          };
        }

        const execRes = await sandbox.commands.run('./solution');
        const durationMs = Date.now() - startTime;
        return {
          status: execRes.exitCode === 0 ? 'passed' : 'runtime_error',
          stdout: execRes.stdout.trim(),
          stderr: execRes.stderr.trim(),
          exitCode: execRes.exitCode,
          durationMs,
        };
      }

      if (language === 'java') {
        const fullScript = `${code}\n\n${harness}`;
        await sandbox.commands.run(`cat << 'EOF' > Solution.java\n${fullScript}\nEOF`);
        const compileRes = await sandbox.commands.run('javac Solution.java');
        if (compileRes.exitCode !== 0) {
          return {
            status: 'compile_error',
            stdout: '',
            stderr: compileRes.stderr,
            exitCode: compileRes.exitCode,
            durationMs: Date.now() - startTime,
          };
        }

        const execRes = await sandbox.commands.run('java Solution');
        const durationMs = Date.now() - startTime;
        return {
          status: execRes.exitCode === 0 ? 'passed' : 'runtime_error',
          stdout: execRes.stdout.trim(),
          stderr: execRes.stderr.trim(),
          exitCode: execRes.exitCode,
          durationMs,
        };
      }

      // Default fallback via runCode
      const res = await sandbox.runCode(code);
      const durationMs = Date.now() - startTime;
      return {
        status: res.error ? 'failed' : 'passed',
        stdout: res.logs.stdout.join('\n').trim(),
        stderr: res.logs.stderr.join('\n').trim(),
        exitCode: res.error ? 1 : 0,
        durationMs,
      };
    } finally {
      await sandbox.kill().catch(() => undefined);
    }
  }
}
