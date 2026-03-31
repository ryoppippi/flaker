# metrici: Flaky Test Management & Test Sampling CLI

## Overview

大規模テストスイートにおける flaky test の検出・管理と、ローカルでのランダムサンプリング実行を提供する CLI ツール。GitHub Actions のテスト結果を DuckDB に蓄積し、統計的に flaky テストを特定・追跡する。

Chrome/Chromium の LUCI Analysis + ResultDB アーキテクチャを参考に、小規模チームでも運用可能な軽量版として設計する。

## Goals

- GitHub Actions のテスト結果を自動収集し、flaky test を統計的に検出する
- コミット履歴を追跡し、flaky の原因コミットを特定する
- ローカルで複数のサンプリング戦略（ランダム、重み付き、変更影響ベース、ハイブリッド）によるテスト実行を可能にする
- actrun との連携により、CI パイプラインを通さず失敗箇所から即座にリトライできるようにする

## Non-Goals

- Web ダッシュボード（CLI のみ提供）
- SaaS としての提供
- テストランナー自体の実装
- ML ベースの予測テスト選択（データ蓄積後の将来目標）

## Prior Art & Research

### Academic Research

| 手法 | 概要 | metrici への影響 |
|------|------|-----------------|
| DeFlaker (ICSE 2018) | 差分カバレッジベース。コード変更がカバレッジ外なら flaky と判定。recall 95.5% | Phase 2 の真の flaky 判定に採用: 同一 commit_sha で pass/fail 混在 = 真の flaky |
| FlaKat (2024) | テストコードを embedding 化し ML で root cause を分類。F1=0.94 | Phase 3 の root cause 自動分類の参考 |
| MDFlaker (2025) | traceback + test smells + 頻度 + サイズの4因子スコアリング | flaky_score の多因子化に参考 |
| FlakyGuard (ASE 2025) | グラフベースコンテキスト選択 + LLM で自動修復。47.6% 修復成功 | 将来の LLM 連携修復の参考 |
| Meta Predictive Test Selection (ICSE-SEIP 2019) | ML で変更に必要なテストを予測。20% 実行で 90% 信頼度 | 長期目標。まず bitflow ベースで始め、データ蓄積後に ML 化 |
| Microsoft TIA | 影響テスト + 前回失敗テスト + 新規テスト の3要素選択 | hybrid 戦略のデフォルトロジックに採用 |
| Launchable | GBDT で予測。メタデータのみ使用。60-80% 時間削減 | メタデータベース予測の将来参考 |

### Infrastructure References

| システム | 概要 | metrici への影響 |
|---------|------|-----------------|
| Chrome ResultDB | Invocation / TestResult / TestVariant のデータモデル。BigQuery にエクスポート | TestVariant 概念を採用: matrix 条件を variant JSON で保持 |
| Chrome LUCI Analysis | flaky test を cluster 化しスコアリング・ランキング | flaky_scores のクラスタリング設計に参考 |
| Chrome Findit | culprit commit の自動特定 (bisect) | bisect コマンドのアルゴリズムに参考 |
| Google TAP | 3回連続失敗で failure 報告。flaky テストを自動隔離・issue 起票 | quarantine ポリシーの設計に採用 |

### Existing Tools

| ツール | 方式 | metrici の差別化 |
|--------|------|-----------------|
| BuildPulse (有料 SaaS) | git tree SHA 比較 + 統計閾値。quarantine API | metrici はローカル完結、DuckDB で自由にクエリ可能 |
| github-test-reporter / CTRF (OSS) | JUnit XML → CTRF JSON 変換。PR コメント表示 | metrici は蓄積・分析・サンプリング実行までカバー |
| Trunk.io (有料 SaaS) | flaky test quarantine。CI プロバイダ横断 | metrici はサンプリング実行と actrun 連携が独自 |
| GitLab (内蔵) | ClickHouse + Grafana。ビルトイン flaky 検出は開発中 | metrici は CI プラットフォーム非依存 |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    metrici CLI                       │
│                    (TypeScript)                      │
├───────────┬───────────┬───────────┬─────────────────┤
│ collect   │ analyze   │  sample   │    run           │
├───────────┴───────────┴───────────┴─────────────────┤
│               Core (MoonBit → WASM)                  │
│  flaky_detector | sampler | bisect | stats           │
├─────────────────────────────────────────────────────┤
│               DuckDB Storage                         │
├─────────────────────────────────────────────────────┤
│            Adapter Layer (テスト結果パーサ)            │
│  Playwright JSON | JUnit XML | Custom                │
├─────────────────────────────────────────────────────┤
│            Runner Layer (テスト実行)                  │
│  direct (npx playwright test) | actrun               │
├─────────────────────────────────────────────────────┤
│            Dependency Resolver                       │
│  bitflow (workflow.star) | simple (path match)       │
└─────────────────────────────────────────────────────┘
```

### Language Split

| Layer | Language | Responsibility |
|-------|----------|----------------|
| Core computation | MoonBit → WASM (wasm-gc) | flaky detection, sampling algorithms, statistics, bisect logic |
| I/O & external | TypeScript | GitHub API, DuckDB, Playwright execution, actrun invocation, CLI |

### MoonBit ↔ TypeScript Boundary

- MoonBit を `wasm-gc` ターゲットでビルド
- TypeScript 側から WASM を import して関数呼び出し
- データ受け渡しは JSON シリアライズ（MoonBit の `@json` パッケージ）

```typescript
// TypeScript
import { createCore } from "./core/metrici_core.wasm"
const core = await createCore()
const flakyResults = core.detectFlaky(testResultsJson)
const sampledTests = core.sample(strategyJson, testMetaJson)
```

```moonbit
// MoonBit
pub fn detect_flaky(input: String) -> String { ... }
pub fn sample(strategy: String, meta: String) -> String { ... }
pub fn bisect_candidates(history: String) -> String { ... }
```

## Directory Structure

```
metrici/
├── src/
│   ├── core/                    # MoonBit (WASM)
│   │   ├── flaky_detector/      # flaky detection logic
│   │   ├── sampler/             # sampling strategy engine
│   │   ├── bisect/              # commit bisect logic
│   │   └── stats/               # statistics (flaky_rate, weighting)
│   │
│   └── cli/                     # TypeScript
│       ├── commands/            # collect, analyze, sample, run
│       ├── adapters/            # playwright, junit parsers
│       ├── runners/             # direct, actrun runners
│       ├── storage/             # DuckDB connection & queries
│       └── resolvers/           # bitflow integration (affected)
│
├── metrici.toml
├── moon.mod.json
├── package.json
└── justfile
```

## Data Model (DuckDB)

### Core Tables

```sql
CREATE TABLE workflow_runs (
  id            BIGINT PRIMARY KEY,   -- GitHub run_id
  repo          VARCHAR NOT NULL,
  branch        VARCHAR,
  commit_sha    VARCHAR NOT NULL,
  event         VARCHAR,              -- push, pull_request
  status        VARCHAR,              -- completed, failure
  created_at    TIMESTAMP,
  duration_ms   INTEGER
);

CREATE TABLE test_results (
  id              BIGINT PRIMARY KEY,
  workflow_run_id BIGINT REFERENCES workflow_runs(id),
  suite           VARCHAR NOT NULL,   -- file path or suite name
  test_name       VARCHAR NOT NULL,   -- test case name
  status          VARCHAR NOT NULL,   -- passed, failed, skipped, flaky
  duration_ms     INTEGER,
  retry_count     INTEGER DEFAULT 0,
  error_message   VARCHAR,
  commit_sha      VARCHAR NOT NULL,
  variant         JSON,               -- matrix conditions (os, browser, etc.)
  created_at      TIMESTAMP
);
```

### Design Decisions

**variant カラム (JSON)**: Chrome ResultDB の TestVariant 概念を採用。同一テストでも OS・ブラウザ・matrix 条件によって flaky 度が異なる。GitHub Actions の `strategy.matrix` 値をここに格納する。

```json
{"os": "ubuntu-latest", "browser": "chromium", "node": "20"}
```

**retry_count**: Playwright の retry 機能との対応。`retry_count > 0 && status = 'passed'` は retry で通ったケース = flaky 候補。

### Flaky Detection Queries

#### Phase 1: Threshold-based (ローリングウィンドウ)

```sql
-- 直近14日間の flaky score
WITH recent AS (
  SELECT * FROM test_results
  WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '14 days'
)
SELECT
  suite,
  test_name,
  variant,
  COUNT(*) AS total_runs,
  COUNT(*) FILTER (WHERE status = 'failed') AS fail_count,
  COUNT(*) FILTER (WHERE retry_count > 0 AND status = 'passed') AS flaky_retry_count,
  ROUND(
    (COUNT(*) FILTER (WHERE status = 'failed')
     + COUNT(*) FILTER (WHERE retry_count > 0 AND status = 'passed'))
    * 100.0 / COUNT(*), 2
  ) AS flaky_rate,
  MAX(created_at) FILTER (WHERE status = 'failed') AS last_flaky_at,
  MIN(created_at) AS first_seen_at
FROM recent
GROUP BY suite, test_name, variant
HAVING flaky_rate > 0
ORDER BY flaky_rate DESC;
```

#### Phase 2: DeFlaker-inspired (同一コミットでの結果不一致)

```sql
-- 同一 commit_sha で pass/fail が混在 = 真の flaky
WITH commit_results AS (
  SELECT
    suite,
    test_name,
    commit_sha,
    COUNT(DISTINCT status) FILTER (WHERE status IN ('passed', 'failed')) AS distinct_statuses
  FROM test_results
  GROUP BY suite, test_name, commit_sha
)
SELECT
  suite,
  test_name,
  COUNT(*) AS commits_tested,
  COUNT(*) FILTER (WHERE distinct_statuses > 1) AS flaky_commits,
  ROUND(
    COUNT(*) FILTER (WHERE distinct_statuses > 1) * 100.0 / COUNT(*), 2
  ) AS true_flaky_rate
FROM commit_results
GROUP BY suite, test_name
HAVING flaky_commits > 0
ORDER BY true_flaky_rate DESC;
```

#### Flaky Trend (ウィンドウ関数)

```sql
-- テストごとの flaky rate 推移（週次）
SELECT
  suite,
  test_name,
  DATE_TRUNC('week', created_at) AS week,
  COUNT(*) AS runs,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2
  ) AS weekly_flaky_rate,
  LAG(
    ROUND(COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2)
  ) OVER (PARTITION BY suite, test_name ORDER BY DATE_TRUNC('week', created_at)) AS prev_week_rate
FROM test_results
GROUP BY suite, test_name, week
ORDER BY suite, test_name, week;
```

## Adapter Interface

```typescript
interface TestCaseResult {
  suite: string
  testName: string
  status: "passed" | "failed" | "skipped" | "flaky"
  durationMs: number
  retryCount: number
  errorMessage?: string
  variant?: Record<string, string>
}

interface TestResultAdapter {
  name: string
  parse(input: string | Buffer): TestCaseResult[]
}
```

### Built-in Adapters

- **PlaywrightJsonAdapter** — Playwright JSON reporter output. `test.results[]` の retry エントリから flaky を検出。`project` フィールドを variant にマッピング。
- **JUnitXmlAdapter** — JUnit XML format (汎用)。

### Custom Adapter

```toml
[adapter]
type = "custom"
command = "node ./my-adapter.js"  # stdin: raw, stdout: TestCaseResult[] as JSON
```

## Sampling Strategies

### Strategy Overview

| Strategy | Flag | Behavior |
|----------|------|----------|
| `random` | `--strategy random` | Uniform random selection |
| `weighted` | `--strategy weighted` | Weighted by flaky_rate (higher = more likely selected) |
| `affected` | `--strategy affected` | Uses bitflow dependency graph to find tests affected by git changes |
| `hybrid` | `--strategy hybrid` (default) | Microsoft TIA 式: affected + previously failed + new tests + weighted random |

### Strategy Interface (MoonBit Core)

```moonbit
pub fn sample(strategy: String, meta: String) -> String
// strategy: JSON { "name": "hybrid", "count": 100, "percentage": null }
// meta: JSON [{ "suite": "...", "testName": "...", "flakyRate": 0.15, ... }]
// returns: JSON ["test_id_1", "test_id_2", ...]
```

### hybrid Strategy Detail (Microsoft TIA inspired)

hybrid はデフォルト戦略。以下の優先順位でテストを選択:

1. **affected** — bitflow 依存グラフで変更影響を受けるテスト（全数実行）
2. **previously failed** — 前回の実行で失敗したテスト（全数実行）
3. **new tests** — 新規追加されたテスト（全数実行）
4. **weighted random** — 残り枠を flaky_rate 重み付きランダムで埋める

### Affected Strategy: bitflow Integration

```
git diff → changed files
  → bitflow entry_targets_for_changed_paths()
  → bitflow expand_affected_nodes()
  → filter to test file nodes
```

Users define dependency relationships in `metrici.star`:

```python
task("tests/auth", srcs=["src/auth/**", "src/utils/**"])
task("tests/checkout", srcs=["src/checkout/**", "src/auth/**"])
```

## Quarantine Policy (Google TAP inspired)

flaky_rate が閾値を超えたテストを自動的にマーク:

```sql
-- quarantine 対象の判定
SELECT suite, test_name
FROM flaky_scores
WHERE flaky_rate > 30.0          -- configurable threshold
  AND total_runs >= 10;          -- minimum sample size
```

CLI での利用:

```bash
metrici run --skip-quarantined              # quarantine テストを除外して実行
metrici flaky --quarantined                 # quarantine 対象一覧
metrici quarantine --add "login.spec.ts"    # 手動 quarantine
metrici quarantine --remove "login.spec.ts" # quarantine 解除
```

設定:

```toml
[quarantine]
auto = true
flaky_rate_threshold = 30.0    # percent
min_runs = 10
```

## Storage Interface

```typescript
interface MetricStore {
  insertWorkflowRun(run: WorkflowRun): Promise<void>
  insertTestResults(results: TestResult[]): Promise<void>
  queryFlakyTests(opts: FlakyQueryOpts): Promise<FlakyScore[]>
  queryTestHistory(suite: string, name: string): Promise<TestResult[]>
  queryQuarantined(): Promise<QuarantinedTest[]>
  raw(sql: string, params?: unknown[]): Promise<unknown[]>
}
```

DuckDB のみで開始。インターフェースを切っておき、将来 SQLite やリモート DB への差し替えに備える。

## Runner Layer

### Direct Runner

```bash
npx playwright test --grep "pattern" --reporter json
```

### actrun Runner

```bash
# CI ワークフローをローカル再現
actrun workflow run .github/workflows/test.yml

# 失敗箇所から即座にリトライ
actrun workflow run .github/workflows/test.yml --retry

# 特定ジョブのみ
actrun workflow run .github/workflows/test.yml --job test
```

actrun の `--retry` により、CI パイプライン全体を再実行せず失敗テストのみリトライ可能。`--json` オプションで実行結果を metrici に取り込める。

## CLI Commands

```bash
# Setup
metrici init                                    # Generate metrici.toml

# Data Collection
metrici collect                                 # Fetch recent results from GitHub Actions API
metrici collect --last 90                       # Last 90 days
metrici collect --branch main                   # Specific branch

# Analysis
metrici flaky                                   # Top 20 flaky tests
metrici flaky --top 50                          # Top 50
metrici flaky --test "login.spec.ts"            # History for specific test
metrici flaky --trend                           # Weekly trend
metrici flaky --quarantined                     # Quarantined tests only
metrici bisect --test "login > redirect"        # Find commit range where flaky started

# Quarantine
metrici quarantine --add "login.spec.ts"        # Manual quarantine
metrici quarantine --remove "login.spec.ts"     # Remove quarantine

# Sampling & Execution
metrici sample --strategy hybrid --count 100    # Output test list
metrici run --strategy weighted --count 50      # Sample + execute
metrici run --strategy affected                 # Run affected tests only
metrici run --skip-quarantined                  # Skip quarantined tests
metrici run --runner actrun                     # Execute via actrun
metrici run --runner actrun --retry             # Retry failures via actrun

# Raw Query
metrici query "SELECT * FROM test_results WHERE suite LIKE '%login%'"
```

## Configuration

```toml
[repo]
owner = "mizchi"
name = "some-project"

[storage]
path = ".metrici/data.duckdb"

[adapter]
type = "playwright"

[runner]
default = "direct"
command = "npx playwright test"

[runner.actrun]
workflow = ".github/workflows/test.yml"

[affected]
resolver = "bitflow"
config = "metrici.star"

[quarantine]
auto = true
flaky_rate_threshold = 30.0
min_runs = 10

[flaky]
window_days = 14
detection_threshold = 2.0      # percent
```

## Phased Delivery

### Phase 1: Core

- `metrici init` — 設定ファイル生成
- `metrici collect` — GitHub Actions API → DuckDB
- Playwright JSON adapter
- `metrici flaky` — threshold-based detection (ローリングウィンドウ)
- `metrici sample` — random, weighted strategies
- `metrici run` — direct runner
- `metrici query` — raw SQL query

### Phase 2: Affected, actrun & Quarantine

- bitflow integration for affected strategy
- hybrid strategy (Microsoft TIA 式: affected + previously failed + new + weighted)
- actrun runner integration (`--retry` 対応)
- `metrici bisect` — flaky 開始コミット範囲の特定
- quarantine policy (Google TAP 式: 自動隔離 + 手動管理)
- `metrici flaky --trend` — 週次トレンド表示

### Phase 3: Advanced Analysis

- DeFlaker-inspired 真の flaky 判定 (同一 commit で結果不一致)
- JUnit XML adapter
- Custom adapter support
- Storage interface abstraction (SQLite readiness)
- variant 別 flaky 分析（OS/ブラウザ別）

### Future (データ蓄積後)

- ML ベース予測テスト選択 (Launchable/Meta 方式)
- Root cause 自動分類 (FlaKat 方式)
- LLM 連携 flaky test 自動修復 (FlakyGuard 方式)

## References

- [DeFlaker (ICSE 2018)](https://www.cs.cornell.edu/~legunsen/pubs/BellETAL18DeFlaker.pdf) — 差分カバレッジベース flaky 検出
- [FlaKat (2024)](https://arxiv.org/abs/2403.01003) — ML ベース root cause 分類
- [MDFlaker (2025)](https://www.sciencedirect.com/science/article/pii/S2665963825000545) — 多因子 flaky スコアリング
- [FlakyGuard (ASE 2025)](https://arxiv.org/abs/2511.14002) — LLM による flaky test 自動修復
- [Meta Predictive Test Selection (ICSE-SEIP 2019)](https://arxiv.org/pdf/1810.05286) — ML ベーステスト選択
- [Microsoft TIA](https://devblogs.microsoft.com/devops/accelerated-continuous-testing-with-test-impact-analysis-part-1/) — Test Impact Analysis
- [Launchable Predictive Test Selection](https://help.launchableinc.com/features/predictive-test-selection/) — GBDT ベーステスト選択
- [Google TAP](https://abseil.io/resources/swe-book/html/ch23.html) — Test Automation Platform
- [Chrome ResultDB](https://chromium.googlesource.com/chromium/src/+/main/docs/testing/resultdb.md) — テスト結果ストレージ
- [Chrome LUCI Analysis](https://www.chromium.org/developers/testing/flakiness-dashboard/) — Flaky test ダッシュボード
- [Chrome Findit](https://sites.google.com/chromium.org/cat/findit) — Culprit commit 自動特定
- [BuildPulse](https://buildpulse.io/) — Flaky test detection SaaS
- [CTRF / github-test-reporter](https://github.com/ctrf-io/github-test-reporter) — Common Test Report Format
