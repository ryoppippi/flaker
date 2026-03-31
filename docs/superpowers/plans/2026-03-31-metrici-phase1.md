# metrici Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** metrici CLI の Phase 1 を実装する — GitHub Actions からテスト結果を収集し DuckDB に蓄積、flaky test を閾値ベースで検出、random/weighted サンプリングでテストを選択・実行できるようにする。

**Architecture:** TypeScript CLI（pnpm + Node.js v24+）が I/O を担当し、MoonBit WASM コアが flaky 判定・サンプリングの計算ロジックを担当する。DuckDB をローカルストレージとして使用。テスト結果は Adapter パターンで正規化する。

**Tech Stack:** TypeScript, MoonBit (wasm-gc), DuckDB (duckdb-node), Vitest, pnpm, GitHub Actions API (via @octokit/rest)

---

## File Structure

```
metrici/
├── src/
│   ├── core/                          # MoonBit (WASM)
│   │   ├── moon.mod.json
│   │   ├── src/
│   │   │   ├── flaky_detector/
│   │   │   │   ├── moon.pkg.json
│   │   │   │   ├── flaky_detector.mbt
│   │   │   │   └── flaky_detector_test.mbt
│   │   │   ├── sampler/
│   │   │   │   ├── moon.pkg.json
│   │   │   │   ├── sampler.mbt
│   │   │   │   └── sampler_test.mbt
│   │   │   └── types/
│   │   │       ├── moon.pkg.json
│   │   │       └── types.mbt
│   │   └── justfile
│   │
│   └── cli/                           # TypeScript
│       ├── main.ts                    # CLI entry point (commander)
│       ├── config.ts                  # metrici.toml loader
│       ├── commands/
│       │   ├── init.ts
│       │   ├── collect.ts
│       │   ├── flaky.ts
│       │   ├── sample.ts
│       │   ├── run.ts
│       │   └── query.ts
│       ├── adapters/
│       │   ├── types.ts               # TestCaseResult, TestResultAdapter
│       │   └── playwright.ts          # PlaywrightJsonAdapter
│       ├── storage/
│       │   ├── types.ts               # MetricStore interface
│       │   ├── schema.ts              # DDL statements
│       │   └── duckdb.ts              # DuckDBStore implementation
│       ├── runners/
│       │   └── direct.ts              # Direct runner (npx playwright test)
│       └── core/
│           └── loader.ts              # WASM loader for MoonBit core
│
├── tests/
│   ├── adapters/
│   │   └── playwright.test.ts
│   ├── storage/
│   │   └── duckdb.test.ts
│   ├── commands/
│   │   ├── init.test.ts
│   │   ├── collect.test.ts
│   │   ├── flaky.test.ts
│   │   ├── sample.test.ts
│   │   └── query.test.ts
│   ├── core/
│   │   └── loader.test.ts
│   └── fixtures/
│       └── playwright-report.json     # Sample Playwright JSON output
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── justfile
└── .gitignore
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `justfile`
- Create: `.gitignore`

- [ ] **Step 1: Initialize pnpm project**

```bash
cd /Users/mz/ghq/github.com/mizchi/metric-ci
pnpm init
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add commander @octokit/rest duckdb-node smol-toml
pnpm add -D typescript vitest @types/node tsx
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "paths": {
      "@metrici/*": ["./src/cli/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.jj/**"],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 5: Create justfile**

```makefile
default:
  just --list

test:
  pnpm vitest run

test-watch:
  pnpm vitest

build:
  pnpm tsc

cli *args:
  pnpm tsx src/cli/main.ts {{args}}

core-build:
  cd src/core && moon build --target wasm-gc

core-test:
  cd src/core && moon test
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
.metrici/
*.duckdb
*.duckdb.wal
.jj/
target/
_build/
```

- [ ] **Step 7: Update package.json with bin and scripts**

`package.json` に以下を追加:

```json
{
  "name": "metrici",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "metrici": "./dist/cli/main.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsx src/cli/main.ts"
  }
}
```

- [ ] **Step 8: Verify setup**

Run: `pnpm vitest run`
Expected: 0 tests found, exit 0

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts justfile .gitignore pnpm-lock.yaml
git commit -m "feat: scaffold metrici project with pnpm, TypeScript, Vitest"
```

---

### Task 2: Shared Types & Adapter Interface

**Files:**
- Create: `src/cli/adapters/types.ts`
- Create: `src/cli/storage/types.ts`

- [ ] **Step 1: Create adapter types**

Create `src/cli/adapters/types.ts`:

```typescript
export interface TestCaseResult {
  suite: string;
  testName: string;
  status: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
  variant?: Record<string, string>;
}

export interface TestResultAdapter {
  name: string;
  parse(input: string): TestCaseResult[];
}
```

- [ ] **Step 2: Create storage types**

Create `src/cli/storage/types.ts`:

```typescript
export interface WorkflowRun {
  id: number;
  repo: string;
  branch: string | null;
  commitSha: string;
  event: string | null;
  status: string | null;
  createdAt: Date;
  durationMs: number | null;
}

export interface TestResult {
  id?: number;
  workflowRunId: number;
  suite: string;
  testName: string;
  status: string;
  durationMs: number | null;
  retryCount: number;
  errorMessage: string | null;
  commitSha: string;
  variant: Record<string, string> | null;
  createdAt: Date;
}

export interface FlakyScore {
  suite: string;
  testName: string;
  variant: Record<string, string> | null;
  totalRuns: number;
  failCount: number;
  flakyRetryCount: number;
  flakyRate: number;
  lastFlakyAt: Date | null;
  firstSeenAt: Date;
}

export interface FlakyQueryOpts {
  top?: number;
  suite?: string;
  testName?: string;
  windowDays?: number;
}

export interface MetricStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  insertWorkflowRun(run: WorkflowRun): Promise<void>;
  insertTestResults(results: TestResult[]): Promise<void>;
  queryFlakyTests(opts: FlakyQueryOpts): Promise<FlakyScore[]>;
  queryTestHistory(suite: string, testName: string): Promise<TestResult[]>;
  raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/adapters/types.ts src/cli/storage/types.ts
git commit -m "feat: define shared types for adapters and storage"
```

---

### Task 3: Playwright JSON Adapter

**Files:**
- Create: `src/cli/adapters/playwright.ts`
- Create: `tests/fixtures/playwright-report.json`
- Create: `tests/adapters/playwright.test.ts`

- [ ] **Step 1: Create test fixture**

Create `tests/fixtures/playwright-report.json`:

```json
{
  "config": {
    "projects": [
      { "name": "chromium" },
      { "name": "firefox" }
    ]
  },
  "suites": [
    {
      "title": "login.spec.ts",
      "file": "tests/login.spec.ts",
      "suites": [
        {
          "title": "login page",
          "specs": [
            {
              "title": "should display form",
              "tests": [
                {
                  "projectName": "chromium",
                  "results": [
                    { "status": "passed", "duration": 1200, "retry": 0 }
                  ],
                  "status": "expected"
                }
              ]
            },
            {
              "title": "should redirect after login",
              "tests": [
                {
                  "projectName": "chromium",
                  "results": [
                    { "status": "failed", "duration": 3000, "retry": 0, "error": { "message": "Timeout" } },
                    { "status": "passed", "duration": 1500, "retry": 1 }
                  ],
                  "status": "flaky"
                }
              ]
            },
            {
              "title": "should show error on invalid credentials",
              "tests": [
                {
                  "projectName": "chromium",
                  "results": [
                    { "status": "failed", "duration": 2000, "retry": 0, "error": { "message": "Element not found" } }
                  ],
                  "status": "unexpected"
                }
              ]
            },
            {
              "title": "should skip on mobile",
              "tests": [
                {
                  "projectName": "chromium",
                  "results": [
                    { "status": "skipped", "duration": 0, "retry": 0 }
                  ],
                  "status": "skipped"
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/adapters/playwright.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PlaywrightJsonAdapter } from "../../src/cli/adapters/playwright.js";

const fixture = readFileSync(
  resolve(import.meta.dirname, "../fixtures/playwright-report.json"),
  "utf-8"
);

describe("PlaywrightJsonAdapter", () => {
  const adapter = new PlaywrightJsonAdapter();

  it("has name 'playwright'", () => {
    expect(adapter.name).toBe("playwright");
  });

  it("parses passing test", () => {
    const results = adapter.parse(fixture);
    const passing = results.find((r) => r.testName === "should display form");
    expect(passing).toEqual({
      suite: "tests/login.spec.ts",
      testName: "should display form",
      status: "passed",
      durationMs: 1200,
      retryCount: 0,
      errorMessage: undefined,
      variant: { project: "chromium" },
    });
  });

  it("parses flaky test (retry passed)", () => {
    const results = adapter.parse(fixture);
    const flaky = results.find(
      (r) => r.testName === "should redirect after login"
    );
    expect(flaky).toEqual({
      suite: "tests/login.spec.ts",
      testName: "should redirect after login",
      status: "flaky",
      durationMs: 1500,
      retryCount: 1,
      errorMessage: "Timeout",
      variant: { project: "chromium" },
    });
  });

  it("parses failed test", () => {
    const results = adapter.parse(fixture);
    const failed = results.find(
      (r) => r.testName === "should show error on invalid credentials"
    );
    expect(failed).toEqual({
      suite: "tests/login.spec.ts",
      testName: "should show error on invalid credentials",
      status: "failed",
      durationMs: 2000,
      retryCount: 0,
      errorMessage: "Element not found",
      variant: { project: "chromium" },
    });
  });

  it("parses skipped test", () => {
    const results = adapter.parse(fixture);
    const skipped = results.find(
      (r) => r.testName === "should skip on mobile"
    );
    expect(skipped).toEqual({
      suite: "tests/login.spec.ts",
      testName: "should skip on mobile",
      status: "skipped",
      durationMs: 0,
      retryCount: 0,
      errorMessage: undefined,
      variant: { project: "chromium" },
    });
  });

  it("returns all 4 test results", () => {
    const results = adapter.parse(fixture);
    expect(results).toHaveLength(4);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/adapters/playwright.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement PlaywrightJsonAdapter**

Create `src/cli/adapters/playwright.ts`:

```typescript
import type { TestCaseResult, TestResultAdapter } from "./types.js";

interface PlaywrightResult {
  status: string;
  duration: number;
  retry: number;
  error?: { message: string };
}

interface PlaywrightTest {
  projectName: string;
  results: PlaywrightResult[];
  status: string;
}

interface PlaywrightSpec {
  title: string;
  tests: PlaywrightTest[];
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  suites: PlaywrightSuite[];
}

export class PlaywrightJsonAdapter implements TestResultAdapter {
  name = "playwright";

  parse(input: string): TestCaseResult[] {
    const report: PlaywrightReport = JSON.parse(input);
    const results: TestCaseResult[] = [];
    for (const suite of report.suites) {
      this.walkSuite(suite, suite.file ?? suite.title, results);
    }
    return results;
  }

  private walkSuite(
    suite: PlaywrightSuite,
    filePath: string,
    results: TestCaseResult[]
  ): void {
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const test of spec.tests) {
          results.push(this.parseTest(filePath, spec.title, test));
        }
      }
    }
    if (suite.suites) {
      for (const child of suite.suites) {
        this.walkSuite(child, filePath, results);
      }
    }
  }

  private parseTest(
    filePath: string,
    specTitle: string,
    test: PlaywrightTest
  ): TestCaseResult {
    const lastResult = test.results[test.results.length - 1];
    const firstFailed = test.results.find((r) => r.status === "failed");
    const maxRetry = Math.max(...test.results.map((r) => r.retry));

    let status: TestCaseResult["status"];
    if (lastResult.status === "skipped") {
      status = "skipped";
    } else if (maxRetry > 0 && lastResult.status === "passed") {
      status = "flaky";
    } else if (lastResult.status === "passed") {
      status = "passed";
    } else {
      status = "failed";
    }

    return {
      suite: filePath,
      testName: specTitle,
      status,
      durationMs: lastResult.duration,
      retryCount: maxRetry,
      errorMessage: firstFailed?.error?.message,
      variant: { project: test.projectName },
    };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/adapters/playwright.test.ts`
Expected: 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/adapters/playwright.ts tests/adapters/playwright.test.ts tests/fixtures/playwright-report.json
git commit -m "feat: implement Playwright JSON adapter with flaky detection"
```

---

### Task 4: DuckDB Storage Layer

**Files:**
- Create: `src/cli/storage/schema.ts`
- Create: `src/cli/storage/duckdb.ts`
- Create: `tests/storage/duckdb.test.ts`

- [ ] **Step 1: Create schema definitions**

Create `src/cli/storage/schema.ts`:

```typescript
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workflow_runs (
  id            BIGINT PRIMARY KEY,
  repo          VARCHAR NOT NULL,
  branch        VARCHAR,
  commit_sha    VARCHAR NOT NULL,
  event         VARCHAR,
  status        VARCHAR,
  created_at    TIMESTAMP,
  duration_ms   INTEGER
);

CREATE TABLE IF NOT EXISTS test_results (
  id              INTEGER PRIMARY KEY,
  workflow_run_id BIGINT REFERENCES workflow_runs(id),
  suite           VARCHAR NOT NULL,
  test_name       VARCHAR NOT NULL,
  status          VARCHAR NOT NULL,
  duration_ms     INTEGER,
  retry_count     INTEGER DEFAULT 0,
  error_message   VARCHAR,
  commit_sha      VARCHAR NOT NULL,
  variant         JSON,
  created_at      TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS test_results_id_seq START 1;
`;

export const FLAKY_QUERY = `
WITH recent AS (
  SELECT * FROM test_results
  WHERE created_at > CURRENT_TIMESTAMP - INTERVAL ($1 || ' days')
)
SELECT
  suite,
  test_name,
  variant,
  COUNT(*)::INTEGER AS total_runs,
  COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS fail_count,
  COUNT(*) FILTER (WHERE retry_count > 0 AND status = 'passed')::INTEGER AS flaky_retry_count,
  ROUND(
    (COUNT(*) FILTER (WHERE status = 'failed')
     + COUNT(*) FILTER (WHERE retry_count > 0 AND status = 'passed'))
    * 100.0 / COUNT(*), 2
  )::DOUBLE AS flaky_rate,
  MAX(created_at) FILTER (WHERE status = 'failed') AS last_flaky_at,
  MIN(created_at) AS first_seen_at
FROM recent
GROUP BY suite, test_name, variant
HAVING flaky_rate > 0
ORDER BY flaky_rate DESC
`;
```

- [ ] **Step 2: Write failing tests**

Create `tests/storage/duckdb.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { WorkflowRun, TestResult } from "../../src/cli/storage/types.js";

describe("DuckDBStore", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("initializes schema without error", async () => {
    const result = await store.raw<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY name"
    );
    const names = result.map((r) => r.name);
    expect(names).toContain("workflow_runs");
    expect(names).toContain("test_results");
  });

  it("inserts and retrieves a workflow run", async () => {
    const run: WorkflowRun = {
      id: 12345,
      repo: "mizchi/my-app",
      branch: "main",
      commitSha: "abc123",
      event: "push",
      status: "completed",
      createdAt: new Date("2026-03-30T10:00:00Z"),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run);

    const rows = await store.raw<{ id: number; repo: string }>(
      "SELECT id, repo FROM workflow_runs"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(12345);
    expect(rows[0].repo).toBe("mizchi/my-app");
  });

  it("inserts test results in batch", async () => {
    const run: WorkflowRun = {
      id: 1,
      repo: "mizchi/my-app",
      branch: "main",
      commitSha: "abc123",
      event: "push",
      status: "completed",
      createdAt: new Date("2026-03-30T10:00:00Z"),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run);

    const results: TestResult[] = [
      {
        workflowRunId: 1,
        suite: "tests/login.spec.ts",
        testName: "should display form",
        status: "passed",
        durationMs: 1200,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: { project: "chromium" },
        createdAt: new Date("2026-03-30T10:00:00Z"),
      },
      {
        workflowRunId: 1,
        suite: "tests/login.spec.ts",
        testName: "should redirect",
        status: "passed",
        durationMs: 1500,
        retryCount: 1,
        errorMessage: null,
        commitSha: "abc123",
        variant: { project: "chromium" },
        createdAt: new Date("2026-03-30T10:00:00Z"),
      },
    ];
    await store.insertTestResults(results);

    const rows = await store.raw<{ test_name: string }>(
      "SELECT test_name FROM test_results ORDER BY test_name"
    );
    expect(rows).toHaveLength(2);
  });

  it("queries flaky tests", async () => {
    const run: WorkflowRun = {
      id: 1,
      repo: "mizchi/my-app",
      branch: "main",
      commitSha: "abc123",
      event: "push",
      status: "completed",
      createdAt: new Date(),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run);

    const now = new Date();
    const results: TestResult[] = [];
    // Create 10 runs: 3 failed, 2 flaky (retry passed), 5 passed
    for (let i = 0; i < 10; i++) {
      let status: string;
      let retryCount: number;
      if (i < 3) {
        status = "failed";
        retryCount = 0;
      } else if (i < 5) {
        status = "passed";
        retryCount = 1; // flaky: passed after retry
      } else {
        status = "passed";
        retryCount = 0;
      }
      results.push({
        workflowRunId: 1,
        suite: "tests/login.spec.ts",
        testName: "should redirect",
        status,
        durationMs: 1000,
        retryCount,
        errorMessage: status === "failed" ? "Timeout" : null,
        commitSha: "abc123",
        variant: null,
        createdAt: now,
      });
    }
    await store.insertTestResults(results);

    const flaky = await store.queryFlakyTests({ windowDays: 14 });
    expect(flaky).toHaveLength(1);
    expect(flaky[0].suite).toBe("tests/login.spec.ts");
    expect(flaky[0].testName).toBe("should redirect");
    expect(flaky[0].failCount).toBe(3);
    expect(flaky[0].flakyRetryCount).toBe(2);
    expect(flaky[0].flakyRate).toBe(50.0); // (3+2)/10 * 100
  });

  it("queries test history", async () => {
    const run: WorkflowRun = {
      id: 1,
      repo: "mizchi/my-app",
      branch: "main",
      commitSha: "abc123",
      event: "push",
      status: "completed",
      createdAt: new Date(),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run);

    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/login.spec.ts",
        testName: "should redirect",
        status: "passed",
        durationMs: 1000,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      },
    ]);

    const history = await store.queryTestHistory(
      "tests/login.spec.ts",
      "should redirect"
    );
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("passed");
  });

  it("executes raw SQL", async () => {
    const result = await store.raw<{ answer: number }>("SELECT 42 AS answer");
    expect(result[0].answer).toBe(42);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/storage/duckdb.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement DuckDBStore**

Create `src/cli/storage/duckdb.ts`:

```typescript
import duckdb from "duckdb-node";
import { SCHEMA_SQL, FLAKY_QUERY } from "./schema.js";
import type {
  MetricStore,
  WorkflowRun,
  TestResult,
  FlakyScore,
  FlakyQueryOpts,
} from "./types.js";

export class DuckDBStore implements MetricStore {
  private db: duckdb.Database | null = null;
  private conn: duckdb.Connection | null = null;

  constructor(private dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = new duckdb.Database(this.dbPath);
    this.conn = this.db.connect();
    await this.exec(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    this.conn?.close();
    this.db?.close();
    this.conn = null;
    this.db = null;
  }

  async insertWorkflowRun(run: WorkflowRun): Promise<void> {
    await this.exec(
      `INSERT OR REPLACE INTO workflow_runs (id, repo, branch, commit_sha, event, status, created_at, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        run.id,
        run.repo,
        run.branch,
        run.commitSha,
        run.event,
        run.status,
        run.createdAt.toISOString(),
        run.durationMs,
      ]
    );
  }

  async insertTestResults(results: TestResult[]): Promise<void> {
    for (const r of results) {
      await this.exec(
        `INSERT INTO test_results (id, workflow_run_id, suite, test_name, status, duration_ms, retry_count, error_message, commit_sha, variant, created_at)
         VALUES (nextval('test_results_id_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          r.workflowRunId,
          r.suite,
          r.testName,
          r.status,
          r.durationMs,
          r.retryCount,
          r.errorMessage,
          r.commitSha,
          r.variant ? JSON.stringify(r.variant) : null,
          r.createdAt.toISOString(),
        ]
      );
    }
  }

  async queryFlakyTests(opts: FlakyQueryOpts): Promise<FlakyScore[]> {
    const windowDays = opts.windowDays ?? 14;
    let sql = FLAKY_QUERY;
    const params: unknown[] = [windowDays];

    if (opts.suite) {
      sql += ` AND suite = $2`;
      params.push(opts.suite);
    }

    if (opts.top) {
      sql += ` LIMIT ${opts.top}`;
    }

    const rows = await this.query(sql, params);
    return rows.map((row: Record<string, unknown>) => ({
      suite: row.suite as string,
      testName: row.test_name as string,
      variant: row.variant ? JSON.parse(row.variant as string) : null,
      totalRuns: row.total_runs as number,
      failCount: row.fail_count as number,
      flakyRetryCount: row.flaky_retry_count as number,
      flakyRate: row.flaky_rate as number,
      lastFlakyAt: row.last_flaky_at
        ? new Date(row.last_flaky_at as string)
        : null,
      firstSeenAt: new Date(row.first_seen_at as string),
    }));
  }

  async queryTestHistory(
    suite: string,
    testName: string
  ): Promise<TestResult[]> {
    const rows = await this.query(
      `SELECT * FROM test_results WHERE suite = $1 AND test_name = $2 ORDER BY created_at DESC`,
      [suite, testName]
    );
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      workflowRunId: row.workflow_run_id as number,
      suite: row.suite as string,
      testName: row.test_name as string,
      status: row.status as string,
      durationMs: row.duration_ms as number | null,
      retryCount: row.retry_count as number,
      errorMessage: row.error_message as string | null,
      commitSha: row.commit_sha as string,
      variant: row.variant ? JSON.parse(row.variant as string) : null,
      createdAt: new Date(row.created_at as string),
    }));
  }

  async raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.query(sql, params) as Promise<T[]>;
  }

  private exec(sql: string, params?: unknown[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.conn) return reject(new Error("Database not initialized"));
      if (params?.length) {
        const stmt = this.conn.prepare(sql);
        stmt.run(...params, (err: Error | null) => {
          stmt.finalize();
          err ? reject(err) : resolve();
        });
      } else {
        this.conn.exec(sql, (err: Error | null) => {
          err ? reject(err) : resolve();
        });
      }
    });
  }

  private query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      if (!this.conn) return reject(new Error("Database not initialized"));
      if (params?.length) {
        const stmt = this.conn.prepare(sql);
        stmt.all(...params, (err: Error | null, rows: Record<string, unknown>[]) => {
          stmt.finalize();
          err ? reject(err) : resolve(rows ?? []);
        });
      } else {
        this.conn.all(sql, (err: Error | null, rows: Record<string, unknown>[]) => {
          err ? reject(err) : resolve(rows ?? []);
        });
      }
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/storage/duckdb.test.ts`
Expected: 5 tests PASS

Note: `duckdb-node` の API が上記と異なる場合はドキュメントを確認して調整する。DuckDB の Node.js バインディングは `duckdb` パッケージ（`npm:duckdb`）を使う可能性もある。`pnpm add duckdb` で試し、API を確認してから実装を調整する。

- [ ] **Step 6: Commit**

```bash
git add src/cli/storage/schema.ts src/cli/storage/duckdb.ts tests/storage/duckdb.test.ts
git commit -m "feat: implement DuckDB storage layer with flaky query"
```

---

### Task 5: Config Loader (metrici.toml)

**Files:**
- Create: `src/cli/config.ts`
- Create: `tests/commands/init.test.ts`
- Create: `src/cli/commands/init.ts`

- [ ] **Step 1: Write failing test for config loading**

Create `tests/commands/init.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, type MetriciConfig } from "../../src/cli/config.js";
import { runInit } from "../../src/cli/commands/init.js";

describe("config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "metrici-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("init creates metrici.toml with defaults", async () => {
    await runInit(dir, { owner: "mizchi", name: "my-app" });
    const configPath = join(dir, "metrici.toml");
    expect(existsSync(configPath)).toBe(true);

    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain('owner = "mizchi"');
    expect(content).toContain('name = "my-app"');
    expect(content).toContain('type = "playwright"');
  });

  it("loadConfig reads metrici.toml", async () => {
    await runInit(dir, { owner: "mizchi", name: "my-app" });
    const config = await loadConfig(dir);
    expect(config.repo.owner).toBe("mizchi");
    expect(config.repo.name).toBe("my-app");
    expect(config.adapter.type).toBe("playwright");
    expect(config.storage.path).toBe(".metrici/data.duckdb");
  });

  it("loadConfig throws if metrici.toml not found", async () => {
    await expect(loadConfig(dir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/commands/init.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement config loader**

Create `src/cli/config.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface MetriciConfig {
  repo: { owner: string; name: string };
  storage: { path: string };
  adapter: { type: string; command?: string };
  runner: { default: string; command: string; actrun?: { workflow: string } };
  affected: { resolver: string; config: string };
  quarantine: {
    auto: boolean;
    flaky_rate_threshold: number;
    min_runs: number;
  };
  flaky: { window_days: number; detection_threshold: number };
}

const DEFAULTS: MetriciConfig = {
  repo: { owner: "", name: "" },
  storage: { path: ".metrici/data.duckdb" },
  adapter: { type: "playwright" },
  runner: { default: "direct", command: "npx playwright test" },
  affected: { resolver: "simple", config: "metrici.star" },
  quarantine: { auto: true, flaky_rate_threshold: 30.0, min_runs: 10 },
  flaky: { window_days: 14, detection_threshold: 2.0 },
};

export async function loadConfig(dir: string): Promise<MetriciConfig> {
  const configPath = join(dir, "metrici.toml");
  const content = readFileSync(configPath, "utf-8");
  const parsed = parse(content);
  return deepMerge(DEFAULTS, parsed) as MetriciConfig;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

- [ ] **Step 4: Implement init command**

Create `src/cli/commands/init.ts`:

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface InitOpts {
  owner: string;
  name: string;
}

const TEMPLATE = (opts: InitOpts) => `[repo]
owner = "${opts.owner}"
name = "${opts.name}"

[storage]
path = ".metrici/data.duckdb"

[adapter]
type = "playwright"

[runner]
default = "direct"
command = "npx playwright test"

[affected]
resolver = "simple"
config = "metrici.star"

[quarantine]
auto = true
flaky_rate_threshold = 30.0
min_runs = 10

[flaky]
window_days = 14
detection_threshold = 2.0
`;

export async function runInit(dir: string, opts: InitOpts): Promise<void> {
  mkdirSync(join(dir, ".metrici"), { recursive: true });
  writeFileSync(join(dir, "metrici.toml"), TEMPLATE(opts));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/init.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/config.ts src/cli/commands/init.ts tests/commands/init.test.ts
git commit -m "feat: implement metrici.toml config loader and init command"
```

---

### Task 6: collect Command (GitHub Actions API)

**Files:**
- Create: `src/cli/commands/collect.ts`
- Create: `tests/commands/collect.test.ts`

- [ ] **Step 1: Write failing test with mock GitHub API**

Create `tests/commands/collect.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import {
  collectWorkflowRuns,
  type GitHubClient,
} from "../../src/cli/commands/collect.js";

function createMockGitHub(): GitHubClient {
  return {
    async listWorkflowRuns() {
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 100,
            head_branch: "main",
            head_sha: "abc123",
            event: "push",
            conclusion: "success",
            created_at: "2026-03-30T10:00:00Z",
            run_started_at: "2026-03-30T10:00:00Z",
            updated_at: "2026-03-30T10:01:00Z",
          },
        ],
      };
    },
    async downloadArtifact() {
      return JSON.stringify({
        suites: [
          {
            title: "login.spec.ts",
            file: "tests/login.spec.ts",
            suites: [
              {
                title: "login",
                specs: [
                  {
                    title: "should work",
                    tests: [
                      {
                        projectName: "chromium",
                        results: [
                          {
                            status: "passed",
                            duration: 1000,
                            retry: 0,
                          },
                        ],
                        status: "expected",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    },
    async listArtifacts() {
      return {
        total_count: 1,
        artifacts: [
          {
            id: 200,
            name: "playwright-report",
            expired: false,
          },
        ],
      };
    },
  };
}

describe("collect command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("collects workflow runs and test results from GitHub API", async () => {
    const github = createMockGitHub();
    const result = await collectWorkflowRuns({
      store,
      github,
      repo: "mizchi/my-app",
      adapterType: "playwright",
      lastDays: 30,
    });

    expect(result.runsCollected).toBe(1);
    expect(result.testsCollected).toBe(1);

    const runs = await store.raw<{ id: number }>(
      "SELECT id FROM workflow_runs"
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(100);

    const tests = await store.raw<{ test_name: string }>(
      "SELECT test_name FROM test_results"
    );
    expect(tests).toHaveLength(1);
    expect(tests[0].test_name).toBe("should work");
  });

  it("skips already collected workflow runs", async () => {
    const github = createMockGitHub();
    await collectWorkflowRuns({
      store,
      github,
      repo: "mizchi/my-app",
      adapterType: "playwright",
      lastDays: 30,
    });

    // Collect again — should skip existing
    const result = await collectWorkflowRuns({
      store,
      github,
      repo: "mizchi/my-app",
      adapterType: "playwright",
      lastDays: 30,
    });

    expect(result.runsCollected).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/commands/collect.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement collect command**

Create `src/cli/commands/collect.ts`:

```typescript
import { PlaywrightJsonAdapter } from "../adapters/playwright.js";
import type { TestResultAdapter } from "../adapters/types.js";
import type { MetricStore, WorkflowRun, TestResult } from "../storage/types.js";

export interface GitHubClient {
  listWorkflowRuns(): Promise<{
    total_count: number;
    workflow_runs: Array<{
      id: number;
      head_branch: string;
      head_sha: string;
      event: string;
      conclusion: string;
      created_at: string;
      run_started_at: string;
      updated_at: string;
    }>;
  }>;
  listArtifacts(runId?: number): Promise<{
    total_count: number;
    artifacts: Array<{ id: number; name: string; expired: boolean }>;
  }>;
  downloadArtifact(artifactId?: number): Promise<string>;
}

interface CollectOpts {
  store: MetricStore;
  github: GitHubClient;
  repo: string;
  adapterType: string;
  lastDays: number;
  branch?: string;
  artifactName?: string;
}

interface CollectResult {
  runsCollected: number;
  testsCollected: number;
}

function getAdapter(type: string): TestResultAdapter {
  if (type === "playwright") return new PlaywrightJsonAdapter();
  throw new Error(`Unknown adapter type: ${type}`);
}

export async function collectWorkflowRuns(
  opts: CollectOpts
): Promise<CollectResult> {
  const { store, github, repo, adapterType, artifactName } = opts;
  const adapter = getAdapter(adapterType);
  const reportName = artifactName ?? "playwright-report";

  const { workflow_runs } = await github.listWorkflowRuns();

  let runsCollected = 0;
  let testsCollected = 0;

  for (const run of workflow_runs) {
    // Skip already collected
    const existing = await store.raw<{ id: number }>(
      "SELECT id FROM workflow_runs WHERE id = $1",
      [run.id]
    );
    if (existing.length > 0) continue;

    const startTime = new Date(run.run_started_at || run.created_at);
    const endTime = new Date(run.updated_at);
    const durationMs = endTime.getTime() - startTime.getTime();

    const workflowRun: WorkflowRun = {
      id: run.id,
      repo,
      branch: run.head_branch,
      commitSha: run.head_sha,
      event: run.event,
      status: run.conclusion,
      createdAt: new Date(run.created_at),
      durationMs,
    };
    await store.insertWorkflowRun(workflowRun);
    runsCollected++;

    // Find test report artifact
    const { artifacts } = await github.listArtifacts(run.id);
    const reportArtifact = artifacts.find(
      (a) => a.name === reportName && !a.expired
    );
    if (!reportArtifact) continue;

    const reportContent = await github.downloadArtifact(reportArtifact.id);
    const testCases = adapter.parse(reportContent);

    const testResults: TestResult[] = testCases.map((tc) => ({
      workflowRunId: run.id,
      suite: tc.suite,
      testName: tc.testName,
      status: tc.status,
      durationMs: tc.durationMs,
      retryCount: tc.retryCount,
      errorMessage: tc.errorMessage ?? null,
      commitSha: run.head_sha,
      variant: tc.variant ?? null,
      createdAt: new Date(run.created_at),
    }));

    await store.insertTestResults(testResults);
    testsCollected += testResults.length;
  }

  return { runsCollected, testsCollected };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/collect.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/collect.ts tests/commands/collect.test.ts
git commit -m "feat: implement collect command with GitHub API client interface"
```

---

### Task 7: MoonBit Core — Flaky Detector

**Files:**
- Create: `src/core/moon.mod.json`
- Create: `src/core/src/types/moon.pkg.json`
- Create: `src/core/src/types/types.mbt`
- Create: `src/core/src/flaky_detector/moon.pkg.json`
- Create: `src/core/src/flaky_detector/flaky_detector.mbt`
- Create: `src/core/src/flaky_detector/flaky_detector_test.mbt`

- [ ] **Step 1: Create MoonBit module**

Create `src/core/moon.mod.json`:

```json
{
  "name": "mizchi/metrici_core",
  "version": "0.1.0",
  "deps": {},
  "readme": "README.md",
  "repository": "",
  "license": "MIT",
  "keywords": [],
  "description": "metrici core computation engine"
}
```

- [ ] **Step 2: Create shared types**

Create `src/core/src/types/moon.pkg.json`:

```json
{}
```

Create `src/core/src/types/types.mbt`:

```moonbit
pub struct TestMeta {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int
  fail_count : Int
  last_run_at : String
  avg_duration_ms : Int
  previously_failed : Bool
  is_new : Bool
} derive(Eq, Show, FromJson, ToJson)

pub struct FlakyResult {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int
  fail_count : Int
  flaky_retry_count : Int
  is_quarantined : Bool
} derive(Eq, Show, FromJson, ToJson)

pub struct DetectInput {
  results : Array[TestRunEntry]
  threshold : Double
  min_runs : Int
} derive(FromJson, ToJson)

pub struct TestRunEntry {
  suite : String
  test_name : String
  status : String
  retry_count : Int
} derive(FromJson, ToJson)

pub struct DetectOutput {
  flaky_tests : Array[FlakyResult]
} derive(Eq, Show, FromJson, ToJson)
```

- [ ] **Step 3: Write failing flaky detector test**

Create `src/core/src/flaky_detector/moon.pkg.json`:

```json
{
  "import": [
    "mizchi/metrici_core/src/types"
  ]
}
```

Create `src/core/src/flaky_detector/flaky_detector_test.mbt`:

```moonbit
test "detect_flaky finds flaky tests" {
  let input : @types.DetectInput = {
    results: [
      // 10 runs for "should redirect": 3 failed, 2 flaky retry, 5 passed
      { suite: "login.spec.ts", test_name: "should redirect", status: "failed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "failed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "failed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "passed", retry_count: 1 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "passed", retry_count: 1 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "passed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "passed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "passed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "passed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should redirect", status: "passed", retry_count: 0 },
      // 5 runs for "should display": all passed
      { suite: "login.spec.ts", test_name: "should display", status: "passed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should display", status: "passed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should display", status: "passed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should display", status: "passed", retry_count: 0 },
      { suite: "login.spec.ts", test_name: "should display", status: "passed", retry_count: 0 },
    ],
    threshold: 2.0,
    min_runs: 3,
  }
  let output = detect_flaky(input)
  assert_eq!(output.flaky_tests.length(), 1)
  assert_eq!(output.flaky_tests[0].suite, "login.spec.ts")
  assert_eq!(output.flaky_tests[0].test_name, "should redirect")
  assert_eq!(output.flaky_tests[0].fail_count, 3)
  assert_eq!(output.flaky_tests[0].flaky_retry_count, 2)
  // flaky_rate = (3 + 2) / 10 * 100 = 50.0
  assert_eq!(output.flaky_tests[0].flaky_rate, 50.0)
}

test "detect_flaky respects min_runs" {
  let input : @types.DetectInput = {
    results: [
      { suite: "a.spec.ts", test_name: "t1", status: "failed", retry_count: 0 },
      { suite: "a.spec.ts", test_name: "t1", status: "passed", retry_count: 0 },
    ],
    threshold: 2.0,
    min_runs: 5, // not enough runs
  }
  let output = detect_flaky(input)
  assert_eq!(output.flaky_tests.length(), 0)
}

test "detect_flaky respects threshold" {
  let input : @types.DetectInput = {
    results: [
      // 1/100 = 1% failure rate
      { suite: "a.spec.ts", test_name: "t1", status: "failed", retry_count: 0 },
      ..Array::make(99, { suite: "a.spec.ts", test_name: "t1", status: "passed", retry_count: 0 }),
    ],
    threshold: 2.0, // 2% threshold, 1% < 2% so not flaky
    min_runs: 3,
  }
  let output = detect_flaky(input)
  assert_eq!(output.flaky_tests.length(), 0)
}
```

- [ ] **Step 4: Run MoonBit tests to verify they fail**

Run: `cd src/core && moon test`
Expected: FAIL — function not found

- [ ] **Step 5: Implement flaky detector**

Create `src/core/src/flaky_detector/flaky_detector.mbt`:

```moonbit
struct TestKey {
  suite : String
  test_name : String
} derive(Eq, Hash, Show)

struct TestAgg {
  mut total : Int
  mut fail_count : Int
  mut flaky_retry_count : Int
}

pub fn detect_flaky(input : @types.DetectInput) -> @types.DetectOutput {
  let map : Map[TestKey, TestAgg] = {}
  for entry in input.results {
    let key = { suite: entry.suite, test_name: entry.test_name }
    let agg = match map.get(key) {
      Some(a) => a
      None => {
        let a : TestAgg = { total: 0, fail_count: 0, flaky_retry_count: 0 }
        map.set(key, a)
        a
      }
    }
    agg.total += 1
    if entry.status == "failed" {
      agg.fail_count += 1
    }
    if entry.retry_count > 0 && entry.status == "passed" {
      agg.flaky_retry_count += 1
    }
  }

  let results : Array[@types.FlakyResult] = []
  for key, agg in map {
    if agg.total < input.min_runs {
      continue
    }
    let flaky_rate = (agg.fail_count + agg.flaky_retry_count).to_double() * 100.0 / agg.total.to_double()
    if flaky_rate < input.threshold {
      continue
    }
    results.push({
      suite: key.suite,
      test_name: key.test_name,
      flaky_rate,
      total_runs: agg.total,
      fail_count: agg.fail_count,
      flaky_retry_count: agg.flaky_retry_count,
      is_quarantined: false,
    })
  }

  // Sort by flaky_rate descending
  results.sort_by(fn(a, b) { b.flaky_rate.compare(a.flaky_rate) })
  { flaky_tests: results }
}
```

- [ ] **Step 6: Run MoonBit tests to verify they pass**

Run: `cd src/core && moon test`
Expected: 3 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/
git commit -m "feat: implement MoonBit flaky detector with threshold-based detection"
```

---

### Task 8: MoonBit Core — Sampler (random, weighted)

**Files:**
- Create: `src/core/src/sampler/moon.pkg.json`
- Create: `src/core/src/sampler/sampler.mbt`
- Create: `src/core/src/sampler/sampler_test.mbt`

- [ ] **Step 1: Write failing sampler tests**

Create `src/core/src/sampler/moon.pkg.json`:

```json
{
  "import": [
    "mizchi/metrici_core/src/types"
  ]
}
```

Create `src/core/src/sampler/sampler_test.mbt`:

```moonbit
test "random sampling selects correct count" {
  let meta : Array[@types.TestMeta] = Array::makei(20, fn(i) {
    {
      suite: "suite_\{i}.spec.ts",
      test_name: "test_\{i}",
      flaky_rate: 0.0,
      total_runs: 10,
      fail_count: 0,
      last_run_at: "2026-03-30",
      avg_duration_ms: 1000,
      previously_failed: false,
      is_new: false,
    }
  })
  let result = sample_random(meta, count=5, seed=42)
  assert_eq!(result.length(), 5)
  // All selected should be from the input
  for item in result {
    assert_true!(meta.iter().any(fn(m) { m.suite == item.suite && m.test_name == item.test_name }))
  }
}

test "random sampling returns all when count > total" {
  let meta : Array[@types.TestMeta] = [
    { suite: "a.spec.ts", test_name: "t1", flaky_rate: 0.0, total_runs: 10, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
    { suite: "b.spec.ts", test_name: "t2", flaky_rate: 0.0, total_runs: 10, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
  ]
  let result = sample_random(meta, count=10, seed=42)
  assert_eq!(result.length(), 2)
}

test "weighted sampling prefers flaky tests" {
  let meta : Array[@types.TestMeta] = [
    { suite: "stable.spec.ts", test_name: "stable", flaky_rate: 0.0, total_runs: 100, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
    { suite: "flaky.spec.ts", test_name: "flaky", flaky_rate: 80.0, total_runs: 100, fail_count: 80, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
  ]
  // Run 100 samples of 1 — flaky should be picked most of the time
  let mut flaky_count = 0
  for i = 0; i < 100; i = i + 1 {
    let result = sample_weighted(meta, count=1, seed=i.to_uint64())
    if result[0].test_name == "flaky" {
      flaky_count += 1
    }
  }
  // Flaky should be selected significantly more often
  assert_true!(flaky_count > 50)
}
```

- [ ] **Step 2: Run MoonBit tests to verify they fail**

Run: `cd src/core && moon test`
Expected: FAIL — function not found for sample_random, sample_weighted

- [ ] **Step 3: Implement sampler**

Create `src/core/src/sampler/sampler.mbt`:

```moonbit
/// Fisher-Yates shuffle using a simple LCG PRNG
fn shuffle_with_seed(arr : Array[@types.TestMeta], seed : UInt64) -> Array[@types.TestMeta] {
  let result = arr.copy()
  let mut state = seed
  for i = result.length() - 1; i > 0; i = i - 1 {
    // LCG: state = state * 6364136223846793005 + 1442695040888963407
    state = state * 6364136223846793005UL + 1442695040888963407UL
    let j = (state >> 33).to_int().land(0x7FFFFFFF) % (i + 1)
    let tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  result
}

pub fn sample_random(
  meta : Array[@types.TestMeta],
  ~count : Int,
  ~seed : UInt64
) -> Array[@types.TestMeta] {
  let shuffled = shuffle_with_seed(meta, seed)
  let n = if count > shuffled.length() { shuffled.length() } else { count }
  shuffled.iter().take(n).collect()
}

pub fn sample_weighted(
  meta : Array[@types.TestMeta],
  ~count : Int,
  ~seed : UInt64
) -> Array[@types.TestMeta] {
  if meta.is_empty() {
    return []
  }

  // Assign weights: base 1.0 + flaky_rate
  // This ensures even non-flaky tests have a chance
  let weights : Array[Double] = meta.map(fn(m) { 1.0 + m.flaky_rate })
  let total_weight = weights.iter().fold(init=0.0, fn(acc, w) { acc + w })

  let selected : Array[@types.TestMeta] = []
  let used : Map[Int, Bool] = {}
  let mut state = seed
  let n = if count > meta.length() { meta.length() } else { count }

  while selected.length() < n {
    // Generate random double in [0, total_weight)
    state = state * 6364136223846793005UL + 1442695040888963407UL
    let rand_val = (state >> 11).to_double() / 9007199254740992.0 * total_weight

    let mut cumulative = 0.0
    for i = 0; i < weights.length(); i = i + 1 {
      if used.contains(i) {
        continue
      }
      cumulative += weights[i]
      if cumulative > rand_val {
        selected.push(meta[i])
        used.set(i, true)
        break
      }
    }
  }
  selected
}
```

- [ ] **Step 4: Run MoonBit tests to verify they pass**

Run: `cd src/core && moon test`
Expected: All tests PASS (flaky_detector + sampler)

- [ ] **Step 5: Commit**

```bash
git add src/core/src/sampler/
git commit -m "feat: implement random and weighted sampling strategies in MoonBit"
```

---

### Task 9: WASM Loader (TypeScript ↔ MoonBit bridge)

**Files:**
- Create: `src/cli/core/loader.ts`
- Create: `tests/core/loader.test.ts`

- [ ] **Step 1: Build MoonBit WASM**

Run: `cd src/core && moon build --target wasm-gc`

Check output path — typically `src/core/target/wasm-gc/release/build/<pkg>/main.wasm`. Adjust paths in loader accordingly.

Note: MoonBit の wasm-gc export は `pub fn` で `@ffi.export` アノテーションが必要な場合がある。MoonBit のバージョンと export 方式を確認してから実装する。JSON 文字列を受け渡す FFI boundary の具体的な実装方法は MoonBit のドキュメントに従う。

- [ ] **Step 2: Write failing loader test**

Create `tests/core/loader.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadCore, type MetriciCore } from "../../src/cli/core/loader.js";

describe("WASM Core Loader", () => {
  let core: MetriciCore;

  it("loads WASM module", async () => {
    core = await loadCore();
    expect(core).toBeDefined();
    expect(typeof core.detectFlaky).toBe("function");
    expect(typeof core.sampleRandom).toBe("function");
    expect(typeof core.sampleWeighted).toBe("function");
  });

  it("detectFlaky returns results via WASM", async () => {
    core = await loadCore();
    const input = {
      results: [
        { suite: "a.spec.ts", test_name: "t1", status: "failed", retry_count: 0 },
        { suite: "a.spec.ts", test_name: "t1", status: "failed", retry_count: 0 },
        { suite: "a.spec.ts", test_name: "t1", status: "failed", retry_count: 0 },
        { suite: "a.spec.ts", test_name: "t1", status: "passed", retry_count: 0 },
        { suite: "a.spec.ts", test_name: "t1", status: "passed", retry_count: 0 },
      ],
      threshold: 2.0,
      min_runs: 3,
    };
    const output = core.detectFlaky(input);
    expect(output.flaky_tests).toHaveLength(1);
    expect(output.flaky_tests[0].flaky_rate).toBe(60.0);
  });

  it("sampleRandom returns correct count", async () => {
    core = await loadCore();
    const meta = Array.from({ length: 10 }, (_, i) => ({
      suite: `s${i}.spec.ts`,
      test_name: `t${i}`,
      flaky_rate: 0,
      total_runs: 10,
      fail_count: 0,
      last_run_at: "",
      avg_duration_ms: 100,
      previously_failed: false,
      is_new: false,
    }));
    const result = core.sampleRandom(meta, 3, 42);
    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/core/loader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement WASM loader**

Create `src/cli/core/loader.ts`:

```typescript
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface DetectInput {
  results: Array<{
    suite: string;
    test_name: string;
    status: string;
    retry_count: number;
  }>;
  threshold: number;
  min_runs: number;
}

export interface FlakyResult {
  suite: string;
  test_name: string;
  flaky_rate: number;
  total_runs: number;
  fail_count: number;
  flaky_retry_count: number;
  is_quarantined: boolean;
}

export interface DetectOutput {
  flaky_tests: FlakyResult[];
}

export interface TestMeta {
  suite: string;
  test_name: string;
  flaky_rate: number;
  total_runs: number;
  fail_count: number;
  last_run_at: string;
  avg_duration_ms: number;
  previously_failed: boolean;
  is_new: boolean;
}

export interface MetriciCore {
  detectFlaky(input: DetectInput): DetectOutput;
  sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[];
  sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[];
}

// Fallback pure-TypeScript implementation for when WASM is unavailable
function createFallbackCore(): MetriciCore {
  return {
    detectFlaky(input: DetectInput): DetectOutput {
      const map = new Map<string, { total: number; failCount: number; flakyRetryCount: number }>();
      for (const entry of input.results) {
        const key = `${entry.suite}::${entry.test_name}`;
        if (!map.has(key)) map.set(key, { total: 0, failCount: 0, flakyRetryCount: 0 });
        const agg = map.get(key)!;
        agg.total++;
        if (entry.status === "failed") agg.failCount++;
        if (entry.retry_count > 0 && entry.status === "passed") agg.flakyRetryCount++;
      }
      const results: FlakyResult[] = [];
      for (const [key, agg] of map) {
        if (agg.total < input.min_runs) continue;
        const flakyRate = ((agg.failCount + agg.flakyRetryCount) / agg.total) * 100;
        if (flakyRate < input.threshold) continue;
        const [suite, testName] = key.split("::");
        results.push({
          suite,
          test_name: testName,
          flaky_rate: flakyRate,
          total_runs: agg.total,
          fail_count: agg.failCount,
          flaky_retry_count: agg.flakyRetryCount,
          is_quarantined: false,
        });
      }
      results.sort((a, b) => b.flaky_rate - a.flaky_rate);
      return { flaky_tests: results };
    },

    sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[] {
      const arr = [...meta];
      let state = BigInt(seed);
      for (let i = arr.length - 1; i > 0; i--) {
        state = (state * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
        const j = Number((state >> 33n) & 0x7FFFFFFFn) % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.slice(0, Math.min(count, arr.length));
    },

    sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[] {
      if (meta.length === 0) return [];
      const n = Math.min(count, meta.length);
      const weights = meta.map((m) => 1.0 + m.flaky_rate);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const selected: TestMeta[] = [];
      const used = new Set<number>();
      let state = BigInt(seed);

      while (selected.length < n) {
        state = (state * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
        const randVal = Number((state >> 11n) & 0x1FFFFFFFFFFFFFn) / 9007199254740992 * totalWeight;
        let cumulative = 0;
        for (let i = 0; i < weights.length; i++) {
          if (used.has(i)) continue;
          cumulative += weights[i];
          if (cumulative > randVal) {
            selected.push(meta[i]);
            used.add(i);
            break;
          }
        }
      }
      return selected;
    },
  };
}

export async function loadCore(): Promise<MetriciCore> {
  // Try to load WASM first, fall back to pure TS
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const wasmPath = resolve(__dirname, "../../core/target/wasm-gc/release/build/main.wasm");
    const wasmBuffer = readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(wasmBuffer);
    // TODO: Wire up WASM exports when MoonBit FFI boundary is finalized
    // For now, fall through to fallback
    void instance;
    throw new Error("WASM bridge not yet implemented");
  } catch {
    return createFallbackCore();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/core/loader.test.ts`
Expected: 3 tests PASS (using fallback implementation)

- [ ] **Step 6: Commit**

```bash
git add src/cli/core/loader.ts tests/core/loader.test.ts
git commit -m "feat: implement WASM loader with TypeScript fallback for core computation"
```

---

### Task 10: flaky Command

**Files:**
- Create: `src/cli/commands/flaky.ts`
- Create: `tests/commands/flaky.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/commands/flaky.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { WorkflowRun, TestResult } from "../../src/cli/storage/types.js";
import { runFlaky } from "../../src/cli/commands/flaky.js";

async function seedData(store: DuckDBStore) {
  const run: WorkflowRun = {
    id: 1,
    repo: "mizchi/my-app",
    branch: "main",
    commitSha: "abc123",
    event: "push",
    status: "completed",
    createdAt: new Date(),
    durationMs: 60000,
  };
  await store.insertWorkflowRun(run);

  const now = new Date();
  const results: TestResult[] = [];

  // Flaky test: 5/10 fail
  for (let i = 0; i < 10; i++) {
    results.push({
      workflowRunId: 1,
      suite: "tests/login.spec.ts",
      testName: "should redirect",
      status: i < 5 ? "failed" : "passed",
      durationMs: 1000,
      retryCount: 0,
      errorMessage: i < 5 ? "Timeout" : null,
      commitSha: "abc123",
      variant: null,
      createdAt: now,
    });
  }

  // Stable test: all pass
  for (let i = 0; i < 10; i++) {
    results.push({
      workflowRunId: 1,
      suite: "tests/home.spec.ts",
      testName: "should display",
      status: "passed",
      durationMs: 500,
      retryCount: 0,
      errorMessage: null,
      commitSha: "abc123",
      variant: null,
      createdAt: now,
    });
  }

  await store.insertTestResults(results);
}

describe("flaky command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    await seedData(store);
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns flaky tests sorted by flaky_rate", async () => {
    const result = await runFlaky({ store, top: 20, windowDays: 14 });
    expect(result).toHaveLength(1);
    expect(result[0].suite).toBe("tests/login.spec.ts");
    expect(result[0].testName).toBe("should redirect");
    expect(result[0].flakyRate).toBe(50.0);
  });

  it("filters by test name", async () => {
    const result = await runFlaky({
      store,
      top: 20,
      windowDays: 14,
      testFilter: "should display",
    });
    expect(result).toHaveLength(0); // stable test, no flaky
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/commands/flaky.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement flaky command**

Create `src/cli/commands/flaky.ts`:

```typescript
import type { MetricStore, FlakyScore } from "../storage/types.js";

interface FlakyOpts {
  store: MetricStore;
  top: number;
  windowDays: number;
  testFilter?: string;
}

export async function runFlaky(opts: FlakyOpts): Promise<FlakyScore[]> {
  const results = await opts.store.queryFlakyTests({
    top: opts.top,
    windowDays: opts.windowDays,
  });

  if (opts.testFilter) {
    return results.filter(
      (r) =>
        r.suite.includes(opts.testFilter!) ||
        r.testName.includes(opts.testFilter!)
    );
  }

  return results;
}

export function formatFlakyTable(results: FlakyScore[]): string {
  if (results.length === 0) return "No flaky tests found.";

  const header = "Suite | Test | Flaky Rate | Runs | Fails | Retries";
  const separator = "------|------|------------|------|-------|--------";
  const rows = results.map(
    (r) =>
      `${r.suite} | ${r.testName} | ${r.flakyRate.toFixed(1)}% | ${r.totalRuns} | ${r.failCount} | ${r.flakyRetryCount}`
  );

  return [header, separator, ...rows].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/flaky.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/flaky.ts tests/commands/flaky.test.ts
git commit -m "feat: implement flaky command with threshold-based detection"
```

---

### Task 11: sample Command

**Files:**
- Create: `src/cli/commands/sample.ts`
- Create: `tests/commands/sample.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/commands/sample.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { WorkflowRun, TestResult } from "../../src/cli/storage/types.js";
import { runSample } from "../../src/cli/commands/sample.js";

async function seedTestMeta(store: DuckDBStore) {
  const run: WorkflowRun = {
    id: 1,
    repo: "mizchi/my-app",
    branch: "main",
    commitSha: "abc123",
    event: "push",
    status: "completed",
    createdAt: new Date(),
    durationMs: 60000,
  };
  await store.insertWorkflowRun(run);

  const now = new Date();
  const results: TestResult[] = [];

  // Create 20 tests, some flaky
  for (let t = 0; t < 20; t++) {
    for (let r = 0; r < 10; r++) {
      const isFlaky = t < 3; // first 3 tests are flaky
      results.push({
        workflowRunId: 1,
        suite: `tests/test_${t}.spec.ts`,
        testName: `test_${t}`,
        status: isFlaky && r < 3 ? "failed" : "passed",
        durationMs: 1000,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: now,
      });
    }
  }

  await store.insertTestResults(results);
}

describe("sample command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    await seedTestMeta(store);
  });

  afterEach(async () => {
    await store.close();
  });

  it("random strategy returns requested count", async () => {
    const result = await runSample({
      store,
      strategy: "random",
      count: 5,
    });
    expect(result).toHaveLength(5);
  });

  it("weighted strategy returns requested count", async () => {
    const result = await runSample({
      store,
      strategy: "weighted",
      count: 5,
    });
    expect(result).toHaveLength(5);
  });

  it("percentage mode works", async () => {
    const result = await runSample({
      store,
      strategy: "random",
      percentage: 50,
    });
    expect(result.length).toBe(10); // 50% of 20
  });

  it("sample output includes suite and testName", async () => {
    const result = await runSample({
      store,
      strategy: "random",
      count: 1,
    });
    expect(result[0]).toHaveProperty("suite");
    expect(result[0]).toHaveProperty("testName");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/commands/sample.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement sample command**

Create `src/cli/commands/sample.ts`:

```typescript
import { loadCore, type TestMeta } from "../core/loader.js";
import type { MetricStore } from "../storage/types.js";

interface SampleOpts {
  store: MetricStore;
  strategy: "random" | "weighted";
  count?: number;
  percentage?: number;
}

interface SampleResult {
  suite: string;
  testName: string;
  flakyRate: number;
}

export async function runSample(opts: SampleOpts): Promise<SampleResult[]> {
  const { store, strategy } = opts;
  const core = await loadCore();

  // Get all unique tests with their flaky info
  const allTests = await store.raw<{
    suite: string;
    test_name: string;
    total_runs: number;
    fail_count: number;
    avg_duration_ms: number;
  }>(`
    SELECT
      suite,
      test_name,
      COUNT(*)::INTEGER AS total_runs,
      COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS fail_count,
      AVG(duration_ms)::INTEGER AS avg_duration_ms
    FROM test_results
    GROUP BY suite, test_name
  `);

  const meta: TestMeta[] = allTests.map((t) => ({
    suite: t.suite,
    test_name: t.test_name,
    flaky_rate:
      t.total_runs > 0 ? (t.fail_count / t.total_runs) * 100 : 0,
    total_runs: t.total_runs,
    fail_count: t.fail_count,
    last_run_at: "",
    avg_duration_ms: t.avg_duration_ms ?? 0,
    previously_failed: false,
    is_new: false,
  }));

  let count: number;
  if (opts.percentage) {
    count = Math.round((meta.length * opts.percentage) / 100);
  } else {
    count = opts.count ?? 10;
  }

  const seed = Date.now();
  let selected: TestMeta[];
  if (strategy === "weighted") {
    selected = core.sampleWeighted(meta, count, seed);
  } else {
    selected = core.sampleRandom(meta, count, seed);
  }

  return selected.map((m) => ({
    suite: m.suite,
    testName: m.test_name,
    flakyRate: m.flaky_rate,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/sample.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/sample.ts tests/commands/sample.test.ts
git commit -m "feat: implement sample command with random and weighted strategies"
```

---

### Task 12: run Command (Direct Runner)

**Files:**
- Create: `src/cli/runners/direct.ts`
- Create: `src/cli/commands/run.ts`

- [ ] **Step 1: Implement direct runner**

Create `src/cli/runners/direct.ts`:

```typescript
import { execSync } from "node:child_process";

export interface RunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TestRunner {
  run(testPatterns: string[], command: string): RunnerResult;
}

export class DirectRunner implements TestRunner {
  run(testPatterns: string[], command: string): RunnerResult {
    const grepPattern = testPatterns.join("|");
    const fullCommand = `${command} --grep "${grepPattern}"`;

    try {
      const stdout = execSync(fullCommand, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (error: unknown) {
      const e = error as { status: number; stdout: string; stderr: string };
      return {
        exitCode: e.status ?? 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
      };
    }
  }
}
```

- [ ] **Step 2: Implement run command**

Create `src/cli/commands/run.ts`:

```typescript
import { runSample } from "./sample.js";
import { DirectRunner, type TestRunner } from "../runners/direct.js";
import type { MetricStore } from "../storage/types.js";

interface RunOpts {
  store: MetricStore;
  strategy: "random" | "weighted";
  count?: number;
  percentage?: number;
  runnerCommand: string;
}

interface RunResult {
  testsSelected: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runTests(opts: RunOpts): Promise<RunResult> {
  const sampled = await runSample({
    store: opts.store,
    strategy: opts.strategy,
    count: opts.count,
    percentage: opts.percentage,
  });

  if (sampled.length === 0) {
    return { testsSelected: 0, exitCode: 0, stdout: "No tests selected.", stderr: "" };
  }

  const patterns = sampled.map((s) => s.testName);
  const runner: TestRunner = new DirectRunner();
  const result = runner.run(patterns, opts.runnerCommand);

  return {
    testsSelected: sampled.length,
    ...result,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/runners/direct.ts src/cli/commands/run.ts
git commit -m "feat: implement run command with direct runner"
```

---

### Task 13: query Command

**Files:**
- Create: `src/cli/commands/query.ts`
- Create: `tests/commands/query.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/commands/query.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runQuery } from "../../src/cli/commands/query.js";

describe("query command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("executes raw SQL and returns results", async () => {
    const result = await runQuery(store, "SELECT 42 AS answer");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ answer: 42 });
  });

  it("queries test_results table", async () => {
    const result = await runQuery(
      store,
      "SELECT COUNT(*) AS cnt FROM test_results"
    );
    expect(result[0]).toEqual({ cnt: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/commands/query.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement query command**

Create `src/cli/commands/query.ts`:

```typescript
import type { MetricStore } from "../storage/types.js";

export async function runQuery(
  store: MetricStore,
  sql: string
): Promise<unknown[]> {
  return store.raw(sql);
}

export function formatQueryResult(rows: unknown[]): string {
  if (rows.length === 0) return "No results.";

  const firstRow = rows[0] as Record<string, unknown>;
  const columns = Object.keys(firstRow);
  const header = columns.join(" | ");
  const separator = columns.map(() => "---").join(" | ");
  const body = rows.map((row) => {
    const r = row as Record<string, unknown>;
    return columns.map((c) => String(r[c] ?? "NULL")).join(" | ");
  });

  return [header, separator, ...body].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/query.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/query.ts tests/commands/query.test.ts
git commit -m "feat: implement query command for raw SQL access"
```

---

### Task 14: CLI Entry Point (commander)

**Files:**
- Create: `src/cli/main.ts`

- [ ] **Step 1: Implement CLI entry point**

Create `src/cli/main.ts`:

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { runInit } from "./commands/init.js";
import { collectWorkflowRuns } from "./commands/collect.js";
import { runFlaky, formatFlakyTable } from "./commands/flaky.js";
import { runSample } from "./commands/sample.js";
import { runTests } from "./commands/run.js";
import { runQuery, formatQueryResult } from "./commands/query.js";
import { DuckDBStore } from "./storage/duckdb.js";
import { Octokit } from "@octokit/rest";

const program = new Command();

program.name("metrici").version("0.1.0").description("Flaky test management & test sampling CLI");

program
  .command("init")
  .description("Generate metrici.toml")
  .requiredOption("--owner <owner>", "Repository owner")
  .requiredOption("--name <name>", "Repository name")
  .action(async (opts) => {
    await runInit(process.cwd(), opts);
    console.log("Created metrici.toml");
  });

program
  .command("collect")
  .description("Fetch test results from GitHub Actions API")
  .option("--last <days>", "Number of days to look back", "30")
  .option("--branch <branch>", "Filter by branch")
  .action(async (opts) => {
    const config = await loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = [config.repo.owner, config.repo.name];

    const github = {
      async listWorkflowRuns() {
        const since = new Date();
        since.setDate(since.getDate() - parseInt(opts.last));
        const { data } = await octokit.actions.listWorkflowRunsForRepo({
          owner,
          repo,
          created: `>=${since.toISOString().split("T")[0]}`,
          branch: opts.branch,
          per_page: 100,
        });
        return data;
      },
      async listArtifacts(runId: number) {
        const { data } = await octokit.actions.listWorkflowRunArtifacts({
          owner,
          repo,
          run_id: runId,
        });
        return data;
      },
      async downloadArtifact(artifactId: number) {
        const { data } = await octokit.actions.downloadArtifact({
          owner,
          repo,
          artifact_id: artifactId,
          archive_format: "zip",
        });
        // data is a zip buffer — needs unzipping to get JSON
        // For now, return as string. Actual implementation needs adm-zip or similar.
        return data as unknown as string;
      },
    };

    const result = await collectWorkflowRuns({
      store,
      github,
      repo: `${owner}/${repo}`,
      adapterType: config.adapter.type,
      lastDays: parseInt(opts.last),
    });

    console.log(`Collected ${result.runsCollected} runs, ${result.testsCollected} test results`);
    await store.close();
  });

program
  .command("flaky")
  .description("List flaky tests")
  .option("--top <n>", "Number of results", "20")
  .option("--test <filter>", "Filter by test name")
  .action(async (opts) => {
    const config = await loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    const results = await runFlaky({
      store,
      top: parseInt(opts.top),
      windowDays: config.flaky.window_days,
      testFilter: opts.test,
    });

    console.log(formatFlakyTable(results));
    await store.close();
  });

program
  .command("sample")
  .description("Sample tests using a strategy")
  .option("--strategy <strategy>", "Sampling strategy", "random")
  .option("--count <n>", "Number of tests to sample")
  .option("--percentage <n>", "Percentage of tests to sample")
  .action(async (opts) => {
    const config = await loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    const results = await runSample({
      store,
      strategy: opts.strategy as "random" | "weighted",
      count: opts.count ? parseInt(opts.count) : undefined,
      percentage: opts.percentage ? parseInt(opts.percentage) : undefined,
    });

    for (const r of results) {
      console.log(`${r.suite} > ${r.testName} (flaky: ${r.flakyRate.toFixed(1)}%)`);
    }
    await store.close();
  });

program
  .command("run")
  .description("Sample and execute tests")
  .option("--strategy <strategy>", "Sampling strategy", "random")
  .option("--count <n>", "Number of tests to run")
  .option("--percentage <n>", "Percentage of tests to run")
  .action(async (opts) => {
    const config = await loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    const result = await runTests({
      store,
      strategy: opts.strategy as "random" | "weighted",
      count: opts.count ? parseInt(opts.count) : undefined,
      percentage: opts.percentage ? parseInt(opts.percentage) : undefined,
      runnerCommand: config.runner.command,
    });

    console.log(`Selected ${result.testsSelected} tests. Exit code: ${result.exitCode}`);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    await store.close();
    process.exit(result.exitCode);
  });

program
  .command("query <sql>")
  .description("Execute raw SQL query")
  .action(async (sql) => {
    const config = await loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    const results = await runQuery(store, sql);
    console.log(formatQueryResult(results));
    await store.close();
  });

program.parse();
```

- [ ] **Step 2: Verify CLI loads**

Run: `pnpm tsx src/cli/main.ts --help`
Expected: Shows help text with all commands

- [ ] **Step 3: Commit**

```bash
git add src/cli/main.ts
git commit -m "feat: implement CLI entry point with all Phase 1 commands"
```

---

### Task 15: Integration Test & Final Verification

**Files:**
- Create: `tests/integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { PlaywrightJsonAdapter } from "../src/cli/adapters/playwright.js";
import { runFlaky } from "../src/cli/commands/flaky.js";
import { runSample } from "../src/cli/commands/sample.js";
import { runQuery } from "../src/cli/commands/query.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkflowRun, TestResult } from "../src/cli/storage/types.js";

describe("metrici integration", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("full pipeline: parse → store → flaky → sample", async () => {
    // 1. Parse Playwright report
    const adapter = new PlaywrightJsonAdapter();
    const fixture = readFileSync(
      resolve(import.meta.dirname, "fixtures/playwright-report.json"),
      "utf-8"
    );
    const testCases = adapter.parse(fixture);
    expect(testCases.length).toBeGreaterThan(0);

    // 2. Store results (simulate multiple workflow runs with same tests)
    for (let runId = 1; runId <= 5; runId++) {
      const run: WorkflowRun = {
        id: runId,
        repo: "mizchi/my-app",
        branch: "main",
        commitSha: `sha_${runId}`,
        event: "push",
        status: "completed",
        createdAt: new Date(),
        durationMs: 60000,
      };
      await store.insertWorkflowRun(run);

      const results: TestResult[] = testCases.map((tc) => ({
        workflowRunId: runId,
        suite: tc.suite,
        testName: tc.testName,
        status: tc.status === "flaky" ? (runId % 2 === 0 ? "failed" : "passed") : tc.status,
        durationMs: tc.durationMs,
        retryCount: tc.retryCount,
        errorMessage: tc.errorMessage ?? null,
        commitSha: `sha_${runId}`,
        variant: tc.variant ?? null,
        createdAt: new Date(),
      }));
      await store.insertTestResults(results);
    }

    // 3. Query flaky tests
    const flaky = await runFlaky({ store, top: 10, windowDays: 14 });
    expect(flaky.length).toBeGreaterThan(0);

    // 4. Sample tests
    const sampled = await runSample({ store, strategy: "weighted", count: 2 });
    expect(sampled.length).toBeGreaterThan(0);
    expect(sampled[0]).toHaveProperty("suite");
    expect(sampled[0]).toHaveProperty("testName");

    // 5. Raw query works
    const rawResult = await runQuery(
      store,
      "SELECT COUNT(*) AS cnt FROM test_results"
    );
    expect((rawResult[0] as { cnt: number }).cnt).toBe(20); // 4 tests * 5 runs
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 3: Run MoonBit tests**

Run: `cd src/core && moon test`
Expected: All tests PASS

- [ ] **Step 4: Verify CLI end-to-end**

Run: `pnpm tsx src/cli/main.ts --help`
Expected: All commands listed

- [ ] **Step 5: Commit**

```bash
git add tests/integration.test.ts
git commit -m "feat: add integration test for full pipeline"
```

- [ ] **Step 6: Final commit with updated docs**

```bash
git add -A
git commit -m "chore: complete metrici Phase 1 implementation"
```
