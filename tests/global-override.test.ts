import { describe, expect, test } from "bun:test";

import { Command } from "commander";

// Mirrors the global override handling on the root program (src/index.ts):
// `--profile` / `--api-key` are mapped onto SOLTI_PROFILE / SOLTI_API_KEY in a
// preAction hook because every credential-resolution path reads those env vars
// (resolveCredentials, profile stores) — the flags are no-ops otherwise.
// The root enables positional options and the hook reads the ROOT opts: with
// positional options enabled, a subcommand-local --api-key (`profile set`,
// change 073 item 20) is stored on the subcommand instead of being swallowed
// by the root, and flags before the subcommand are only ever stored at the
// root.
function makeProgramWithOverrides(): Command {
  const program = new Command()
    .option("--profile <name>", "override the active profile (or set SOLTI_PROFILE)")
    .option("--api-key <key>", "override the API key (or set SOLTI_API_KEY)")
    .enablePositionalOptions();

  program.hook("preAction", () => {
    const globalOptions = program.opts() as { profile?: string; apiKey?: string };
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

  test("subcommand-local --api-key reaches the action and stays out of the root opts", () => {
    delete process.env.SOLTI_API_KEY;
    const program = makeProgramWithOverrides();
    const profileSet = program
      .command("set <profile_name>")
      .requiredOption("--project-id <id>", "the project UUID")
      .option("--api-key <key>", "the Solti API key (Zitadel PAT)");
    let actionOptions: Record<string, unknown> | undefined;
    profileSet.action(function () {
      actionOptions = this.opts();
    });
    program.parse(
      ["node", "solti", "set", "prod", "--project-id", "u", "--api-key", "LOCAL"],
      { from: "node" },
    );
    expect(actionOptions?.apiKey).toBe("LOCAL");
    // The root opts must stay clean: otherwise the preAction hook would map a
    // profile-scoped key onto SOLTI_API_KEY and the action would persist null.
    expect(program.opts().apiKey).toBeUndefined();
    expect(process.env.SOLTI_API_KEY).toBeUndefined();
  });

  test("before-subcommand --api-key is global; after-subcommand occurrence is local", () => {
    delete process.env.SOLTI_API_KEY;
    const program = makeProgramWithOverrides();
    const profileSet = program
      .command("set <profile_name>")
      .requiredOption("--project-id <id>", "the project UUID")
      .option("--api-key <key>", "the Solti API key (Zitadel PAT)");
    let actionOptions: Record<string, unknown> | undefined;
    profileSet.action(function () {
      actionOptions = this.opts();
    });
    program.parse(
      ["node", "solti", "--api-key", "GLOBAL", "set", "prod", "--project-id", "u", "--api-key", "LOCAL"],
      { from: "node" },
    );
    // Local occurrence wins for the action (persisted value)…
    expect(actionOptions?.apiKey).toBe("LOCAL");
    // …global occurrence stays at the root (mapped onto SOLTI_API_KEY).
    expect(program.opts().apiKey).toBe("GLOBAL");
    expect(process.env.SOLTI_API_KEY).toBe("GLOBAL");
  });
});
