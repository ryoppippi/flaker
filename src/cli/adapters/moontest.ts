import type { TestResultAdapter, TestCaseResult } from "./types.js";
import { parseMoonTestOutput } from "../runners/moontest.js";

export const moontestAdapter: TestResultAdapter = {
  name: "moontest",
  parse(input: string): TestCaseResult[] {
    return parseMoonTestOutput(input);
  },
};
