# Insights → Adaptive Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend adaptive percentage to use CI/local divergence rate alongside FNR, and add pipeline/holdout/adaptive theory sections to `docs/why-flaker.md`.

**Architecture:** Change `computeAdaptivePercentage` to accept an `AdaptiveSignals` object instead of a scalar. The CLI adaptive block fetches divergence data from `runInsights` and passes both signals. Documentation adds three theoretical sections.

**Tech Stack:** TypeScript, vitest, markdown

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/profile.ts` | Modify | Add `AdaptiveSignals` type, update `computeAdaptivePercentage` signature and logic |
| `src/cli/main.ts` | Modify | Update adaptive block to fetch insights and pass signals object |
| `tests/cli/profile.test.ts` | Modify | Update existing tests, add divergence-specific tests |
| `docs/why-flaker.md` | Modify | Add sections 6, 7, 8 (pipeline, holdout, adaptive) |

---

### Task 1: Update computeAdaptivePercentage to accept AdaptiveSignals

**Files:**
- Modify: `src/cli/profile.ts:53-97`
- Test: `tests/cli/profile.test.ts:255-289`

- [ ] **Step 1: Update existing tests to use new signature**

In `tests/cli/profile.test.ts`, update the import on line 6 and the `computeAdaptivePercentage` describe block (lines 255-289). Change all calls from scalar to signals object:

```typescript
// Line 6: import stays the same
import { detectProfileName, resolveProfile, computeAdaptivePercentage } from "../../src/cli/profile.js";
// Add import for the type
import type { AdaptiveSignals } from "../../src/cli/profile.js";

// Replace the entire describe("computeAdaptivePercentage", ...) block:
describe("computeAdaptivePercentage", () => {
  const defaultOpts = {
    basePercentage: 30,
    fnrLow: 0.02,
    fnrHigh: 0.05,
    minPercentage: 10,
    step: 5,
  };

  it("reduces percentage when FNR is below low threshold", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.01, divergenceRate: null }, defaultOpts);
    expect(result.percentage).toBe(25);
  });

  it("keeps percentage when FNR is between thresholds", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.03, divergenceRate: null }, defaultOpts);
    expect(result.percentage).toBe(30);
  });

  it("increases percentage when FNR exceeds high threshold", () => {
    const result = computeAdaptivePercentage(
      { falseNegativeRate: 0.06, divergenceRate: null },
      { ...defaultOpts, basePercentage: 20 },
    );
    expect(result.percentage).toBe(25);
  });

  it("never goes below minPercentage", () => {
    const result = computeAdaptivePercentage(
      { falseNegativeRate: 0.001, divergenceRate: null },
      { ...defaultOpts, basePercentage: 12, minPercentage: 10 },
    );
    expect(result.percentage).toBeGreaterThanOrEqual(10);
  });

  it("returns base percentage when both signals are null (no data)", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: null, divergenceRate: null }, defaultOpts);
    expect(result.percentage).toBe(30);
    expect(result.reason).toContain("no data");
  });

  it("uses divergence rate when FNR is null", () => {
    const result = computeAdaptivePercentage(
      { falseNegativeRate: null, divergenceRate: 0.06 },
      { ...defaultOpts, basePercentage: 20 },
    );
    expect(result.percentage).toBe(25);
    expect(result.reason).toContain("divergence");
  });

  it("uses worse signal when both are present", () => {
    // FNR is fine (0.01) but divergence is bad (0.08)
    const result = computeAdaptivePercentage(
      { falseNegativeRate: 0.01, divergenceRate: 0.08 },
      { ...defaultOpts, basePercentage: 20 },
    );
    expect(result.percentage).toBe(25); // increased due to divergence
    expect(result.reason).toContain("divergence");
  });

  it("reduces when both signals are low", () => {
    const result = computeAdaptivePercentage(
      { falseNegativeRate: 0.005, divergenceRate: 0.01 },
      defaultOpts,
    );
    expect(result.percentage).toBe(25); // reduced
  });

  it("reason includes both signal values when both present", () => {
    const result = computeAdaptivePercentage(
      { falseNegativeRate: 0.03, divergenceRate: 0.04 },
      defaultOpts,
    );
    expect(result.reason).toContain("FNR");
    expect(result.reason).toContain("divergence");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/cli/profile.test.ts`
Expected: FAIL — `computeAdaptivePercentage` expects a number, not an object

- [ ] **Step 3: Update computeAdaptivePercentage implementation**

In `src/cli/profile.ts`, replace the `AdaptivePercentageOpts`, `AdaptivePercentageResult`, and `computeAdaptivePercentage` (lines 53-97):

```typescript
export interface AdaptiveSignals {
  falseNegativeRate: number | null;
  divergenceRate: number | null;
}

export interface AdaptivePercentageOpts {
  basePercentage: number;
  fnrLow: number;
  fnrHigh: number;
  minPercentage: number;
  step: number;
}

export interface AdaptivePercentageResult {
  percentage: number;
  reason: string;
}

function formatSignals(signals: AdaptiveSignals): string {
  const parts: string[] = [];
  if (signals.falseNegativeRate != null) {
    parts.push(`FNR ${(signals.falseNegativeRate * 100).toFixed(1)}%`);
  }
  if (signals.divergenceRate != null) {
    parts.push(`divergence ${(signals.divergenceRate * 100).toFixed(1)}%`);
  }
  return parts.join(", ");
}

export function computeAdaptivePercentage(
  signals: AdaptiveSignals,
  opts: AdaptivePercentageOpts,
): AdaptivePercentageResult {
  const fnr = signals.falseNegativeRate;
  const div = signals.divergenceRate;

  // No data at all
  if (fnr == null && div == null) {
    return {
      percentage: opts.basePercentage,
      reason: "adaptive: no data, using base percentage",
    };
  }

  // Use the worse (higher) signal for conservative decision
  const effectiveRate = Math.max(fnr ?? 0, div ?? 0);
  const driverSignal = (div ?? 0) > (fnr ?? 0) ? "divergence" : "FNR";
  const signalStr = formatSignals(signals);

  if (effectiveRate < opts.fnrLow) {
    const reduced = Math.max(opts.minPercentage, opts.basePercentage - opts.step);
    return {
      percentage: reduced,
      reason: `adaptive: ${signalStr} < ${(opts.fnrLow * 100).toFixed(0)}% threshold, reduced to ${reduced}%`,
    };
  }

  if (effectiveRate > opts.fnrHigh) {
    const increased = opts.basePercentage + opts.step;
    return {
      percentage: increased,
      reason: `adaptive: ${driverSignal} ${(effectiveRate * 100).toFixed(1)}% > ${(opts.fnrHigh * 100).toFixed(0)}% threshold (${signalStr}), increased to ${increased}%`,
    };
  }

  return {
    percentage: opts.basePercentage,
    reason: `adaptive: ${signalStr} within target range, keeping ${opts.basePercentage}%`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/cli/profile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/profile.ts tests/cli/profile.test.ts
git commit -m "feat: extend computeAdaptivePercentage to accept dual signals (FNR + divergence)"
```

---

### Task 2: Wire insights into CLI adaptive block

**Files:**
- Modify: `src/cli/main.ts:634-650`

- [ ] **Step 1: Add runInsights import**

At the top of `src/cli/main.ts`, find the existing insights-related import or add a new one. Check if `runInsights` is already imported; if not, add:

```typescript
import { runInsights } from "./commands/insights.js";
```

- [ ] **Step 2: Update the adaptive block in the run command**

In `src/cli/main.ts`, replace lines 634-650 (the adaptive percentage adjustment block):

```typescript
        // Adaptive percentage adjustment
        const profile = opts.resolvedProfile;
        if (profile.adaptive && opts.percentage != null) {
          const kpiData = await computeKpi(store);
          const insightsData = await runInsights({ store });
          const divergenceRate = insightsData.summary.totalTests > 0
            ? insightsData.summary.ciOnlyCount / insightsData.summary.totalTests
            : null;
          const adaptive = computeAdaptivePercentage(
            {
              falseNegativeRate: kpiData.sampling.falseNegativeRate,
              divergenceRate,
            },
            {
              basePercentage: opts.percentage,
              fnrLow: profile.adaptive_fnr_low,
              fnrHigh: profile.adaptive_fnr_high,
              minPercentage: profile.adaptive_min_percentage,
              step: profile.adaptive_step,
            },
          );
          opts.percentage = adaptive.percentage;
          console.log(`# Adaptive: ${adaptive.reason}`);
        }
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm exec vitest run`
Expected: All tests pass (no behavioral change when divergenceRate is null/0)

- [ ] **Step 4: Commit**

```bash
git add src/cli/main.ts
git commit -m "feat: wire insights divergence rate into adaptive percentage calculation"
```

---

### Task 3: Update docs/why-flaker.md with new theory sections

**Files:**
- Modify: `docs/why-flaker.md:186-187` (insert after section 5, before "---" and "Probabilistic Behavior")

- [ ] **Step 1: Add three new sections**

Insert after line 186 (after the root cause table, before the `---` on line 187):

```markdown

### 6. Execution Pipeline: Three-Tier Feedback System

flaker operates as a three-tier data pipeline, not a single sampling algorithm:

```
Daily (full)  →  accumulates history  →  feeds CI sampling quality
CI (hybrid)   →  selective execution  →  validates via holdout
Local (affected)  →  fast feedback    →  compensated by divergence signal
```

**Daily tier:** Runs all tests on a schedule (e.g., nightly). This is the **training data source** — it builds the co-failure correlation matrix, establishes baseline flaky rates, and provides the ground truth against which selective runs are measured.

**CI tier:** On every PR push, runs a subset selected by `hybrid` strategy. The subset size is adaptive — if historical data shows low false negative rates, the percentage decreases (saving CI time). If false negatives increase, it automatically expands. Holdout tests provide real-time quality measurement.

**Local tier:** During development, runs only tests affected by the current `git diff` via dependency graph analysis. When the affected set exceeds a time budget, tests are prioritized by co-failure boost and flaky rate. The divergence signal (tests that fail in CI but never locally) automatically expands the local test set to compensate for dependency graph gaps.

This creates a **feedback control system**:
1. Daily accumulates data → CI uses it for smarter sampling
2. CI's holdout measures sampling quality → adaptive adjusts percentage
3. CI vs local divergence measures affected accuracy → local expands coverage

Each tier's output improves the next tier's decisions. The system converges toward the minimum test execution that maintains a target false negative rate.

**References:**
- Memon et al., "Taming Google-Scale Continuous Testing" (ICSE-SEIP 2017) — multi-tier execution at Google
- Machalica et al., "Predictive Test Selection" (ICSE-SEIP 2019) — Meta's feedback-driven selection

### 7. Holdout Verification: Measuring What You Don't Run

The fundamental problem with selective test execution: **you can't know what you missed unless you check**. flaker's holdout mechanism addresses this by borrowing from clinical trial methodology.

When flaker selects k tests from n total, it also randomly selects a fraction (default 10%) of the **skipped** tests and runs them anyway. These holdout tests serve as a control group:

```
Total tests: 1000
Sampled (run normally): 300
Skipped: 700
Holdout (from skipped, run as verification): 70
Truly skipped: 630
```

If holdout tests all pass, the sampling strategy is working — we can be confident we're not missing real failures. If holdout tests fail, we have direct evidence that sampling missed a bug.

The **holdout false negative rate** is:

```
holdout_FNR = holdout_failures / holdout_total
```

This is an unbiased estimator of the true FNR across all skipped tests. With 70 holdout tests and a 95% confidence interval, we can detect FNR > 4% — sufficient for practical decision-making.

Holdout FNR is the primary input to adaptive percentage adjustment (section 8).

### 8. Adaptive Sampling: Dual-Signal Feedback Control

flaker automatically adjusts sampling percentage based on two quality signals:

**Signal 1: False Negative Rate (FNR)** — from holdout verification. Measures whether sampling is missing bugs that exist in CI.

**Signal 2: Divergence Rate** — from CI vs local comparison (`insights`). Measures `ciOnlyCount / totalTests` — the fraction of tests that fail in CI but never fail locally.

The system uses the **worse (higher) signal** for conservative decisions:

```
effectiveRate = max(FNR, divergenceRate)

if effectiveRate < lowThreshold  → reduce percentage by step
if effectiveRate > highThreshold → increase percentage by step
otherwise                        → keep current percentage
```

This is analogous to a **proportional controller** where:
- The setpoint is the target range [lowThreshold, highThreshold]
- The process variable is the effective quality signal
- The control output is the sampling percentage

**Why two signals?** FNR measures sampling quality directly but requires matched commits (same SHA run both locally and in CI). Divergence rate measures affected resolver quality and is available even without matched commits. Together they cover both failure modes:

| Signal | Measures | Failure mode detected |
|--------|----------|----------------------|
| FNR | Sampling missed a CI failure | Wrong tests selected |
| Divergence | Local never sees CI failures | Dependency graph gaps |

**Convergence:** With sufficient daily data, the system finds the minimum percentage that keeps both signals below the high threshold. A project with a good dependency graph and low flaky rate may converge to 10-15%. A project with poor dependency data stays at 30%+ until the data improves.
```

- [ ] **Step 2: Verify document renders correctly**

Run: `head -300 docs/why-flaker.md | tail -120` to check the new sections are properly formatted.

- [ ] **Step 3: Commit**

```bash
git add docs/why-flaker.md
git commit -m "docs: add pipeline model, holdout verification, and adaptive sampling theory"
```
