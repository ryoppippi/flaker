import { spawnSync } from "node:child_process";

export class DirectRunner {
  private command: string;

  constructor(command: string) {
    this.command = command;
  }

  run(pattern: string): void {
    const parts = this.command.split(/\s+/).filter(Boolean);
    const cmd = parts[0];
    const args = [...parts.slice(1), "--grep", pattern];
    spawnSync(cmd, args, { stdio: "inherit" });
  }
}
