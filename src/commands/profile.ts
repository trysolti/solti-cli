import {
  deleteProfile,
  getActiveAccount,
  listProfiles,
  readActive,
  readProfile,
  writeActive,
  writeProfile,
} from "../config/store.js";

async function requireAccount(): Promise<string> {
  const account = await getActiveAccount();
  if (account === null) {
    console.error(
      "No logged-in account. Profiles live under accounts — run `solti account login` first, or use SOLTI_API_KEY + SOLTI_PROJECT_ID for headless usage.",
    );
    process.exit(1);
  }
  return account;
}

export async function profileList(): Promise<void> {
  const account = await requireAccount();
  const profiles = await listProfiles(account);
  const active = (await readActive()).active_profile;
  if (profiles.length === 0) {
    console.log("No profiles. Create one with `solti profile set <name> --project-id <id>`.");
    return;
  }
  for (const profile of profiles) {
    const config = await readProfile(account, profile);
    const marker = profile === active ? "*" : " ";
    console.log(`${marker} ${profile}  (project: ${config?.project_id ?? "?"})`);
  }
}

export async function profileSet(
  profileName: string,
  options: { projectId?: string; apiKey?: string; apiUrl?: string },
): Promise<void> {
  const account = await requireAccount();
  if (options.projectId === undefined || options.projectId === "") {
    console.error("--project-id is required.");
    process.exitCode = 1;
    return;
  }
  await writeProfile(account, profileName, {
    project_id: options.projectId,
    api_key: options.apiKey ?? null,
    api_url: options.apiUrl ?? null,
  });
  const active = await readActive();
  if (active.active_profile === undefined || active.active_profile === null) {
    await writeActive({ ...active, active_profile: profileName });
  }
  console.log(`Profile ${profileName} saved (project: ${options.projectId}).`);
}

export async function profileUse(profileName: string): Promise<void> {
  const account = await requireAccount();
  const config = await readProfile(account, profileName);
  if (config === null) {
    console.error(`Profile ${profileName} not found. Create it with \`solti profile set ${profileName} --project-id <id>\`.`);
    process.exitCode = 1;
    return;
  }
  const active = await readActive();
  await writeActive({ ...active, active_profile: profileName });
  // Shell integration: the printed export can be eval'd to sync the session.
  console.log(`export SOLTI_PROFILE=${profileName}`);
}

export async function profileShow(profileName?: string): Promise<void> {
  const account = await requireAccount();
  const name = profileName ?? (await readActive()).active_profile;
  if (name === null || name === undefined) {
    console.error("No active profile. Pass a profile name or run `solti profile use <name>`.");
    process.exitCode = 1;
    return;
  }
  const config = await readProfile(account, name);
  if (config === null) {
    console.error(`Profile ${name} not found.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Profile:    ${name}`);
  console.log(`Account:    ${account}`);
  console.log(`Project ID: ${config.project_id}`);
  console.log(`API Key:    ${config.api_key ? `${config.api_key.slice(0, 8)}…${config.api_key.slice(-4)}` : "(OAuth — uses the account's stored tokens)"}`);
  console.log(`API URL:    ${config.api_url ?? "(default)"}`);
}

export async function profileDelete(profileName: string): Promise<void> {
  const account = await requireAccount();
  await deleteProfile(account, profileName);
  const active = await readActive();
  if (active.active_profile === profileName) {
    await writeActive({ ...active, active_profile: undefined });
  }
  console.log(`Profile ${profileName} deleted.`);
}
