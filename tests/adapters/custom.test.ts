import { describe, it, expect } from "vitest";
import { CustomAdapter } from "../../src/cli/adapters/custom.js";
import type { TestCaseResult } from "../../src/cli/adapters/types.js";

describe("CustomAdapter", () => {
  it("passes input to command and parses JSON output", () => {
    const mockResults: TestCaseResult[] = [
      { suite: "s1", testName: "t1", status: "passed", durationMs: 100, retryCount: 0 },
      { suite: "s1", testName: "t2", status: "failed", durationMs: 200, retryCount: 1, errorMessage: "err" },
    ];
    const adapter = new CustomAdapter({
      command: "my-parser",
      exec: (cmd, stdin) => {
        expect(cmd).toBe("my-parser");
        expect(stdin).toBe("raw input data");
        return JSON.stringify(mockResults);
      },
    });

    const results = adapter.parse("raw input data");
    expect(results).toEqual(mockResults);
  });

  it("returns empty array on empty JSON array output", () => {
    const adapter = new CustomAdapter({
      command: "empty-parser",
      exec: () => "[]",
    });

    const results = adapter.parse("anything");
    expect(results).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    const adapter = new CustomAdapter({
      command: "bad-parser",
      exec: () => "not json",
    });

    expect(() => adapter.parse("input")).toThrow();
  });
});
