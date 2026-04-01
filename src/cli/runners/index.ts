import type { RunnerAdapter } from "./types.js";
import { VitestRunner } from "./vitest.js";
import { PlaywrightRunner } from "./playwright.js";
import { MoonTestRunner } from "./moontest.js";
import { CustomRunner } from "./custom-runner.js";

export function createRunner(config: {
  type: string;
  command?: string;
  execute?: string;
  list?: string;
}): RunnerAdapter {
  switch (config.type) {
    case "vitest":
      return new VitestRunner({ command: config.command });
    case "playwright":
      return new PlaywrightRunner({ command: config.command });
    case "moontest":
      return new MoonTestRunner({ command: config.command });
    case "custom":
      if (!config.execute || !config.list)
        throw new Error(
          "Custom runner requires 'execute' and 'list' commands",
        );
      return new CustomRunner({ execute: config.execute, list: config.list });
    default:
      throw new Error(`Unknown runner type: ${config.type}`);
  }
}

export type {
  RunnerAdapter,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
