import type { TestCaseResult } from "../adapters/types.js";
import type { RunnerAdapter, TestId, ExecuteOpts, ExecuteResult } from "./types.js";

export interface OrchestrateOpts extends ExecuteOpts {
  concurrency?: number;
  batchSize?: number;
}

export async function orchestrate(
  runner: RunnerAdapter,
  tests: TestId[],
  opts?: OrchestrateOpts,
): Promise<ExecuteResult> {
  if (tests.length === 0) {
    return { exitCode: 0, results: [], durationMs: 0, stdout: "", stderr: "" };
  }

  const { concurrency = 1, batchSize, ...executeOpts } = opts ?? {};

  if (runner.capabilities.nativeParallel) {
    const max = batchSize ?? runner.capabilities.maxBatchSize;
    if (max && tests.length > max) {
      return executeBatched(runner, tests, max, concurrency, executeOpts);
    }
    return runner.execute(tests, executeOpts);
  }

  const size = batchSize ?? runner.capabilities.maxBatchSize ?? tests.length;
  return executeBatched(runner, tests, size, concurrency, executeOpts);
}

async function executeBatched(
  runner: RunnerAdapter,
  tests: TestId[],
  batchSize: number,
  concurrency: number,
  opts: ExecuteOpts,
): Promise<ExecuteResult> {
  const batches: TestId[][] = [];
  for (let i = 0; i < tests.length; i += batchSize) {
    batches.push(tests.slice(i, i + batchSize));
  }

  const start = Date.now();
  const allResults: TestCaseResult[] = [];
  let maxExitCode = 0;
  const allStdout: string[] = [];
  const allStderr: string[] = [];

  if (concurrency <= 1) {
    for (const batch of batches) {
      const result = await runner.execute(batch, opts);
      allResults.push(...result.results);
      if (result.exitCode > maxExitCode) maxExitCode = result.exitCode;
      if (result.stdout) allStdout.push(result.stdout);
      if (result.stderr) allStderr.push(result.stderr);
    }
  } else {
    const executing: Promise<ExecuteResult>[] = [];
    for (let i = 0; i < batches.length; i++) {
      executing.push(runner.execute(batches[i], opts));
      if (executing.length >= concurrency || i === batches.length - 1) {
        const results = await Promise.all(executing);
        for (const result of results) {
          allResults.push(...result.results);
          if (result.exitCode > maxExitCode) maxExitCode = result.exitCode;
          if (result.stdout) allStdout.push(result.stdout);
          if (result.stderr) allStderr.push(result.stderr);
        }
        executing.length = 0;
      }
    }
  }

  return {
    exitCode: maxExitCode,
    results: allResults,
    durationMs: Date.now() - start,
    stdout: allStdout.join("\n"),
    stderr: allStderr.join("\n"),
  };
}
