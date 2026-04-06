import { describe, it, expect } from "vitest";
import {
  extractFeatures,
  FLAKER_FEATURE_NAMES,
} from "../../src/cli/eval/gbdt.js";
import { loadCore } from "../../src/cli/core/loader.js";

describe("GBDT (MoonBit bridge)", () => {
  it("trains and predicts on linearly separable data", async () => {
    const core = await loadCore();
    const data: { features: number[]; label: number }[] = [];
    for (let i = 0; i < 20; i++) {
      data.push({
        features: [i],
        label: i > 10 ? 1 : 0,
      });
    }

    const model = core.trainGBDT(data, 10, 0.3);

    // Low values should predict close to 0
    expect(core.predictGBDT(model, [0])).toBeLessThan(0.3);
    expect(core.predictGBDT(model, [5])).toBeLessThan(0.3);

    // High values should predict close to 1
    expect(core.predictGBDT(model, [15])).toBeGreaterThan(0.7);
    expect(core.predictGBDT(model, [19])).toBeGreaterThan(0.7);
  });

  it("handles multi-feature data", async () => {
    const core = await loadCore();
    const data: { features: number[]; label: number }[] = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        data.push({
          features: [i, j],
          label: i > 5 && j > 3 ? 1 : 0,
        });
      }
    }

    const model = core.trainGBDT(data, 20, 0.3);

    // Both features high → predict 1
    expect(core.predictGBDT(model, [8, 7])).toBeGreaterThan(0.5);
    // Feature 0 low → predict 0
    expect(core.predictGBDT(model, [2, 7])).toBeLessThan(0.5);
  });

  it("handles empty training data", async () => {
    const core = await loadCore();
    const model = core.trainGBDT([], 5, 0.1);
    expect(JSON.stringify(model)).toBeTruthy();
  });

  it("extractFeatures maps TestMeta fields correctly", () => {
    const features = extractFeatures({
      flaky_rate: 25.0,
      co_failure_boost: 100,
      total_runs: 10,
      fail_count: 3,
      avg_duration_ms: 500,
      previously_failed: true,
      is_new: false,
    });

    expect(features).toEqual([25.0, 100, 10, 3, 500, 1, 0]);
    expect(features.length).toBe(FLAKER_FEATURE_NAMES.length);
  });
});
