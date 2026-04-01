# Runner Adapter Specification

## Problem

metrici がテストケースを個別に実行するとき、各テストランナーの CLI 構文が異なる:

| Runner | 単一テスト実行 | ファイル指定 | 結果出力 |
|--------|--------------|------------|---------|
| vitest | `vitest run -t "name"` | `vitest run path/to/file` | `--reporter json` → stdout |
| playwright test | `playwright test --grep "name"` | `playwright test path/to/file` | `--reporter json` → stdout |
| moon test | `moon test --filter "pkg/test_name"` | `moon test pkg/` | stdout (TAP-like) |
| pytest | `pytest path::test_name` | `pytest path/` | `--json-report` → file |
| jest | `jest -t "name"` | `jest path/to/file` | `--json` → stdout |
| go test | `go test -run "Name"` | `go test ./pkg/` | stdout (TAP-like) |

## Design

### Test Identifier (言語中立)

```typescript
interface TestId {
  suite: string;      // ファイルパスまたはスイート名 (e.g., "tests/login.spec.ts")
  testName: string;   // テストケース名 (e.g., "should redirect after login")
}
```

### Runner Adapter Interface

```typescript
interface RunnerAdapter {
  name: string;

  // TestId[] → 実行コマンドを構築して実行、結果を返す
  execute(tests: TestId[], opts: ExecuteOpts): Promise<ExecuteResult>;

  // 全テスト一覧を取得（サンプリングの母集団）
  listTests(): Promise<TestId[]>;
}

interface ExecuteOpts {
  cwd?: string;
  timeout?: number;      // ms
  retries?: number;
  reporter?: string;     // override default reporter
  env?: Record<string, string>;
}

interface ExecuteResult {
  exitCode: number;
  results: TestCaseResult[];  // パース済みの結果
  durationMs: number;
  stdout?: string;
  stderr?: string;
}
```

### Key Design Decisions

1. **execute が TestCaseResult[] を直接返す** — 実行と結果パースを一体化。ランナーが自分の結果フォーマットを知っているので、内部で適切な reporter を指定してパースする。

2. **listTests でテスト一覧を取得** — サンプリングの母集団をランナーから直接取得。`vitest --list`, `playwright test --list`, `moon test --dry-run` 等。

3. **バッチ実行** — TestId[] を一度に渡す。ランナーがバッチ実行を最適化できる（vitest は複数テストを1プロセスで実行可能）。

### Built-in Runner Adapters

#### VitestRunner

```
execute: vitest run -t "name1|name2|name3" --reporter json
list:    vitest --list --reporter json
```

#### PlaywrightRunner

```
execute: playwright test --grep "name1|name2" --reporter json
list:    playwright test --list --reporter json
```

#### MoonTestRunner

```
execute: moon test --filter "pkg::test_name"
list:    moon test --dry-run
```

### Configuration (metrici.toml)

```toml
[runner]
type = "vitest"                    # built-in adapter name
command = "pnpm vitest"            # base command
args = []                          # additional args

# Or custom runner via external command
[runner]
type = "custom"
execute = "node ./my-runner.js execute"   # stdin: TestId[] JSON, stdout: ExecuteResult JSON
list = "node ./my-runner.js list"         # stdout: TestId[] JSON
```

### Custom Runner Protocol (stdin/stdout JSON)

For `type = "custom"`, metrici communicates via JSON over stdin/stdout:

**execute:**
- stdin: `{ "tests": TestId[], "opts": ExecuteOpts }`
- stdout: `ExecuteResult` as JSON

**list:**
- stdin: (empty)
- stdout: `TestId[]` as JSON
