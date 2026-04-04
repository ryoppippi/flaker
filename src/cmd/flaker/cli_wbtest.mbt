///|
test "run_cli returns empty for help (delegated to Node.js CLI)" {
  let result = run_cli(["flaker", "--help"], "js")
  assert_eq(result.exit_code, 0)
  assert_eq(result.output, "")
}

///|
test "run_cli renders version" {
  let result = run_cli(["flaker", "--version"], "native")
  assert_eq(result.exit_code, 0)
  assert_eq(result.output, "flaker core CLI 0.1.0 (native)")
}

///|
test "run_cli silently skips unknown commands" {
  let result = run_cli(["flaker", "collect"], "js")
  assert_eq(result.exit_code, 0)
  assert_eq(result.output, "")
}

///|
test "run_cli skips node argv help" {
  let result = run_cli(
    ["/usr/local/bin/node", "/tmp/flaker.js", "--help"],
    "js",
  )
  assert_eq(result.exit_code, 0)
  assert_eq(result.output, "")
}
