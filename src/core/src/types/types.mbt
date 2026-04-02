///|
pub(all) struct TestMeta {
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

///|
pub(all) struct FlakyResult {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int
  fail_count : Int
  flaky_retry_count : Int
  is_quarantined : Bool
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct DetectInput {
  results : Array[TestRunEntry]
  threshold : Double
  min_runs : Int
} derive(FromJson, ToJson)

///|
pub(all) struct TestRunEntry {
  suite : String
  test_name : String
  status : String
  retry_count : Int
} derive(FromJson, ToJson)

///|
pub(all) struct DetectOutput {
  flaky_tests : Array[FlakyResult]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct GraphNodeInput {
  id : String
  path : String
  dependencies : Array[String]
  source_patterns : Array[String]
  test_patterns : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct DependencyGraphInput {
  root_dir : String
  nodes : Array[GraphNodeInput]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReverseDepEntry {
  id : String
  dependents : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportDiffStatusInput {
  test_id : String
  base_status : String
  head_status : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportDiffBuckets {
  new_failures : Array[String]
  new_flaky : Array[String]
  resolved_failures : Array[String]
  resolved_flaky : Array[String]
  persistent_flaky : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportTotalsInput {
  total : Int
  passed : Int
  failed : Int
  flaky : Int
  skipped : Int
  retries : Int
  duration_ms : Int
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportAggregateUnstableStatusInput {
  test_id : String
  status : String
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportAggregateShardInput {
  shard_id : String
  totals : ReportTotalsInput
  unstable : Array[ReportAggregateUnstableStatusInput]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportAggregateUnstableBuckets {
  test_id : String
  shard_ids : Array[String]
  statuses : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct ReportAggregateOutput {
  shard_count : Int
  unstable_count : Int
  totals : ReportTotalsInput
  unstable : Array[ReportAggregateUnstableBuckets]
} derive(Eq, Show, FromJson, ToJson)
