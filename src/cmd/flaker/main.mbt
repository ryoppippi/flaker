///|
fn main {
  let result = run_cli(@env.args(), current_target_name())
  if result.output != "" {
    println(result.output)
  }
}
