///|
pub fn run_cli(argv : Array[String], target_name : String) -> CliResult {
  let args = normalize_args(argv)
  match args {
    [] | ["--help"] =>
      CliResult::{ exit_code: 0, output: render_help(target_name) }
    ["--version"] =>
      CliResult::{ exit_code: 0, output: render_version(target_name) }
    _ => parse_direct_command(args, target_name)
  }
}
