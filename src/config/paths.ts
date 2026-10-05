import os from "node:os";
import path from "node:path";

/** Root of the local Solti CLI state (overridable for tests). */
export const SOLTI_HOME = process.env.SOLTI_HOME ?? path.join(os.homedir(), ".solti");

export const activeStorePath = path.join(SOLTI_HOME, "active.json");
export const accountsDir = path.join(SOLTI_HOME, "accounts");

/** Emails are used as directory names; sanitize path-hostile characters. */
export function sanitizeEmail(email: string): string {
  return email.replace(/[^A-Za-z0-9._@+-]/g, "_");
}

export function accountDir(email: string): string {
  return path.join(accountsDir, sanitizeEmail(email));
}

export function authFilePath(email: string): string {
  return path.join(accountDir(email), "auth.json");
}

export function profilesDir(email: string): string {
  return path.join(accountDir(email), "profiles");
}

export function profileDir(email: string, profileName: string): string {
  return path.join(profilesDir(email), sanitizeEmail(profileName));
}

export function profileConfigPath(email: string, profileName: string): string {
  return path.join(profileDir(email, profileName), "config.json");
}
