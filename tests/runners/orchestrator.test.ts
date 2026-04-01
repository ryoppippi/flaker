import { describe, it, expect } from "vitest";
import { orchestrate } from "../../src/cli/runners/orchestrator.js";
import type { RunnerAdapter, RunnerCapabilities, TestId, ExecuteOpts, ExecuteResult } from "../../src/cli/runners/types.js";

function makeTests(n: number): TestId[] {
  return Array.from({ length: n }, (_, i) => ({
    suite: `suite${i}`,
    testName: `test${i}`,
  }));
}

function createMockRunner(
  capabilities: RunnerCapabilities,
  opts?: { exitCodeFn?: (batch: TestId[]) => number },
): RunnerAdapter & { _calls: TestId[][] } {
  const calls: TestId[][] = [];
  return {
    name: "mock",
    capabilities,
    async execute(tests: TestId[], _opts?: ExecuteOpts): Promise<ExecuteResult> {
      calls.push([...tests]);
      const exitCode = opts?.exitCodeFn?.(tests) ?? 0;
      return {
        exitCode,
        results: tests.map((t) => ({
          suite: t.suite,
          testName: t.testName,
          status: "passed" as const,
          durationMs: 10,
          retryCount: 0,
        })),
        durationMs: 10 * tests.length,
        stdout: tests.length > 0 ? "out" : "",
        stderr: "",
      };
    },
    async listTests() {
      return [];
    },
    _calls: calls,
  };
}

describe("orchestrate", () => {
  it("empty tests returns immediately without calling execute", async () => {
    const runner = createMockRunner({ nativeParallel: true });
    const result = await orchestrate(runner, []);
    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.durationMs).toBe(0);
    expect(runner._calls).toHaveLength(0);
  });

  it("nativeParallel=true sends all tests in single execute call", async () => {
    const runner = createMockRunner({ nativeParallel: true });
    const tests = makeTests(10);
    const result = await orchestrate(runner, tests);
    expect(runner._calls).toHaveLength(1);
    expect(runner._calls[0]).toHaveLength(10);
    expect(result.results).toHaveLength(10);
  });

  it("nativeParallel=false with batchSize=3 and 10 tests makes 4 calls", async () => {
    const runner = createMockRunner({ nativeParallel: false });
    const tests = makeTests(10);
    const result = await orchestrate(runner, tests, { batchSize: 3 });
    expect(runner._calls).toHaveLength(4);
    expect(runner._calls[0]).toHaveLength(3);
    expect(runner._calls[1]).toHaveLength(3);
    expect(runner._calls[2]).toHaveLength(3);
    expect(runner._calls[3]).toHaveLength(1);
    expect(result.results).toHaveLength(10);
  });

  it("nativeParallel=false with concurrency=2 and batchSize=5 runs parallel batches", async () => {
    const runner = createMockRunner({ nativeParallel: false });
    const tests = makeTests(10);
    const result = await orchestrate(runner, tests, {
      batchSize: 5,
      concurrency: 2,
    });
    expect(runner._calls).toHaveLength(2);
    expect(runner._calls[0]).toHaveLength(5);
    expect(runner._calls[1]).toHaveLength(5);
    expect(result.results).toHaveLength(10);
  });

  it("maxBatchSize is respected even for nativeParallel=true", async () => {
    const runner = createMockRunner({
      nativeParallel: true,
      maxBatchSize: 4,
    });
    const tests = makeTests(10);
    const result = await orchestrate(runner, tests);
    expect(runner._calls).toHaveLength(3); // 4+4+2
    expect(runner._calls[0]).toHaveLength(4);
    expect(runner._calls[1]).toHaveLength(4);
    expect(runner._calls[2]).toHaveLength(2);
    expect(result.results).toHaveLength(10);
  });

  it("exitCode is max of all batch results", async () => {
    let callIndex = 0;
    const runner = createMockRunner(
      { nativeParallel: false },
      {
        exitCodeFn: () => {
          callIndex++;
          return callIndex === 2 ? 3 : 1;
        },
      },
    );
    const tests = makeTests(6);
    const result = await orchestrate(runner, tests, { batchSize: 2 });
    expect(result.exitCode).toBe(3);
  });

  it("results are merged from all batches in order", async () => {
    const runner = createMockRunner({ nativeParallel: false });
    const tests = makeTests(5);
    const result = await orchestrate(runner, tests, { batchSize: 2 });
    expect(result.results).toHaveLength(5);
    expect(result.results.map((r) => r.testName)).toEqual([
      "test0",
      "test1",
      "test2",
      "test3",
      "test4",
    ]);
  });

  it("nativeParallel=false without batchSize sends all in one call", async () => {
    const runner = createMockRunner({ nativeParallel: false });
    const tests = makeTests(7);
    const result = await orchestrate(runner, tests);
    // batchSize defaults to tests.length when no maxBatchSize
    expect(runner._calls).toHaveLength(1);
    expect(runner._calls[0]).toHaveLength(7);
    expect(result.results).toHaveLength(7);
  });

  it("uses runner maxBatchSize when no batchSize override", async () => {
    const runner = createMockRunner({
      nativeParallel: false,
      maxBatchSize: 3,
    });
    const tests = makeTests(7);
    const result = await orchestrate(runner, tests);
    expect(runner._calls).toHaveLength(3); // 3+3+1
    expect(result.results).toHaveLength(7);
  });

  it("batchSize override takes precedence over maxBatchSize", async () => {
    const runner = createMockRunner({
      nativeParallel: false,
      maxBatchSize: 3,
    });
    const tests = makeTests(10);
    const result = await orchestrate(runner, tests, { batchSize: 5 });
    expect(runner._calls).toHaveLength(2); // 5+5
    expect(result.results).toHaveLength(10);
  });
});
