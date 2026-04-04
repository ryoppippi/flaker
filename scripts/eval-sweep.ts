/**
 * Multi-parameter sweep for sampling strategy evaluation.
 * Usage: npx tsx scripts/eval-sweep.ts
 *
 * Runs 24 combinations: testCount(2) × flakyRate(2) × coFailureStrength(3) × samplePercentage(2)
 * Takes ~4 min on a modern machine.
 */
import { runSweep } from "../src/cli/eval/fixture-evaluator.js";
import { formatMultiSweepReport } from "../src/cli/eval/fixture-report.js";

const results = await runSweep(
  {
    testCount: 100,
    commitCount: 50,
    flakyRate: 0.1,
    coFailureStrength: 0.8,
    filesPerCommit: 2,
    testsPerFile: 5,
    samplePercentage: 20,
    seed: 42,
  },
  {
    testCounts: [100, 500],
    flakyRates: [0.05, 0.2],
    coFailureStrengths: [0.3, 0.6, 0.9],
    samplePercentages: [10, 30],
  },
  async () => {
    const { DuckDBStore } = await import("../src/cli/storage/duckdb.js");
    const s = new DuckDBStore(":memory:");
    await s.initialize();
    return { store: s, close: () => s.close() };
  },
);

console.log(formatMultiSweepReport(results));
