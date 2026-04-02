import { existsSync } from "node:fs";

const PACKAGE_BRIDGE_CANDIDATES = [
  "../moonbit/flaker.js",
  "../../moonbit/flaker.js",
];

const REPO_BRIDGE_CANDIDATES = [
  "../../../_build/js/release/build/cmd/flaker/flaker.js",
  "../../../_build/js/debug/build/cmd/flaker/flaker.js",
];

export function resolveMoonBitJsBridgeUrl(
  baseUrl: string | URL = import.meta.url,
  exists: (url: URL) => boolean = (candidate) => existsSync(candidate),
): URL {
  const normalizedBaseUrl = typeof baseUrl === "string" ? new URL(baseUrl) : baseUrl;
  const candidates = [
    ...PACKAGE_BRIDGE_CANDIDATES,
    ...REPO_BRIDGE_CANDIDATES,
  ].map((relativePath) => new URL(relativePath, normalizedBaseUrl));

  return candidates.find((candidate) => exists(candidate)) ?? candidates[0];
}

export const MOONBIT_JS_BRIDGE_URL = resolveMoonBitJsBridgeUrl();
