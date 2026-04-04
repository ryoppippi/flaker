/**
 * Minimal Gradient Boosted Decision Tree implementation.
 * Pure TypeScript, no external dependencies.
 * Enough for proving the ML pipeline; replace with LightGBM later.
 */

export interface TrainingRow {
  features: number[];
  label: number; // 0 or 1
}

export interface DecisionStump {
  featureIdx: number;
  threshold: number;
  leftValue: number;  // prediction if feature <= threshold
  rightValue: number; // prediction if feature > threshold
}

export interface GBDTModel {
  trees: DecisionStump[];
  learningRate: number;
  featureNames: string[];
  baseScore: number;
}

/** Sigmoid function */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Find the best split for a single feature (decision stump).
 *  O(n log n) via sorted prefix sums instead of O(n²). */
function findBestSplit(
  features: number[],
  residuals: number[],
  weights: number[],
): { threshold: number; leftValue: number; rightValue: number; gain: number } {
  const n = features.length;
  const indices = features.map((_, i) => i).sort((a, b) => features[a] - features[b]);

  // Compute total sums
  let totalResidualSum = 0;
  let totalWeightSum = 0;
  for (let i = 0; i < n; i++) {
    totalResidualSum += residuals[indices[i]];
    totalWeightSum += weights[indices[i]];
  }

  let bestGain = -Infinity;
  let bestThreshold = 0;
  let bestLeftValue = 0;
  let bestRightValue = 0;

  // Sweep left-to-right, accumulating left sums
  let leftSum = 0;
  let leftWeightSum = 0;

  for (let i = 0; i < n - 1; i++) {
    const idx = indices[i];
    leftSum += residuals[idx];
    leftWeightSum += weights[idx];

    // Skip if same feature value as next (no valid split between equal values)
    if (features[indices[i]] === features[indices[i + 1]]) continue;

    const rightSum = totalResidualSum - leftSum;
    const rightWeightSum = totalWeightSum - leftWeightSum;

    if (leftWeightSum === 0 || rightWeightSum === 0) continue;

    const gain = (leftSum * leftSum) / leftWeightSum + (rightSum * rightSum) / rightWeightSum;

    if (gain > bestGain) {
      bestGain = gain;
      bestThreshold = (features[indices[i]] + features[indices[i + 1]]) / 2;
      bestLeftValue = leftSum / leftWeightSum;
      bestRightValue = rightSum / rightWeightSum;
    }
  }

  return { threshold: bestThreshold, leftValue: bestLeftValue, rightValue: bestRightValue, gain: bestGain };
}

/** Train a GBDT model */
export function trainGBDT(
  data: TrainingRow[],
  opts: {
    numTrees?: number;
    learningRate?: number;
    featureNames?: string[];
  } = {},
): GBDTModel {
  const numTrees = opts.numTrees ?? 10;
  const learningRate = opts.learningRate ?? 0.1;
  const n = data.length;
  if (n === 0) {
    return { trees: [], learningRate, featureNames: opts.featureNames ?? [], baseScore: 0 };
  }
  const featureNames = opts.featureNames ?? data[0].features.map((_, i) => `f${i}`);

  const numFeatures = data[0].features.length;
  if (numFeatures === 0) {
    return { trees: [], learningRate, featureNames, baseScore: 0 };
  }

  // Initial prediction: log-odds of positive class
  const posCount = data.filter((d) => d.label === 1).length;
  const baseScore = Math.log((posCount + 1) / (n - posCount + 1));

  const predictions = new Array(n).fill(baseScore);
  const trees: DecisionStump[] = [];

  for (let t = 0; t < numTrees; t++) {
    // Compute residuals (negative gradient of log loss)
    const probs = predictions.map(sigmoid);
    const residuals = data.map((d, i) => d.label - probs[i]);
    const weights = probs.map((p) => p * (1 - p)); // Hessians

    // Find best stump across all features
    let bestStump: DecisionStump = { featureIdx: 0, threshold: 0, leftValue: 0, rightValue: 0 };
    let bestGain = -Infinity;

    for (let f = 0; f < numFeatures; f++) {
      const featureValues = data.map((d) => d.features[f]);
      const split = findBestSplit(featureValues, residuals, weights);

      if (split.gain > bestGain) {
        bestGain = split.gain;
        bestStump = {
          featureIdx: f,
          threshold: split.threshold,
          leftValue: split.leftValue,
          rightValue: split.rightValue,
        };
      }
    }

    trees.push(bestStump);

    // Update predictions
    for (let i = 0; i < n; i++) {
      const value = data[i].features[bestStump.featureIdx] <= bestStump.threshold
        ? bestStump.leftValue
        : bestStump.rightValue;
      predictions[i] += learningRate * value;
    }
  }

  return { trees, learningRate, featureNames, baseScore };
}

/** Predict probability of label=1 for a single sample */
export function predictGBDT(model: GBDTModel, features: number[]): number {
  let score = model.baseScore;
  for (const tree of model.trees) {
    const value = features[tree.featureIdx] <= tree.threshold
      ? tree.leftValue
      : tree.rightValue;
    score += model.learningRate * value;
  }
  return sigmoid(score);
}

/** Predict for multiple samples */
export function predictBatchGBDT(model: GBDTModel, batch: number[][]): number[] {
  return batch.map((features) => predictGBDT(model, features));
}

/** Feature names used by the flaker model */
export const FLAKER_FEATURE_NAMES = [
  "flaky_rate",
  "co_failure_boost",
  "total_runs",
  "fail_count",
  "avg_duration_ms",
  "previously_failed",
  "is_new",
];

/** Extract features from TestMeta-like object */
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
