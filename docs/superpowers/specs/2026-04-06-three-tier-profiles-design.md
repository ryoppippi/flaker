# Three-Tier Test Execution Profiles

## Problem

flaker currently has a single `[sampling]` section in `flaker.toml`. This forces the same sampling strategy across all execution contexts: nightly full runs, CI selective runs, and local development runs. These three contexts have fundamentally different goals and constraints.

## Design

Three execution profiles, each with distinct purpose:

| Profile | Purpose | Strategy | Trigger |
|---------|---------|----------|---------|
| `daily` | Full test execution, data accumulation for downstream profiles | `full` (all tests) | Scheduled workflow, explicit `--profile daily` |
| `ci` | Selective execution on PR push, balanced between coverage and speed | `hybrid` / `weighted`, adaptive percentage | Auto-detected via `CI=true`, or `--profile ci` |
| `local` | Fast feedback during development, dependency-based filtering with time budget | `affected` + time constraint | Default when not in CI, or `--profile local` |

Data flows downstream: daily accumulates history -> CI uses that history for smarter sampling -> local uses dependency graph for instant feedback.

## Configuration

### `flaker.toml` schema

```toml
[sampling]
# Fallback for unspecified profile fields
strategy = "hybrid"
percentage = 30

[profile.daily]
strategy = "full"

[profile.ci]
strategy = "hybrid"
percentage = 30          # Base value from calibrate; runtime may lower it
holdout_ratio = 0.1
adaptive = true          # Enable runtime dynamic adjustment

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"  # Used when affected exceeds time budget
```

### Config type changes

```typescript
// New types
interface ProfileConfig {
  strategy: string;
  percentage?: number;
  holdout_ratio?: number;
  co_failure_days?: number;
  adaptive?: boolean;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

// FlakerConfig additions
interface FlakerConfig {
  // ... existing fields ...
  sampling?: SamplingConfig;          // Kept for backward compat / fallback
  profile?: Record<string, ProfileConfig>;  // New: named profiles
}
```

### Backward compatibility

If `[profile.*]` sections are absent, `[sampling]` is used directly as today. This is a non-breaking change.

## CLI

```bash
flaker run                      # Auto-detect profile
flaker run --profile daily      # Explicit profile
flaker run --profile ci
flaker run --profile local
```

### Environment auto-detection

Resolution order for `--profile` when omitted:

1. `FLAKER_PROFILE` environment variable (if set)
2. `CI=true` or `GITHUB_ACTIONS=true` -> `ci`
3. Otherwise -> `local`

`daily` is never auto-detected; it must be explicitly specified (intended for scheduled workflows only).

## Runtime Adaptive Percentage (CI profile)

When `adaptive = true` in a profile:

1. At run time, query DB for recent KPI: false negative rate (tests that failed in full runs but were not selected by sampling).
2. If false negative rate is below threshold, reduce percentage stepwise:
   - FNR < 2% and current percentage > 15% -> reduce by 5pp
   - FNR < 1% and current percentage > 10% -> reduce by 5pp
   - Floor: never go below 10%
3. If false negative rate exceeds threshold, increase percentage back toward configured value.
4. The effective percentage is reported in the sampling summary output, with reason.

### Adaptive thresholds config (optional, with defaults)

```toml
[profile.ci]
adaptive = true
adaptive_fnr_low = 0.02    # Below this: safe to reduce
adaptive_fnr_high = 0.05   # Above this: increase back
adaptive_min_percentage = 10
adaptive_step = 5
```

## Local Time-Budget Flow

When `max_duration_seconds` is set:

1. Run `affected` resolver to get candidate tests from dependency graph.
2. Sort candidates by priority (co-failure boost, flaky rate, recent failure).
3. Accumulate `avg_duration_ms` until the time budget is reached.
4. If all affected tests fit within the budget, run them all.
5. If they exceed the budget, select top-priority tests up to the budget using `fallback_strategy` (default: `weighted`).
6. Skipped tests are reported in the summary as "skipped by time budget: N tests (est. Xm)".

## Implementation Scope

### Files to modify

- `src/cli/config.ts` — Add `ProfileConfig` type, profile parsing, `resolveProfile()` function
- `src/cli/commands/run.ts` — Accept `--profile` flag, merge profile config into `RunOpts`
- `src/cli/commands/sample.ts` — Support `max_duration_seconds` and time-budget filtering
- `src/cli/commands/sampling-options.ts` — Add `"full"` to `SAMPLING_MODES`
- `src/cli/entry.ts` — Wire `--profile` CLI option

### New files

- `src/cli/profile.ts` — Profile resolution logic (auto-detect, merge with defaults, adaptive adjustment)

### Files unchanged

- MoonBit core sampling logic — no changes needed; profile resolution happens in the CLI layer
- Storage/DB schema — no changes needed; adaptive reads existing KPI queries

## Testing Strategy

- Unit tests for profile resolution (auto-detect logic, merge precedence)
- Unit tests for adaptive percentage calculation (given FNR, compute effective percentage)
- Unit tests for time-budget filtering (given durations, verify correct cutoff)
- Integration test: `--profile daily` runs all tests (strategy=full bypasses sampling)
- Integration test: `--profile local` with `max_duration_seconds` respects budget
