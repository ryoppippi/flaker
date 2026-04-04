import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { generateFixture } from "../../src/cli/eval/fixture-generator.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";
import { analyzeProject, recommendSampling } from "../../src/cli/commands/calibrate.js";
import { trainModel } from "../../src/cli/commands/train.js";
import { planSample } from "../../src/cli/commands/sample.js";
import { runInsights } from "../../src/cli/commands/insights.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("data accumulation pipeline", () => {
  let store: DuckDBStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    tmpDir = join(tmpdir(), `flaker-pipeline-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("calibrate detects project characteristics from accumulated data", async () => {
    const fixture = generateFixture({
      testCount: 100,
      commitCount: 50,
      flakyRate: 0.1,
      coFailureStrength: 0.8,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const profile = await analyzeProject(store, {
      hasResolver: true,
      hasGBDTModel: false,
    });

    expect(profile.testCount).toBe(100);
    expect(profile.commitCount).toBe(50);
    expect(profile.flakyRate).toBeGreaterThan(0);
    expect(profile.coFailureStrength).toBeGreaterThan(0);

    const sampling = recommendSampling(profile);
    expect(sampling.strategy).toBe("hybrid");
    expect(sampling.percentage).toBe(30); // 100 tests → 30%
  });

  it("train produces model from accumulated fixture data", async () => {
    const fixture = generateFixture({
      testCount: 50,
      commitCount: 30,
      flakyRate: 0.15,
      coFailureStrength: 0.7,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 123,
    });
    await loadFixtureIntoStore(store, fixture);

    const modelPath = join(tmpDir, "gbdt.json");
    const result = await trainModel({
      store,
      storagePath: join(tmpDir, "data.duckdb"),
      outputPath: modelPath,
      numTrees: 5,
      learningRate: 0.2,
    });

    expect(result.trainingRows).toBeGreaterThan(0);
    expect(result.positiveCount).toBeGreaterThan(0);
    expect(result.negativeCount).toBeGreaterThan(0);
    expect(result.ciRows).toBeGreaterThan(0);
    expect(result.localRows).toBe(0); // fixture uses CI source
  });

  it("planSample uses accumulated data for weighted strategy", async () => {
    const fixture = generateFixture({
      testCount: 100,
      commitCount: 50,
      flakyRate: 0.1,
      coFailureStrength: 0.8,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const plan = await planSample({
      store,
      count: 20,
      mode: "weighted",
      seed: 42,
    });

    expect(plan.sampled).toHaveLength(20);
    // Flaky tests should be weighted higher
    const flakyTests = fixture.tests.filter((t) => t.isFlaky).map((t) => t.suite);
    const sampledFlakyCount = plan.sampled.filter((s) =>
      flakyTests.includes(s.suite),
    ).length;
    // With 10% flaky rate and weighted strategy, flaky tests should be overrepresented
    expect(sampledFlakyCount).toBeGreaterThanOrEqual(2);
  });

  it("incremental accumulation increases data and changes calibration", async () => {
    // Phase 1: small dataset
    const fixture1 = generateFixture({
      testCount: 50,
      commitCount: 10,
      flakyRate: 0.05,
      coFailureStrength: 0.5,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 1,
    });
    await loadFixtureIntoStore(store, fixture1);

    const profile1 = await analyzeProject(store, {
      hasResolver: true,
      hasGBDTModel: false,
    });
    expect(profile1.commitCount).toBe(10);

    // Phase 2: add more data (simulate passage of time)
    const fixture2 = generateFixture({
      testCount: 50,
      commitCount: 20,
      flakyRate: 0.05,
      coFailureStrength: 0.5,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 2,
    });
    // Load with offset IDs to avoid conflicts
    const baseTime = Date.now();
    for (let i = 0; i < fixture2.commits.length; i++) {
      const commit = fixture2.commits[i];
      const runId = 1000 + i;
      const createdAt = new Date(baseTime + i * 86400000);
      await store.insertWorkflowRun({
        id: runId,
        repo: "fixture/repo",
        branch: "main",
        commitSha: `phase2-${commit.sha}`,
        event: "push",
        status: "completed",
        createdAt,
        durationMs: 60000,
      });
      await store.insertCommitChanges(
        `phase2-${commit.sha}`,
        commit.changedFiles.map((f) => ({
          filePath: f.filePath,
          changeType: f.changeType,
          additions: 10,
          deletions: 5,
        })),
      );
      await store.insertTestResults(
        commit.testResults.map((r) => ({
          workflowRunId: runId,
          suite: r.suite,
          testName: r.testName,
          status: r.status,
          durationMs: 100,
          retryCount: 0,
          errorMessage: r.status === "failed" ? "fixture failure" : null,
          commitSha: `phase2-${commit.sha}`,
          variant: null,
          createdAt,
        })),
      );
    }

    const profile2 = await analyzeProject(store, {
      hasResolver: true,
      hasGBDTModel: false,
    });
    expect(profile2.commitCount).toBe(30); // 10 + 20
  });

  it("local vs CI source separation works with mixed data", async () => {
    const now = new Date();
    const mk = (id: number, sha: string, source: "ci" | "local", event: string) =>
      store.insertWorkflowRun({ id, repo: "test/repo", branch: "main", commitSha: sha, event, source, status: "success", createdAt: now, durationMs: 100 });
    const ins = (runId: number, sha: string, tests: Array<{ name: string; status: string }>) =>
      store.insertTestResults(tests.map((t) => ({
        workflowRunId: runId, suite: "a.test.ts", testName: t.name, status: t.status,
        commitSha: sha, durationMs: 10, retryCount: 0, errorMessage: null, variant: null, createdAt: now,
      })));

    // 2 CI runs to satisfy HAVING >= 2
    await mk(1, "ci-sha1", "ci", "push");
    await ins(1, "ci-sha1", [
      { name: "stable", status: "passed" },
      { name: "flaky-ci", status: "failed" },
      { name: "flaky-local", status: "passed" },
    ]);
    await mk(2, "ci-sha2", "ci", "push");
    await ins(2, "ci-sha2", [
      { name: "stable", status: "passed" },
      { name: "flaky-ci", status: "passed" },
      { name: "flaky-local", status: "passed" },
    ]);

    // 2 local runs
    await mk(3, "local-sha1", "local", "flaker-local-run");
    await ins(3, "local-sha1", [
      { name: "stable", status: "passed" },
      { name: "flaky-ci", status: "passed" },
      { name: "flaky-local", status: "failed" },
    ]);
    await mk(4, "local-sha2", "local", "flaker-local-run");
    await ins(4, "local-sha2", [
      { name: "stable", status: "passed" },
      { name: "flaky-ci", status: "passed" },
      { name: "flaky-local", status: "passed" },
    ]);

    // calibrate should use CI data only
    const profile = await analyzeProject(store, { hasResolver: false, hasGBDTModel: false });
    // CI: 3 tests, flaky-ci has 1 fail → flakyRate = 1/3
    expect(profile.flakyRate).toBeCloseTo(0.333, 1);

    // insights should show divergence
    const insights = await runInsights({ store });
    expect(insights.summary.ciOnlyCount).toBe(1); // flaky-ci
    expect(insights.summary.localOnlyCount).toBe(1); // flaky-local
  });

  it("full pipeline: accumulate → calibrate → train → sample", { timeout: 30000 }, async () => {
    const fixture = generateFixture({
      testCount: 50,
      commitCount: 30,
      flakyRate: 0.1,
      coFailureStrength: 0.7,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    // 1. Calibrate
    const profile = await analyzeProject(store, {
      hasResolver: true,
      hasGBDTModel: false,
    });
    expect(profile.testCount).toBe(50);
    expect(profile.commitCount).toBe(30);
    const sampling = recommendSampling(profile);
    expect(sampling.strategy).toBe("hybrid");
    expect(sampling.percentage).toBe(50); // 50 tests → 50%

    // 2. Train
    const modelPath = join(tmpDir, "gbdt.json");
    const trainResult = await trainModel({
      store,
      storagePath: join(tmpDir, "data.duckdb"),
      outputPath: modelPath,
      numTrees: 10,
      learningRate: 0.2,
    });
    expect(trainResult.trainingRows).toBeGreaterThan(50);

    // 3. Sample with trained model (gbdt strategy)
    const gbdtPlan = await planSample({
      store,
      count: 20,
      mode: "gbdt",
      seed: 42,
      modelPath,
    });
    expect(gbdtPlan.sampled).toHaveLength(20);

    // 4. Sample with hybrid (the recommended strategy)
    const hybridPlan = await planSample({
      store,
      count: 20,
      mode: "hybrid",
      seed: 42,
      changedFiles: fixture.commits[fixture.commits.length - 1].changedFiles.map((f) => f.filePath),
      resolver: {
        resolve(changed, allTests) {
          const affected = new Set<string>();
          for (const file of changed) {
            for (const suite of fixture.fileDeps.get(file) ?? []) {
              if (allTests.includes(suite)) affected.add(suite);
            }
          }
          return [...affected];
        },
      },
    });
    expect(hybridPlan.sampled).toHaveLength(20);

    // Hybrid should prioritize affected tests
    const lastCommitFiles = fixture.commits[fixture.commits.length - 1].changedFiles.map((f) => f.filePath);
    const affectedSuites = new Set<string>();
    for (const file of lastCommitFiles) {
      for (const suite of fixture.fileDeps.get(file) ?? []) {
        affectedSuites.add(suite);
      }
    }
    const affectedInSample = hybridPlan.sampled.filter((s) => affectedSuites.has(s.suite));
    expect(affectedInSample.length).toBeGreaterThan(0);
  });
});
