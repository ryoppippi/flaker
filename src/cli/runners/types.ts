import type { TestCaseResult } from "../adapters/types.js";

export interface TestId {
  suite: string;
  testName: string;
}

export interface ExecuteOpts {
  cwd?: string;
  timeout?: number;
  retries?: number;
  env?: Record<string, string>;
}

export interface ExecuteResult {
  exitCode: number;
  results: TestCaseResult[];
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface RunnerAdapter {
  name: string;
  execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult>;
  listTests(opts?: ExecuteOpts): Promise<TestId[]>;
}
