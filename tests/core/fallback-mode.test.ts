import { afterEach, describe, expect, it, vi } from "vitest";

const MISSING_BRIDGE_PATH = "file:///tmp/flaker-missing-moonbit-bridge.js";

function mockMissingMoonBitBridge() {
  vi.doMock("../../src/cli/core/build-artifact.js", () => ({
    MOONBIT_JS_BRIDGE_URL: new URL(MISSING_BRIDGE_PATH),
    resolveMoonBitJsBridgeUrl: () => new URL(MISSING_BRIDGE_PATH),
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../src/cli/core/build-artifact.js");
});

describe("fallback mode without MoonBit JS bridge", () => {
  it("loads the TypeScript core fallback", async () => {
    vi.resetModules();
    mockMissingMoonBitBridge();
    const { loadCore } = await import("../../src/cli/core/loader.js");

    const core = await loadCore();
    const flaky = core.detectFlaky({
      results: [
        { suite: "auth", test_name: "login", status: "failed", retry_count: 0 },
        { suite: "auth", test_name: "login", status: "passed", retry_count: 1 },
        { suite: "auth", test_name: "login", status: "passed", retry_count: 0 },
      ],
      threshold: 0,
      min_runs: 1,
    });

    expect(flaky.flaky_tests).toHaveLength(1);
    expect(flaky.flaky_tests[0]?.flaky_rate).toBeCloseTo(66.67, 1);

    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'node(id="app", depends_on=["auth"])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])',
      'task(id="test-app", node="app", cmd="test", needs=["test-auth"], srcs=["src/app/**"])',
    ].join("\n");

    expect(core.resolveAffected(workflow, ["src/auth/login.ts"])).toEqual([
      "test-auth",
      "test-app",
    ]);
  });

  it("falls back to TypeScript stable test identity", async () => {
    vi.resetModules();
    mockMissingMoonBitBridge();
    const { createStableTestId, resolveTestIdentity } = await import("../../src/cli/identity.js");

    const a = createStableTestId({
      suite: "tests/login.spec.ts",
      testName: "should login",
      variant: { browser: "chromium", os: "linux" },
    });
    const b = createStableTestId({
      suite: "tests/login.spec.ts",
      testName: "should login",
      variant: { os: "linux", browser: "chromium" },
    });

    expect(a).toBe(b);
    const defaultId = createStableTestId({
      suite: "tests/login.spec.ts",
      testName: "should login",
    });
    expect(
      resolveTestIdentity({
        suite: "tests/login.spec.ts",
        testName: "should login",
      }),
    ).toMatchObject({
      taskId: "tests/login.spec.ts",
      filter: null,
      variant: null,
      testId: defaultId,
    });
  });

  it("builds affected reports without the MoonBit report bridge", async () => {
    vi.resetModules();
    mockMissingMoonBitBridge();
    const { buildAffectedReportFromInputs } = await import("../../src/cli/resolvers/affected-report.js");

    const report = await buildAffectedReportFromInputs({
      resolver: "bitflow",
      changedFiles: ["src/auth/login.ts", "docs/notes.md"],
      targets: [
        { spec: "tests/auth.spec.ts", taskId: "test-auth", filter: null },
        { spec: "tests/app.spec.ts", taskId: "test-app", filter: null },
      ],
      directSelections: [
        {
          target: { spec: "tests/auth.spec.ts", taskId: "test-auth", filter: null },
          matchedPaths: ["src/auth/login.ts"],
          matchReasons: ["glob:src/auth/**"],
        },
      ],
      transitiveTasks: [
        {
          taskId: "test-app",
          includedBy: ["test-auth"],
          matchReasons: ["dependency:test-auth"],
        },
      ],
      unmatched: ["docs/notes.md"],
    });

    expect(report.summary).toEqual({
      matchedCount: 1,
      selectedCount: 2,
      unmatchedCount: 1,
    });
    expect(report.selected).toEqual([
      {
        taskId: "test-app",
        spec: "tests/app.spec.ts",
        filter: null,
        direct: false,
        includedBy: ["test-auth"],
        matchedPaths: [],
        matchReasons: ["dependency:test-auth"],
      },
      {
        taskId: "test-auth",
        spec: "tests/auth.spec.ts",
        filter: null,
        direct: true,
        includedBy: [],
        matchedPaths: ["src/auth/login.ts"],
        matchReasons: ["glob:src/auth/**"],
      },
    ]);
  });
});
