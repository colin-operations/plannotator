import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSessionBrowserOpener, openBrowserForSession } from "./session-browser";

const originalBrowser = process.env.PLANNOTATOR_SESSION_BROWSER;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalBrowser === undefined) delete process.env.PLANNOTATOR_SESSION_BROWSER;
  else process.env.PLANNOTATOR_SESSION_BROWSER = originalBrowser;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("openBrowserForSession", () => {
  test("passes the session only through the opener environment", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "plannotator-session-browser-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "invocation.json");
    const opener = path.join(directory, "opener.sh");
    writeFileSync(opener, `#!/bin/sh\nprintf '{"session":"%s","url":"%s","argc":%s}' "$PLANNOTATOR_SESSION_ID" "$1" "$#" > "${output}"\n`);
    chmodSync(opener, 0o700);
    process.env.PLANNOTATOR_SESSION_BROWSER = opener;

    await expect(openBrowserForSession("http://localhost:23148", "session-123")).resolves.toBe(true);
    expect(JSON.parse(readFileSync(output, "utf-8"))).toEqual({
      session: "session-123",
      url: "http://localhost:23148",
      argc: 1,
    });
  });

  test("declines routing without both a configured opener and session", async () => {
    delete process.env.PLANNOTATOR_SESSION_BROWSER;
    await expect(openBrowserForSession("http://localhost:23148", "session-123")).resolves.toBe(false);
    process.env.PLANNOTATOR_SESSION_BROWSER = "/unused";
    expect(createSessionBrowserOpener(undefined)).toBeFunction();
    await expect(openBrowserForSession("http://localhost:23148", undefined)).resolves.toBe(false);
  });

  test("kills a session browser that exceeds its deadline", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "plannotator-session-browser-timeout-"));
    temporaryDirectories.push(directory);
    const completed = path.join(directory, "completed");
    const opener = path.join(directory, "slow-opener.sh");
    writeFileSync(opener, `#!/bin/sh\nsleep 5\nprintf done > "${completed}"\n`);
    chmodSync(opener, 0o700);
    process.env.PLANNOTATOR_SESSION_BROWSER = opener;

    const startedAt = Date.now();
    await expect(openBrowserForSession("http://localhost:23148", "session-123", 25)).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(() => readFileSync(completed, "utf-8")).toThrow();
  });
});
