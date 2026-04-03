///|
test "run_cli renders help for direct core CLI" {
  let result = run_cli(["flaker", "--help"], "js")
  assert_eq(result.exit_code, 0)
  assert_true(result.output.contains("Usage: flaker"))
  assert_true(
    result.output.contains(
      "Experimental direct MoonBit CLI for flaker core commands.",
    ),
  )
  assert_true(result.output.contains("Target: js"))
  assert_true(result.output.contains("Options:"))
  assert_true(result.output.contains("-V, --version"))
  assert_true(
    result.output.contains(
      "Use the npm CLI for GitHub, DuckDB, and artifact ingestion",
    ),
  )
}

///|
test "run_cli renders version" {
  let result = run_cli(["flaker", "--version"], "native")
  assert_eq(result.exit_code, 0)
  assert_eq(result.output, "flaker core CLI 0.1.0 (native)")
}

///|
test "run_cli normalizes node and script argv on js target" {
  let result = run_cli(
    ["/usr/local/bin/node", "/tmp/flaker.js", "--help"],
    "js",
  )
  assert_eq(result.exit_code, 0)
  assert_true(result.output.contains("Usage: flaker"))
}

///|
test "run_cli rejects unsupported commands for now" {
  let result = run_cli(["flaker", "collect"], "js")
  assert_eq(result.exit_code, 1)
  assert_true(result.output.contains("error: unexpected"))
  assert_true(result.output.contains("collect"))
  assert_true(result.output.contains("Usage: flaker"))
  assert_true(result.output.contains("Target: js"))
}
