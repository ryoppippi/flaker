# `flaker confirm` Command

## Problem

When a test starts failing, it's unclear whether it's a real regression or a flaky test. The only way to know is to re-run it multiple times. Currently this requires manual effort — running the test locally or re-triggering CI. There's no automated way to quickly distinguish broken from flaky.

## Design

### Command

```bash
# Remote (workflow_dispatch, default)
flaker confirm "tests/api.test.ts:handles timeout"
flaker confirm "tests/api.test.ts:handles timeout" --repeat 10

# Local (actrun or direct runner)
flaker confirm "tests/api.test.ts:handles timeout" --runner local
```

### Execution Modes

| Mode | Flag | Mechanism |
|------|------|-----------|
| remote (default) | `--runner remote` | `gh workflow run flaker-confirm.yml` → poll → fetch artifact |
| local | `--runner local` | Run test runner N times directly via actrun or config's `[runner]` |

### Remote Flow

1. Parse `suite:testName` from argument
2. Execute `gh workflow run flaker-confirm.yml -f suite=<suite> -f test_name=<testName> -f repeat=<N>`
3. Poll with `gh run list --workflow=flaker-confirm.yml --limit 1 --json status,databaseId` every 5 seconds
4. On completion, download artifact via `gh run download <runId> -n flaker-confirm-results`
5. Parse each result JSON with the configured adapter
6. Compute verdict and display

### Local Flow

1. Parse `suite:testName` from argument
2. For i in 1..N:
   - Execute test runner command (from `[runner]` config) targeting the specific test
   - Record pass/fail
3. Compute verdict and display

### Verdict Logic

Given N runs and F failures:

| Condition | Verdict | Message |
|-----------|---------|---------|
| F == N | `broken` | "Consistently failing. This is a regression." |
| F == 0 | `transient` | "Could not reproduce. Failure was transient." |
| 0 < F < N | `flaky` | "Intermittent failure. Flaky rate: {F/N * 100}%." |

Default N is 5. Override with `--repeat N`.

### Output Format

```
# Confirm: tests/api.test.ts > handles timeout

  Runner:   remote (flaker-confirm.yml)
  Repeat:   5
  Results:  5/5 failed

  Verdict:  BROKEN

  This is a consistent failure, not flaky.
  Investigate the regression starting from the commit that introduced it.
```

For `flaky` verdict:

```
# Confirm: tests/api.test.ts > handles timeout

  Runner:   local
  Repeat:   5
  Results:  3/5 failed

  Verdict:  FLAKY (60%)

  Intermittent failure detected.
  Consider quarantining: flaker quarantine --add "tests/api.test.ts:handles timeout"
```

### Workflow Template

`flaker init` generates `.github/workflows/flaker-confirm.yml`:

```yaml
name: flaker-confirm
on:
  workflow_dispatch:
    inputs:
      suite:
        description: "Test suite (file path)"
        required: true
      test_name:
        description: "Test name"
        required: true
      repeat:
        description: "Number of repetitions"
        default: "5"

jobs:
  confirm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - name: Run confirmation
        run: |
          for i in $(seq 1 ${{ inputs.repeat }}); do
            echo "--- Run $i/${{ inputs.repeat }} ---"
            pnpm exec vitest run "${{ inputs.suite }}" \
              -t "${{ inputs.test_name }}" \
              --reporter json \
              --outputFile "result-$i.json" || true
          done
      - uses: actions/upload-artifact@v4
        with:
          name: flaker-confirm-results
          path: result-*.json
```

The template uses vitest as default. Users should customize the test command to match their `[runner]` config. The `|| true` ensures all N runs complete even if some fail.

### DB Recording

Confirm results are stored in `test_results` with `source = 'confirm'` on the workflow_run. This data is excluded from:
- `flaker flaky` detection (confirm runs are intentional repetitions, not organic failures)
- KPI / sampling calculations
- `calibrate` recommendations

But it IS used by:
- `flaker confirm` itself (to show historical confirm results)
- `flaker reason` (as evidence for classification)

### Configuration

No new config sections needed. The command uses:
- `[repo]` — for `--repo` flag when calling `gh`
- `[runner]` — for local mode test execution
- `[adapter]` — for parsing result JSON from artifacts

### CLI Options

```
flaker confirm <suite:testName>

Options:
  --repeat <n>      Number of repetitions (default: 5)
  --runner <mode>   Execution mode: remote or local (default: remote)
  --workflow <name> Workflow filename (default: flaker-confirm.yml)
```

## Implementation Scope

### Files to create

- `src/cli/commands/confirm.ts` — Core confirm logic: verdict computation, result parsing, formatting
- `src/cli/commands/confirm-remote.ts` — Remote execution via gh workflow dispatch + polling + artifact download
- `src/cli/commands/confirm-local.ts` — Local execution via runner
- `templates/flaker-confirm.yml` — Workflow template for `flaker init`
- `tests/cli/confirm.test.ts` — Unit tests for verdict logic and formatting

### Files to modify

- `src/cli/main.ts` — Wire `confirm` command with options
- `src/cli/commands/init.ts` — Generate workflow template on `flaker init`

### Files unchanged

- MoonBit core — no changes
- Profile system — no changes
- Storage schema — reuses existing `workflow_runs` and `test_results` with `source = 'confirm'`

## Testing Strategy

- Unit tests for verdict computation: given N runs and F failures, verify correct verdict
- Unit tests for output formatting: verify all three verdict types render correctly
- Unit tests for argument parsing: `"suite:testName"` split
- Integration test for local mode: mock runner, verify N invocations and result collection
- No integration test for remote mode (requires GitHub auth) — tested manually
