///|
fn main {
  ()
}

///|
pub fn detect_flaky_json(input_json : String) -> String {
  let input : @types.DetectInput = try! @json.from_json(
    try! @json.parse(input_json),
  )
  let output = @flaky_detector.detect_flaky(input)
  output.to_json().stringify()
}

///|
pub fn sample_random_json(
  meta_json : String,
  count : Int,
  seed : Int,
) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(
    try! @json.parse(meta_json),
  )
  let result = @sampler.sample_random(meta, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn sample_weighted_json(
  meta_json : String,
  count : Int,
  seed : Int,
) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(
    try! @json.parse(meta_json),
  )
  let result = @sampler.sample_weighted(meta, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn sample_hybrid_json(meta_json : String, affected_json : String, count : Int, seed : Int) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(try! @json.parse(meta_json))
  let affected : Array[String] = try! @json.from_json(try! @json.parse(affected_json))
  let result = @sampler.sample_hybrid(meta, affected_suites=affected, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn resolve_affected_json(
  workflow_text : String,
  changed_paths_json : String,
) -> String {
  let changed : Array[String] = try! @json.from_json(
    try! @json.parse(changed_paths_json),
  )
  let result = @affected.resolve_affected(workflow_text, changed)
  result.to_json().stringify()
}

///|
pub fn find_affected_nodes_json(
  graph_json : String,
  changed_files_json : String,
) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let changed : Array[String] = try! @json.from_json(
    try! @json.parse(changed_files_json),
  )
  let result = @graph_core.find_affected_nodes(graph, changed)
  result.to_json().stringify()
}

///|
pub fn expand_transitive_json(
  graph_json : String,
  initial_json : String,
) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let initial : Array[String] = try! @json.from_json(
    try! @json.parse(initial_json),
  )
  let result = @graph_core.expand_transitive(graph, initial)
  result.to_json().stringify()
}

///|
pub fn build_reverse_deps_json(graph_json : String) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let result = @graph_core.build_reverse_deps(graph)
  result.to_json().stringify()
}

///|
pub fn topological_sort_json(graph_json : String) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let result = @graph_core.topological_sort(graph)
  result.to_json().stringify()
}

///|
pub fn get_affected_test_patterns_json(
  graph_json : String,
  affected_ids_json : String,
) -> String {
  let graph : @types.DependencyGraphInput = try! @json.from_json(
    try! @json.parse(graph_json),
  )
  let affected_ids : Array[String] = try! @json.from_json(
    try! @json.parse(affected_ids_json),
  )
  let result = @graph_core.get_affected_test_patterns(graph, affected_ids)
  result.to_json().stringify()
}

///|
pub fn classify_report_diff_json(inputs_json : String) -> String {
  let inputs : Array[@types.ReportDiffStatusInput] = try! @json.from_json(
    try! @json.parse(inputs_json),
  )
  let result = @report_diff_core.classify_report_diff(inputs)
  result.to_json().stringify()
}

///|
pub fn aggregate_report_json(shards_json : String) -> String {
  let shards : Array[@types.ReportAggregateShardInput] = try! @json.from_json(
    try! @json.parse(shards_json),
  )
  let result = @report_aggregate_core.aggregate_report(shards)
  result.to_json().stringify()
}
