import { execSync } from "node:child_process";

export class DirectRunner {
  private command: string;

  constructor(command: string) {
    this.command = command;
  }

  run(pattern: string): void {
    const fullCommand = `${this.command} --grep "${pattern}"`;
    execSync(fullCommand, { stdio: "inherit" });
  }
}
