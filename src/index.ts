#!/usr/bin/env node
import { Command } from "commander";

import * as account from "./commands/account.js";
import * as profile from "./commands/profile.js";

const program = new Command();

program
  .name("solti")
  .description("Solti Platform CLI — schedule and run asynchronous workloads without managing infrastructure.")
  .version("0.1.0")
  .option("--profile <name>", "override the active profile (or set SOLTI_PROFILE)")
  .option("--api-key <key>", "override the API key (or set SOLTI_API_KEY)");

function fail(error: unknown): never {
  console.error(`error: ${(error as Error).message}`);
  process.exit(1);
}

// --- account ----------------------------------------------------------------

const accountCommand = program.command("account").description("Manage logged-in accounts");

accountCommand
  .command("login")
  .description("Log in via your browser (LogTo OAuth)")
  .action(async () => {
    await account.accountLogin().catch(fail);
  });

accountCommand
  .command("logout")
  .description("Log out the active account")
  .action(async () => {
    await account.accountLogout().catch(fail);
  });

accountCommand
  .command("list")
  .description("List locally logged-in accounts")
  .action(async () => {
    await account.accountList().catch(fail);
  });

accountCommand
  .command("switch <email>")
  .description("Switch the active account")
  .action(async (email: string) => {
    await account.accountSwitch(email).catch(fail);
  });

accountCommand
  .command("show [email]")
  .description("Show account information (defaults to the active account)")
  .action(async (email?: string) => {
    await account.accountShow(email).catch(fail);
  });

// --- profile ----------------------------------------------------------------

const profileCommand = program
  .command("profile")
  .description("Manage project profiles of the active account");

profileCommand
  .command("list")
  .description("List profiles of the active account")
  .action(async () => {
    await profile.profileList().catch(fail);
  });

profileCommand
  .command("set <profile_name>")
  .description("Create or update a profile")
  .requiredOption("--project-id <id>", "the project UUID")
  .option("--api-key <key>", "the Solti API key (Zitadel PAT); omit to use OAuth tokens")
  .option("--api-url <url>", "custom base API URL override")
  .action(async (profileName: string, options: { projectId: string; apiKey?: string; apiUrl?: string }) => {
    await profile.profileSet(profileName, options).catch(fail);
  });

profileCommand
  .command("use <profile_name>")
  .description("Switch the active profile (prints `export SOLTI_PROFILE=...` for eval)")
  .action(async (profileName: string) => {
    await profile.profileUse(profileName).catch(fail);
  });

profileCommand
  .command("show [profile_name]")
  .description("Show profile details (API key is redacted)")
  .action(async (profileName?: string) => {
    await profile.profileShow(profileName).catch(fail);
  });

profileCommand
  .command("delete <profile_name>")
  .description("Delete a profile")
  .action(async (profileName: string) => {
    await profile.profileDelete(profileName).catch(fail);
  });

program.parseAsync(process.argv).catch(fail);
