#!/usr/bin/env node
import { Command } from "commander";

import * as account from "./commands/account.js";
import * as connection from "./commands/connection.js";
import * as cronjob from "./commands/cronjob.js";
import * as job from "./commands/job.js";
import * as key from "./commands/key.js";
import * as organization from "./commands/organization.js";
import * as profile from "./commands/profile.js";
import * as project from "./commands/project.js";
import * as resource from "./commands/resource.js";

const program = new Command();

program
  .name("solti")
  .description("Solti Platform CLI — schedule and run asynchronous workloads without managing infrastructure.")
  .version("0.1.4")
  .option("--profile <name>", "override the active profile (or set SOLTI_PROFILE)")
  .option("--api-key <key>", "override the API key (or set SOLTI_API_KEY)");

// Global override flags must take effect before any command resolves its
// credentials: every resolution path reads SOLTI_PROFILE / SOLTI_API_KEY from
// the environment (resolveCredentials, profile stores), so map the explicit
// flags onto the env vars here. Explicit flags win over a pre-set env var —
// they are the more specific user intent.
program.hook("preAction", (thisCommand: Command) => {
  const globalOptions = thisCommand.opts() as { profile?: string; apiKey?: string };
  if (globalOptions.profile) process.env.SOLTI_PROFILE = globalOptions.profile;
  if (globalOptions.apiKey) process.env.SOLTI_API_KEY = globalOptions.apiKey;
});

function fail(error: unknown): never {
  console.error(`error: ${(error as Error).message}`);
  process.exit(1);
}

/** Commander collector for repeatable valued options: each occurrence appends
 * (plain non-collect options overwrite — last value wins). Comma-separated
 * values stay joined here; commands split them via parseStringList. */
function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

// --- account ----------------------------------------------------------------

const accountCommand = program.command("account").description("Manage logged-in accounts");

accountCommand
  .command("login")
  .description("Log in via your browser (LogTo OAuth)")
  .option("--no-launch-browser", "print the sign-in URL instead of opening a browser")
  .action(async (_args, command) => {
    const { launchBrowser } = command.opts() as { launchBrowser?: boolean };
    await account.accountLogin({ launchBrowser }).catch(fail);
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

// --- organization -----------------------------------------------------------

const orgCommand = program
	.command("organization")
	.description("Manage organizations (requires OAuth login)");

orgCommand
	.command("list")
	.description("List organizations you belong to")
	.action(async () => {
		await organization.organizationList().catch(fail);
	});

orgCommand
	.command("create <name>")
	.description("Create an organization (you become its owner)")
	.action(async (name: string) => {
		await organization.organizationCreate(name).catch(fail);
	});

orgCommand
	.command("show <org_id_or_name>")
	.description("Show organization details, including members")
	.action(async (orgIdOrName: string) => {
		await organization.organizationShow(orgIdOrName).catch(fail);
	});

orgCommand
	.command("delete <org_id_or_name>")
	.description("Delete an organization (owner only)")
	.option("--yes", "skip the confirmation prompt")
	.action(async (orgIdOrName: string, options: { yes?: boolean }) => {
		await organization.organizationDelete(orgIdOrName, options).catch(fail);
	});

// --- project ----------------------------------------------------------------

const projectCommand = program
	.command("project")
	.description("Manage projects (requires OAuth login)");

projectCommand
	.command("list")
	.description("List projects (across your organizations, or --org to filter)")
	.option("--org <org_id_or_name>", "filter by organization")
	.action(async (options: { org?: string }) => {
		await project.projectList(options).catch(fail);
	});

projectCommand
	.command("create <name>")
	.description("Create a project in an organization")
	.requiredOption("--org <org_id_or_name>", "target organization")
	.action(async (name: string, options: { org: string }) => {
		await project.projectCreate(name, options).catch(fail);
	});

projectCommand
	.command("show <project_id>")
	.description("Show project details")
	.action(async (projectId: string) => {
		await project.projectShow(projectId).catch(fail);
	});

projectCommand
	.command("use <project_id>")
	.description("Set the active project of the current profile")
	.action(async (projectId: string) => {
		await project.projectUse(projectId).catch(fail);
	});

projectCommand
	.command("delete <project_id>")
	.description("Delete a project (org owner only)")
	.option("--yes", "skip the confirmation prompt")
	.action(async (projectId: string, options: { yes?: boolean }) => {
		await project.projectDelete(projectId, options).catch(fail);
	});

// --- resource ---------------------------------------------------------------

program
	.command("resource")
	.description("Discover cloud resources of the active project")
	.command("list")
	.option("--type <type>", "storages | repositories | vm-pools")
	.option("--connection <name>", "filter by connection name")
	.description("List discovered resources")
	.action(async (options: { type?: string; connection?: string }) => {
		await resource.resourceList(options).catch(fail);
	});

// --- job --------------------------------------------------------------------

const jobCommand = program.command("job").description("Manage workloads");

jobCommand
	.command("run")
	.description("Submit a workload (-f workload.yaml, or --image with a command)")
	.option("-f, --file <path>", "declarative workload YAML/JSON file")
	.option("--image <image>", "container image")
	.option("--command <cmd...>", "container command override")
	.option("--args <args...>", "container command arguments")
	.option("--name <name>", "explicit job name")
	.option("--name-prefix <prefix>", "prefix for auto-generated names")
	.option("--max-retries <n>", "maximum container retries")
	.option("--env <key=value>", "environment variable (repeatable)")
	.option("--env-from-file <path>", "load KEY=VALUE lines from a .env file (explicit --env flags win)")
	.option("--volume <spec>", "storage volume mount: <bucket>[/<prefix>]:<mountPath> or bucket=<b>,mountPath=<p>[,connection=...][,prefix=...] (repeatable)")
	.option("--volume-name <name>", "explicit volume name (map key) for --volume")
	.option("--resources <spec>", "e.g. cpu=4,memory=16Gi,gpu=24Gi or gpu.model=A100,gpu.count=2")
	.option("--label <key=value>", "label (repeatable)")
	.option("--tag <tag>", "tag (repeatable)")
	.option("--cloud <provider>", "cloud constraint (aws | gcp | azure; repeatable or comma-separated)", collectValues, [])
	.option("--region <region>", "region constraint (repeatable or comma-separated)", collectValues, [])
	.allowUnknownOption(true)
	.argument("[operands...]", "positional command and args (after --)")
	.action(async (_operands, options, command) => {
		const positional = (command.args ?? []).filter((a: string) => a !== "--");
		await job.jobRun({ ...options, positional }).catch(fail);
	});

jobCommand
	.command("list")
	.description("List recent workloads")
	.option("--tag <tag>", "filter by tag (repeatable)")
	.option("--label <key:value>", "filter by label (repeatable; key=value accepted)")
	.action(async (options: { tag?: string[]; label?: string[] }) => {
		await job.jobList(options).catch(fail);
	});

jobCommand
	.command("status <job_id_or_name>")
	.description("Show detailed status of a workload (--watch streams until a terminal state)")
	.option("--watch", "poll and stream status until the job reaches a terminal state")
	.action(async (jobIdOrName: string, options: { watch?: boolean }) => {
		await job.jobStatus(jobIdOrName, { watch: options.watch }).catch(fail);
	});

jobCommand
	.command("cancel <job_id_or_name>")
	.description("Cancel a workload")
	.action(async (jobIdOrName: string) => {
		await job.jobCancel(jobIdOrName).catch(fail);
	});

// --- cronjob ----------------------------------------------------------------

const cronjobCommand = program
	.command("cronjob")
	.description("Manage cron-based schedulers (schedules evaluated in UTC)");

cronjobCommand
	.command("list")
	.description("List cronjobs")
	.action(async () => {
		await cronjob.cronjobList().catch(fail);
	});

cronjobCommand
	.command("show <id_or_name>")
	.description("Show cronjob details")
	.action(async (idOrName: string) => {
		await cronjob.cronjobShow(idOrName).catch(fail);
	});

cronjobCommand
	.command("create")
	.description("Create a cronjob (--image form, or --file with a workload YAML/JSON template)")
	.requiredOption("--name <name>", "cronjob name")
	.requiredOption("--schedule <cron>", "UTC crontab expression")
	.option("--file <path>", "workload YAML/JSON file to use as the job definition template")
	.option("--image <image>", "container image (inline form; required without --file)")
	.option("--command <cmd>", "container command (space-separated)")
	.option("--args <args>", "container arguments (space-separated)")
	.option("--active <true|false>", "start active (default true)")
	.action(async (options) => {
		await cronjob.cronjobCreate(options).catch(fail);
	});

cronjobCommand
	.command("update <id_or_name>")
	.description("Update a cronjob without recreating it")
	.option("--schedule <cron>", "new UTC crontab expression")
	.option("--active <true|false>", "toggle active state")
	.option("--image <image>", "new container image")
	.action(async (idOrName: string, options) => {
		await cronjob.cronjobUpdate(idOrName, options).catch(fail);
	});

cronjobCommand
	.command("delete <id_or_name>")
	.description("Delete a cronjob")
	.action(async (idOrName: string) => {
		await cronjob.cronjobDelete(idOrName).catch(fail);
	});

// --- connection -------------------------------------------------------------

const connectionCommand = program
	.command("connection")
	.description("Manage cloud credential connections (admin only)");

connectionCommand
	.command("list")
	.description("List connections")
	.action(async () => {
		await connection.connectionList().catch(fail);
	});

connectionCommand
	.command("get <name>")
	.description("Show connection details (credentials redacted)")
	.action(async (name: string) => {
		await connection.connectionGet(name).catch(fail);
	});

connectionCommand
	.command("create")
	.description("Create a cloud connection")
	.requiredOption("--name <name>", "connection name")
	.requiredOption("--type <type>", "aws | gcp | azure | r2 | github")
	.option("--access-key <key>", "access key id (aws) / client id (azure)")
	.option("--secret-key <key>", "secret access key (aws) / client secret (azure)")
	.option("--keyfile <path>", "GCP service-account keyfile (gcp)")
	.option("--project-id <id>", "GCP project id (gcp) / Azure subscription id (azure)")
	.option("--tenant-id <id>", "Azure tenant id")
	.option("--account <id>", "Cloudflare account id (r2)")
	.option("--token <token>", "GitHub personal access token (github)")
	.action(async (options) => {
		await connection.connectionCreate(options).catch(fail);
	});

connectionCommand
	.command("delete <name>")
	.description("Delete a connection")
	.action(async (name: string) => {
		await connection.connectionDelete(name).catch(fail);
	});

// --- key --------------------------------------------------------------------

const keyCommand = program.command("key").description("Manage API keys (admin only)");

keyCommand
	.command("list")
	.description("List API keys")
	.action(async () => {
		await key.keyList().catch(fail);
	});

keyCommand
	.command("create")
	.description("Create an API key (the token is shown only once)")
	.requiredOption("--name <name>", "key name")
	.requiredOption("--role <role>", "admin | developer | viewer")
	.option("--expires-at <date>", "optional expiration (ISO date)")
	.action(async (options) => {
		await key.keyCreate(options).catch(fail);
	});

keyCommand
	.command("delete <id_or_name>")
	.description("Delete an API key")
	.action(async (idOrName: string) => {
		await key.keyDelete(idOrName).catch(fail);
	});

program.parseAsync(process.argv).catch(fail);
