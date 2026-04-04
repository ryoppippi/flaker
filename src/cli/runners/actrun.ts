import { spawnSync } from "node:child_process";
import type { ActrunRunOutput } from "../adapters/actrun.js";

export interface ActrunResult {
  runId: string;
  conclusion: string;
  headSha: string;
  headBranch: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tasks: ActrunResultTask[];
}

export interface ActrunResultTask {
  id: string;
  status: string;
  code: number;
  stdoutPath?: string;
  stderrPath?: string;
}

type SafeExecFn = (cmd: string, args: string[]) => string;

interface ActrunRunnerOpts {
  workflow: string;
  job?: string;
  exec?: (cmd: string) => string;
  safeExec?: SafeExecFn;
}

function defaultSafeExec(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"] });
  return result.stdout ?? "";
}

export class ActrunRunner {
  private workflow: string;
  private job?: string;
  private safeExecFn: SafeExecFn;

  constructor(opts: ActrunRunnerOpts) {
    this.workflow = opts.workflow;
    this.job = opts.job;
    if (opts.safeExec) {
      this.safeExecFn = opts.safeExec;
    } else if (opts.exec) {
      // Wrap legacy exec for backward compatibility
      this.safeExecFn = (cmd, args) => opts.exec!(`${cmd} ${args.join(" ")}`);
    } else {
      this.safeExecFn = defaultSafeExec;
    }
  }

  run(): void {
    const args = ["workflow", "run", this.workflow];
    if (this.job) args.push("--job", this.job);
    this.safeExecFn("actrun", args);
  }

  retry(): void {
    const args = ["workflow", "run", this.workflow, "--retry"];
    if (this.job) args.push("--job", this.job);
    this.safeExecFn("actrun", args);
  }

  runWithResult(): ActrunResult {
    // Step 1: Execute workflow and capture run ID
    const runArgs = ["workflow", "run", this.workflow, "--json"];
    if (this.job) runArgs.push("--job", this.job);
    const runId = this.safeExecFn("actrun", runArgs).trim();

    // Step 2: Get full results (runId is validated as output of step 1)
    const viewJson = this.safeExecFn("actrun", ["run", "view", runId, "--json"]);
    const output: ActrunRunOutput = JSON.parse(viewJson);

    const startedAt = new Date(output.startedAt);
    const completedAt = new Date(output.completedAt);
    const durationMs = completedAt.getTime() - startedAt.getTime();

    return {
      runId: output.run_id,
      conclusion: output.conclusion,
      headSha: output.headSha,
      headBranch: output.headBranch,
      startedAt: output.startedAt,
      completedAt: output.completedAt,
      durationMs,
      tasks: output.tasks.map((t) => ({
        id: t.id,
        status: t.status,
        code: t.code,
        stdoutPath: t.stdout_path,
        stderrPath: t.stderr_path,
      })),
    };
  }
}
