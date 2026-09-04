import type { ExecutionResult, ExecutionStatus, SupportedCodeLanguage } from '../../shared/contracts.ts';

export type SandboxExecutionOptions = {
  language: SupportedCodeLanguage;
  code: string;
  harness?: string;
  timeoutMs?: number;
};

export interface SandboxExecutor {
  readonly id: string;
  execute(options: SandboxExecutionOptions): Promise<ExecutionResult>;
}

export type { ExecutionResult, ExecutionStatus, SupportedCodeLanguage };
