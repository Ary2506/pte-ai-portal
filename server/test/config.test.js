import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import path from "path";
import { pathToFileURL } from "url";

const configUrl = pathToFileURL(path.resolve("src/config.js")).href;

function runWithSecret(secretEnv) {
  return execFileSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(configUrl)})`], {
    env: { ...process.env, ...secretEnv },
    stdio: "pipe"
  });
}

describe("JWT secret is not hardcoded", () => {
  it("fails to start when JWT_SECRET is missing", () => {
    expect(() => runWithSecret({ JWT_SECRET: "" })).toThrow();
  });

  it("fails to start when JWT_SECRET is too short", () => {
    expect(() => runWithSecret({ JWT_SECRET: "short" })).toThrow();
  });

  it("starts when a strong JWT_SECRET is provided", () => {
    expect(() => runWithSecret({ JWT_SECRET: "a".repeat(48) })).not.toThrow();
  });
});
