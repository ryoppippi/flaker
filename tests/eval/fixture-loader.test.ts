import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { loadCore, type FixtureConfig } from "../../src/cli/core/loader.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";

const config: FixtureConfig = {
  test_count: 20,
  commit_count: 10,
  flaky_rate: 0.1,
  co_failure_strength: 0.8,
  files_per_commit: 2,
  tests_per_file: 4,
  sample_percentage: 20,
  seed: 42,
};

describe("loadFixtureIntoStore", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("loads all workflow runs", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs",
    );
    expect(rows[0].cnt).toBe(10);
  });

  it("loads all test results", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM test_results",
    );
    expect(rows[0].cnt).toBe(200);
  });

  it("loads all commit changes", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes",
    );
    expect(rows[0].cnt).toBeGreaterThan(0);
  });

  it("co-failure query returns results after loading", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const coFailures = await store.queryCoFailures({ windowDays: 365, minCoRuns: 2 });
    expect(coFailures.length).toBeGreaterThan(0);
  });
});
