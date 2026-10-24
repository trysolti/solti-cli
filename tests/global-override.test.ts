import { describe, expect, test } from "bun:test";

import { Command } from "commander";

// Mirrors the global override handling on the root program (src/index.ts):
// `--profile` / `--api-key` are mapped onto SOLTI_PROFILE / SOLTI_API_KEY in a
// preAction hook because every credential-resolution path reads those env vars
// (resolveCredentials, profile stores) — the flags are no-ops otherwise.
function makeProgramWithOverrides(): Command {
  const program = new Command()
    .option("--profile <name>", "override the active profile (or set SOLTI_PROFILE)")
    .option("--api-key <key>", "override the API key (or set SOLTI_API_KEY)");

  program.hook("preAction", (thisCommand: Command) => {
    const globalOptions = thisCommand.opts() as { profile?: string; apiKey?: string };
    if (globalOptions.profile) process.env.SOLTI_PROFILE = globalOptions.profile;
    if (globalOptions.apiKey) process.env.SOLTI_API_KEY = globalOptions.apiKey;
  });

  program.command("probe").action(() => {});
  return program;
}

describe("global --profile / --api-key overrides", () => {
  test("--profile maps onto SOLTI_PROFILE before the action runs", () => {
    delete process.env.SOLTI_PROFILE;
    const program = makeProgramWithOverrides();
    let seen: string | undefined;
    program.command("capture").action(() => {
      seen = process.env.SOLTI_PROFILE;
    });
    program.parse(["node", "solti", "--profile", "syspreview", "capture"], { from: "node" });
    expect(seen).toBe("syspreview");
  });

  test("--api-key maps onto SOLTI_API_KEY before the action runs", () => {
    delete process.env.SOLTI_API_KEY;
    const program = makeProgramWithOverrides();
    let seen: string | undefined;
    program.command("capture").action(() => {
      seen = process.env.SOLTI_API_KEY;
    });
    program.parse(["node", "solti", "--api-key", "k-test", "capture"], { from: "node" });
    expect(seen).toBe("k-test");
  });

  test("flags are absent from env when not provided", () => {
    delete process.env.SOLTI_PROFILE;
    delete process.env.SOLTI_API_KEY;
    const program = makeProgramWithOverrides();
    let profile: string | undefined;
    let apiKey: string | undefined;
    program.command("capture").action(() => {
      profile = process.env.SOLTI_PROFILE;
      apiKey = process.env.SOLTI_API_KEY;
    });
    program.parse(["node", "solti", "capture"], { from: "node" });
    expect(profile).toBeUndefined();
    expect(apiKey).toBeUndefined();
  });
});
