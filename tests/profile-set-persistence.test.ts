/**
 * Change 073 follow-up (item 20) — `solti profile set --api-key` persistence.
 *
 * Live bug: the root program declares a global `--api-key` option and
 * `profile set` declares its own; commander's root-level parse swallowed the
 * local occurrence, the action never saw the value, and the profile config
 * silently persisted `api_key: null`.
 *
 * Fix: root `.enablePositionalOptions()` + the preAction hook reading the
 * ROOT opts (`program.opts()`) instead of `thisCommand.opts()`.
 *
 * These tests run the real CLI (`src/index.ts`) in a subprocess with
 * SOLTI_HOME pointed at a temp dir (state isolation per src/config/paths.ts,
 * which reads SOLTI_HOME at module load).
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI_ENTRY = new URL("../src/index.ts", import.meta.url).pathname;
const ACCOUNT = "tester@solti.run"; // sanitizeEmail keeps it verbatim (paths.ts)

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], home: string): RunResult {
  // Drop credential-relevant vars so results don't depend on the host env;
  // SOLTI_HOME isolates all on-disk state (src/config/paths.ts).
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.SOLTI_API_KEY;
  delete env.SOLTI_PROFILE;
  delete env.SOLTI_API_URL;
  delete env.SOLTI_PROJECT_ID;
  env.SOLTI_HOME = home;
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    encoding: "utf8",
    env,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "solti-cli-profile-set-"));
}

function seedActiveAccount(home: string): void {
  // active.json layout: src/config/store.ts ActiveStore.
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, "active.json"),
    JSON.stringify({ active_account: ACCOUNT }, null, 2) + "\n",
  );
}

function readProfileConfig(home: string, profileName: string): Record<string, unknown> {
  const configPath = path.join(
    home,
    "accounts",
    ACCOUNT,
    "profiles",
    profileName,
    "config.json",
  );
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
}

describe("solti profile set --api-key / --api-url persistence", () => {
  test("persists api-key AND api-url (the silent-null repro)", () => {
    const home = makeHome();
    try {
      seedActiveAccount(home);
      const run = runCli(
        [
          "profile",
          "set",
          "prod",
          "--project-id",
          "proj-1",
          "--api-key",
          "sk-test-1234",
          "--api-url",
          "https://api.example.test",
        ],
        home,
      );
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const config = readProfileConfig(home, "prod");
      expect(config.api_key).toBe("sk-test-1234");
      expect(config.api_url).toBe("https://api.example.test");
      expect(config.project_id).toBe("proj-1");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test("persists api-key when only --api-key is given (api_url stays null)", () => {
    const home = makeHome();
    try {
      seedActiveAccount(home);
      const run = runCli(
        ["profile", "set", "only-key", "--project-id", "proj-2", "--api-key", "sk-local-key"],
        home,
      );
      expect(run.status).toBe(0);
      const config = readProfileConfig(home, "only-key");
      expect(config.api_key).toBe("sk-local-key");
      expect(config.api_url).toBeNull();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test("before-subcommand --api-key is the global override; after-subcommand is the local persisted value", () => {
    const home = makeHome();
    try {
      seedActiveAccount(home);
      const run = runCli(
        [
          "--api-key",
          "GLOBAL-KEY",
          "profile",
          "set",
          "mixed",
          "--project-id",
          "proj-3",
          "--api-key",
          "LOCAL-KEY",
        ],
        home,
      );
      expect(run.status).toBe(0);
      // The profile-scoped value is what gets persisted (action options)…
      expect(readProfileConfig(home, "mixed").api_key).toBe("LOCAL-KEY");
      // …and the pre-subcommand occurrence reached the action's global
      // override path (headless credential resolution kicks in): `job list`
      // fails with the missing-project error, not the no-credentials error.
      const probe = runCli(["--api-key", "GLOBAL-KEY", "job", "list"], home);
      expect(probe.stderr).toContain("No active project");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("global --api-key override via preAction (end-to-end)", () => {
  test("solti --api-key X <cmd> resolves headless credentials via SOLTI_API_KEY", () => {
    const home = makeHome();
    try {
      // Empty home: no account, no profiles — headless env auth is the only
      // path. If preAction set SOLTI_API_KEY, credential resolution succeeds
      // and `job list` fails later for the missing project id.
      const withKey = runCli(["--api-key", "k-probe", "job", "list"], home);
      expect(withKey.stderr).toContain("No active project");

      // Control: without the flag nothing resolves.
      const withoutKey = runCli(["job", "list"], home);
      expect(withoutKey.stderr).toContain("No credentials found");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
