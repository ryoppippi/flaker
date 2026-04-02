import { describe, expect, it } from "vitest";
import {
  MOONBIT_JS_BRIDGE_URL,
  resolveMoonBitJsBridgeUrl,
} from "../../src/cli/core/build-artifact.js";

describe("resolveMoonBitJsBridgeUrl", () => {
  it("prefers the packaged MoonBit bridge when dist is installed", () => {
    const url = resolveMoonBitJsBridgeUrl(
      "file:///workspace/node_modules/@mizchi/flaker/dist/cli/main.js",
      (candidate) => candidate.pathname.endsWith("/dist/moonbit/flaker.js"),
    );

    expect(url.pathname).toBe(
      "/workspace/node_modules/@mizchi/flaker/dist/moonbit/flaker.js",
    );
  });

  it("falls back to the repo debug build artifact during source development", () => {
    const url = resolveMoonBitJsBridgeUrl(
      "file:///workspace/src/cli/core/build-artifact.js",
      (candidate) =>
        candidate.pathname.endsWith("/_build/js/debug/build/cmd/flaker/flaker.js"),
    );

    expect(url.pathname).toBe(
      "/workspace/_build/js/debug/build/cmd/flaker/flaker.js",
    );
  });
});

describe("MOONBIT_JS_BRIDGE_URL", () => {
  it("points to either a packaged bridge or a repo build artifact", () => {
    expect(MOONBIT_JS_BRIDGE_URL.pathname).toMatch(
      /\/(?:dist\/moonbit|_build\/js\/(?:debug|release)\/build\/cmd\/flaker)\/flaker\.js$/,
    );
  });
});
