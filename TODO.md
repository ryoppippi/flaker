# TODO

## 進行中
- [x] DuckDB のネイティブバイナリが無い環境で CLI が即死しないよう、`duckdb` 初期化を遅延ロード + エラーメッセージ改善する
- [x] `resolveAffectedFallback` のパーサを複数行 `task(...)` 定義に対応させる
- [x] `resolveAffectedFallback` の glob 解釈を MoonBit 実装仕様と突き合わせる（差分テスト追加）

## 次のマイルストーン
- [x] `flaker doctor` コマンドを追加し、DuckDB/MoonBit の実行環境チェックを 1 コマンドで確認可能にする
- [x] CI で「MoonBit あり / なし」の 2 パターンを回し、フォールバック経路を常時検証する

## crater 由来機能の整理と MoonBit 移行

### 分類 A: MoonBit core に寄せる pure logic

- [x] graph analyzer / dependency traversal
  - 元ネタ: crater dogfood 全般 + ADR-006
  - 対応コード:
    - `src/cli/graph/analyzer.ts`
    - `src/core/src/graph_core/`
  - 方針:
    - affected expansion / reverse deps / topo sort / test pattern 収集は MoonBit を正本にする
    - adapter は TS に残し、IR を MoonBit core に渡す

- [ ] normalized summary / diff / aggregate core
  - 元 issue: #6, #7
  - 対応コード:
    - `src/cli/reporting/playwright-report-summary-core.ts`
    - `src/cli/reporting/playwright-report-diff-core.ts`
    - `src/cli/reporting/flaker-batch-summary-core.ts`
    - `src/cli/commands/report.ts`
  - 方針:
    - summary reduction と base/head diff、aggregate totals は MoonBit 候補
    - artifact I/O と markdown rendering は TS に残す
  - 進捗:
    - `report diff` の classifier は `src/core/src/report_diff_core/` に移行済み
    - `report aggregate` の totals / unstable reducer は `src/core/src/report_aggregate_core/` に移行済み

- [ ] quarantine policy evaluation core
  - 元 issue: #5, #9
  - 対応コード:
    - `src/cli/runners/quarantine-runtime.ts`
    - `src/cli/reporting/flaker-quarantine-match.ts`
    - `src/cli/reporting/flaker-quarantine-expiry.ts`
  - 方針:
    - `task/spec/titlePattern/variant` に対する match と mode 判定は MoonBit 候補
    - manifest parse と runtime glue は TS に残す

- [ ] config ownership analysis core
  - 元 issue: #4
  - 対応コード:
    - `src/cli/commands/check.ts`
  - 方針:
    - duplicate ownership / split ownership / unmanaged spec の判定ロジックは MoonBit 候補
    - filesystem scan と runner/listTests は TS に残す

### 分類 B: hybrid のまま進める機能

- [ ] affected explain / inspect
  - 元 issue: #3
  - 対応コード:
    - `src/cli/commands/affected.ts`
    - `src/cli/resolvers/*`
  - 方針:
    - direct / transitive selection の判定は MoonBit 化可能
    - resolver 固有の match reason と JSON/Markdown 出力は TS shell を維持

- [ ] stable test identity
  - 元 issue: #8
  - 対応コード:
    - `src/cli/identity.ts`
    - `src/cli/storage/test-result-mapper.ts`
  - 方針:
    - adapter 境界の正規化は TS 維持
    - 将来的に stable ID の canonical hash/normalization は MoonBit 化を検討

- [ ] eval / KPI aggregation
  - crater dogfood で追加された predictive KPI を含む
  - 対応コード:
    - `src/cli/commands/eval.ts`
  - 方針:
    - commit 単位の集計や confusion matrix は pure logic なので MoonBit 候補
    - DB query と CLI formatting は TS に残す

### 分類 C: TS shell に残す

- [ ] adapter / artifact ingestion
  - `src/cli/adapters/*`
  - `src/cli/commands/import.ts`
  - `src/cli/commands/collect.ts`
  - `src/cli/commands/collect-local.ts`

- [ ] manifest / report parse / markdown rendering
  - `src/cli/quarantine-manifest.ts`
  - `src/cli/reporting/*parser.ts`
  - `src/cli/reporting/*report.ts`
  - `src/cli/main.ts`

### 直近の移行順

1. graph analyzer を MoonBit 正本にする
2. report summary/diff/aggregate の pure core を MoonBit に移す
3. quarantine match / policy evaluation を MoonBit に移す
4. config ownership analysis を MoonBit に移す

## 完了済み
- [x] MoonBit 未ビルド時でも affected target を解決できる TypeScript fallback を実装
