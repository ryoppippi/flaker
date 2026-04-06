/**
 * GBDT feature extraction and types.
 * All computation (train/predict) is delegated to the MoonBit core via the bridge.
 */

export interface GBDTModel {
  trees: { featureIdx: number; threshold: number; leftValue: number; rightValue: number }[];
  learningRate: number;
  featureNames: string[];
  baseScore: number;
}

export const FLAKER_FEATURE_NAMES = [
  "flaky_rate",
  "co_failure_boost",
  "total_runs",
  "fail_count",
  "avg_duration_ms",
  "previously_failed",
  "is_new",
];

export function extractFeatures(test: {
  flaky_rate: number;
  co_failure_boost?: number | null;
  total_runs: number;
  fail_count: number;
  avg_duration_ms: number;
  previously_failed: boolean;
  is_new: boolean;
}): number[] {
  return [
    test.flaky_rate,
    test.co_failure_boost ?? 0,
    test.total_runs,
    test.fail_count,
    test.avg_duration_ms,
    test.previously_failed ? 1 : 0,
    test.is_new ? 1 : 0,
  ];
}
