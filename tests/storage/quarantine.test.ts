import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("Quarantine Storage", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("adds a test to quarantine", async () => {
    await store.addQuarantine("suite-a", "test-1", "flaky");
    const all = await store.queryQuarantined();
    expect(all).toHaveLength(1);
    expect(all[0].suite).toBe("suite-a");
    expect(all[0].testName).toBe("test-1");
    expect(all[0].reason).toBe("flaky");
    expect(all[0].createdAt).toBeInstanceOf(Date);
  });

  it("removes a test from quarantine", async () => {
    await store.addQuarantine("suite-a", "test-1", "flaky");
    await store.removeQuarantine("suite-a", "test-1");
    const all = await store.queryQuarantined();
    expect(all).toHaveLength(0);
  });

  it("checks if a test is quarantined", async () => {
    await store.addQuarantine("suite-a", "test-1", "flaky");
    expect(await store.isQuarantined("suite-a", "test-1")).toBe(true);
    expect(await store.isQuarantined("suite-a", "test-2")).toBe(false);
  });

  it("does not duplicate entries (ON CONFLICT updates reason)", async () => {
    await store.addQuarantine("suite-a", "test-1", "flaky");
    await store.addQuarantine("suite-a", "test-1", "manual");
    const all = await store.queryQuarantined();
    expect(all).toHaveLength(1);
    expect(all[0].reason).toBe("manual");
  });
});
