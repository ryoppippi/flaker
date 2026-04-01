import { execSync } from "node:child_process";

interface ActrunRunnerOpts {
  workflow: string;
  job?: string;
  exec?: (cmd: string) => string;
}

export class ActrunRunner {
  private workflow: string;
  private job?: string;
  private execFn: (cmd: string) => string;

  constructor(opts: ActrunRunnerOpts) {
    this.workflow = opts.workflow;
    this.job = opts.job;
    this.execFn = opts.exec ?? ((cmd) => execSync(cmd, { encoding: "utf-8", stdio: "inherit" }) ?? "");
  }

  run(pattern: string): void {
    const parts = ["actrun workflow run", this.workflow];
    if (this.job) parts.push(`--job ${this.job}`);
    this.execFn(parts.join(" "));
  }

  retry(): void {
    const parts = ["actrun workflow run", this.workflow, "--retry"];
    if (this.job) parts.push(`--job ${this.job}`);
    this.execFn(parts.join(" "));
  }
}
