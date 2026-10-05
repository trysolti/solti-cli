import fs from "node:fs/promises";
import path from "node:path";

import {
  accountDir,
  accountsDir,
  activeStorePath,
  authFilePath,
  profileConfigPath,
  profilesDir,
} from "./paths.js";

export interface ActiveStore {
  active_account?: string;
  active_profile?: string;
}

export interface AuthStore {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO timestamp
  token_type: string; // "Bearer"
  email?: string;
}

export interface ProfileConfig {
  project_id: string;
  api_key?: string | null;
  api_url?: string | null;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", { mode });
}

// --- active store -----------------------------------------------------------

export async function readActive(): Promise<ActiveStore> {
  return (await readJson<ActiveStore>(activeStorePath)) ?? {};
}

export async function writeActive(store: ActiveStore): Promise<void> {
  await writeJson(activeStorePath, store);
}

export async function getActiveAccount(): Promise<string | null> {
  return (await readActive()).active_account ?? null;
}

export async function getActiveProfileName(): Promise<string | null> {
  return (await readActive()).active_profile ?? null;
}

// --- accounts ---------------------------------------------------------------

export async function listAccounts(): Promise<string[]> {
  try {
    const entries = await fs.readdir(accountsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function readAuth(email: string): Promise<AuthStore | null> {
  return readJson<AuthStore>(authFilePath(email));
}

export async function writeAuth(email: string, auth: AuthStore): Promise<void> {
  // Credentials are stored with owner-only permissions (0600).
  await writeJson(authFilePath(email), { ...auth, email }, 0o600);
}

export async function deleteAuth(email: string): Promise<void> {
  try {
    await fs.unlink(authFilePath(email));
  } catch {
    // already gone
  }
}

// --- profiles ---------------------------------------------------------------

export async function listProfiles(email: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(profilesDir(email), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function readProfile(email: string, profileName: string): Promise<ProfileConfig | null> {
  return readJson<ProfileConfig>(profileConfigPath(email, profileName));
}

export async function writeProfile(
  email: string,
  profileName: string,
  config: ProfileConfig,
): Promise<void> {
  await writeJson(profileConfigPath(email, profileName), config);
}

export async function deleteProfile(email: string, profileName: string): Promise<void> {
  try {
    await fs.rm(profileConfigPath(email, profileName).replace("/config.json", ""), {
      recursive: true,
      force: true,
    });
  } catch {
    // already gone
  }
}

/**
 * Resolves the active profile per spec §1.1: `SOLTI_PROFILE` env var wins,
 * then `active_profile` from active.json.
 */
export async function resolveActiveProfile(): Promise<{
  account: string;
  profileName: string;
  config: ProfileConfig;
} | null> {
  const account = await getActiveAccount();
  if (account === null) return null;

  const profileName = process.env.SOLTI_PROFILE ?? (await getActiveProfileName());
  if (profileName === null || profileName === undefined) return null;

  const config = await readProfile(account, profileName);
  if (config === null) return null;

  return { account, profileName, config };
}
