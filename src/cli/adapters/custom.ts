import { execSync } from "node:child_process";
import type { TestCaseResult, TestResultAdapter } from "./types.js";

interface CustomAdapterOpts {
  command: string;
  exec?: (cmd: string, stdin: string) => string;
}

export class CustomAdapter implements TestResultAdapter {
  name = "custom";
  private command: string;
  private execFn: (cmd: string, stdin: string) => string;

  constructor(opts: CustomAdapterOpts) {
    this.command = opts.command;
    this.execFn = opts.exec ?? ((cmd, stdin) =>
      execSync(cmd, { input: stdin, encoding: "utf-8" })
    );
  }

  parse(input: string): TestCaseResult[] {
    const output = this.execFn(this.command, input);
    return JSON.parse(output) as TestCaseResult[];
  }
}
