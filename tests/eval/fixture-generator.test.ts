import { describe, it, expect } from "vitest";
import { loadCore, type FixtureConfig } from "../../src/cli/core/loader.js";

const defaultConfig: FixtureConfig = {
  test_count: 20,
  commit_count: 10,
  flaky_rate: 0.1,
  co_failure_strength: 0.8,
  files_per_commit: 2,
  tests_per_file: 4,
  sample_percentage: 20,
  seed: 42,
};

describe("generateFixture (MoonBit bridge)", () => {
  it("generates correct number of tests and commits", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture(defaultConfig);
    expect(fixture.tests.length).toBe(20);
    expect(fixture.commits.length).toBe(10);
  });

  it("generates file-to-test dependency map", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture(defaultConfig);
    expect(fixture.file_deps.length).toBeGreaterThan(0);
    for (const dep of fixture.file_deps) {
      expect(dep.suites.length).toBe(4);
    }
  });

  it("marks correct number of flaky tests", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture(defaultConfig);
    const flakyCount = fixture.tests.filter((t) => t.is_flaky).length;
    expect(flakyCount).toBe(2);
  });

  it("generates commit changes and test results", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture(defaultConfig);
    for (const commit of fixture.commits) {
      expect(commit.changed_files.length).toBe(2);
      expect(commit.test_results.length).toBe(20);
    }
  });

  it("is deterministic with same seed", async () => {
    const core = await loadCore();
    const a = core.generateFixture(defaultConfig);
    const b = core.generateFixture(defaultConfig);
    expect(a.commits.map((c) => c.sha)).toEqual(b.commits.map((c) => c.sha));
    expect(a.commits.map((c) => c.test_results.map((r) => r.status))).toEqual(
      b.commits.map((c) => c.test_results.map((r) => r.status)),
    );
  });

  it("co-failure strength controls failure correlation", async () => {
    const core = await loadCore();
    const strong = core.generateFixture({ ...defaultConfig, co_failure_strength: 1.0, commit_count: 50 });
    const none = core.generateFixture({ ...defaultConfig, co_failure_strength: 0.0, commit_count: 50 });

    const strongFailures = strong.commits.flatMap((c) => c.test_results.filter((r) => r.status === "failed"));
    const noneFailures = none.commits.flatMap((c) => c.test_results.filter((r) => r.status === "failed"));

    expect(strongFailures.length).toBeGreaterThan(noneFailures.length);
  });
});
