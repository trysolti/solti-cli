/**
 * Solti API client — credential resolution (spec §1.1) + endpoint resolution.
 *
 * 1. `--api-key` flag / `SOLTI_API_KEY` (+ `SOLTI_PROJECT_ID`) env vars → API Key auth
 * 2. Active profile with `api_key` set → API Key auth
 * 3. Active account OAuth tokens → Bearer auth (auto-refresh)
 */

import { getActiveAccount, readActive, readAuth, readProfile } from "../config/store.js";
import { ensureFreshAccessToken } from "../auth/oauth.js";

export const GLOBAL_API_URL =
  process.env.SOLTI_API_URL_GLOBAL ?? "https://api.solti.run/1";

export interface Credentials {
  kind: "oauth" | "api_key";
  apiKey?: string;
  projectId?: string;
  account?: string;
}

export interface ResolvedTarget {
  credentials: Credentials | null;
  /** Profile name that provided the project binding, if any. */
  profileName?: string;
}

/**
 * Resolves credentials per spec §1.1. `apiKeyOverride` corresponds to the
 * global `--api-key` flag (highest priority, together with SOLTI_PROJECT_ID).
 */
export async function resolveCredentials(apiKeyOverride?: string): Promise<ResolvedTarget> {
  // 1. Explicit flag / environment variables (headless path — no local files).
  const apiKey = apiKeyOverride ?? process.env.SOLTI_API_KEY;
  if (apiKey !== undefined && apiKey !== "") {
    const projectId = process.env.SOLTI_PROJECT_ID;
    return {
      credentials: { kind: "api_key", apiKey, projectId },
    };
  }

  // 2. Active profile with an api_key set.
  const account = await getActiveAccount();
  if (account !== null) {
    const active = await readActive();
    const profileName = process.env.SOLTI_PROFILE ?? active.active_profile;
    if (profileName !== null && profileName !== undefined) {
      const config = await readProfile(account, profileName);
      if (config !== null && config.api_key !== null && config.api_key !== undefined) {
        return {
          credentials: {
            kind: "api_key",
            apiKey: config.api_key,
            projectId: config.project_id,
          },
          profileName,
        };
      }
    }
  }

  // 3. Active account OAuth tokens (+ project binding from the active profile).
  if (account !== null && (await readAuth(account)) !== null) {
    const active = await readActive();
    const profileName = process.env.SOLTI_PROFILE ?? active.active_profile;
    let profileProjectId: string | undefined;
    if (profileName !== null && profileName !== undefined) {
      const config = await readProfile(account, profileName);
      profileProjectId = config?.project_id;
    }
    const projectId = process.env.SOLTI_PROJECT_ID ?? profileProjectId;
    return { credentials: { kind: "oauth", account, projectId } };
  }

  return { credentials: null };
}

export function projectBaseUrl(credentials: Credentials, apiUrlOverride?: string | null): string | null {
  const projectId = credentials.projectId;
  if (projectId === undefined || projectId === "") return null;
  // Precedence: explicit profile override > SOLTI_API_URL env var > global default.
  const override = apiUrlOverride ?? process.env.SOLTI_API_URL;
  if (override !== undefined && override !== null && override !== "") {
    return `${override.replace(/\/$/, "")}/1`;
  }
  // Change 033 D-1: per-project wildcard hosts (<projectId>.api.solti.run) are
  // not deployed; project-scoped requests go to the shared host and are scoped
  // by the X-Solti-Project-Id header (sent in request() below).
  return GLOBAL_API_URL;
}

/** Returns the active profile's `api_url` override, if set. */
/** Returns the api-url override for the current invocation.
 *
 * Headless env auth (SOLTI_API_KEY set without an explicit SOLTI_PROFILE)
 * bypasses local profile config entirely: otherwise the active profile's
 * `api_url` silently hijacks SOLTI_API_URL and headless requests are routed
 * to the wrong host (observed 2026-10-24 — headless preview requests were
 * served by the live API because the active syslive profile pointed there).
 * With SOLTI_PROFILE set explicitly, that profile's `api_url` wins over the
 * env var (documented precedence); without a profile override, the env var
 * applies. */
export async function resolveApiUrlOverride(): Promise<string | null> {
  if (process.env.SOLTI_API_KEY && !process.env.SOLTI_PROFILE) {
    return process.env.SOLTI_API_URL ?? null;
  }
  const profileOverride = await profileApiUrlOverride();
  return profileOverride ?? process.env.SOLTI_API_URL ?? null;
}

async function profileApiUrlOverride(): Promise<string | null> {
  const account = await getActiveAccount();
  if (account === null) return null;
  const active = await readActive();
  const profileName = process.env.SOLTI_PROFILE ?? active.active_profile;
  if (profileName === null || profileName === undefined) return null;
  const config = await readProfile(account, profileName);
  return config?.api_url ?? null;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Global-host request (account/organization/project APIs). OAuth only. */
  global?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
  ) {
    super(`Solti API error (HTTP ${status})`);
  }
}

async function authHeaders(credentials: Credentials): Promise<Record<string, string>> {
  if (credentials.kind === "api_key") {
    return { "X-Solti-API-Key": credentials.apiKey! };
  }
  const token = await ensureFreshAccessToken(credentials.account!);
  return { Authorization: `Bearer ${token}` };
}

/**
 * Performs a request against the Solti API. `path` is relative to the `/1`
 * base (e.g. `jobs`, `account`). Project-scoped requests require a resolved
 * project id (from the environment or the active profile).
 */
export async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const target = await resolveCredentials();

  if (target.credentials === null) {
    throw new Error(
      "No credentials found. Run `solti account login`, or set SOLTI_API_KEY and SOLTI_PROJECT_ID.",
    );
  }

  const credentials = target.credentials;
  let baseUrl: string;
  if (options.global === true) {
    baseUrl = GLOBAL_API_URL;
    if (credentials.kind !== "oauth") {
      throw new Error("Global endpoints (account/organization/project) require OAuth login (`solti account login`).");
    }
  } else {
    const override = await resolveApiUrlOverride();
    const url = projectBaseUrl(credentials, override);
    if (url === null) {
      throw new Error(
        "No active project. Run `solti profile set <name> --project-id <id>` / `solti project use <id>`, or set SOLTI_PROJECT_ID.",
      );
    }
    baseUrl = url;
  }

  const headers: Record<string, string> = {
    ...(await authHeaders(credentials)),
    "Content-Type": "application/json",
  };
  if (options.global !== true && credentials.projectId !== undefined) {
    headers["X-Solti-Project-Id"] = credentials.projectId;
  }

  const method = options.method ?? "GET";
  const isIdempotentRead = method === "GET";
  let attempts = 0;
  let retryAfterMs = 0;

  // Rate-limit friendly behavior (api spec §5): auto-retry idempotent reads.
  while (true) {
    if (retryAfterMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    }
    attempts += 1;
    const response = await fetch(`${baseUrl}/${path.replace(/^\//, "")}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.status === 429 && isIdempotentRead && attempts <= 2) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "5");
      retryAfterMs = Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000, 30_000);
      console.error(`Rate limited (429). Retrying in ${retryAfterMs / 1000}s...`);
      continue;
    }

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text === "" ? null : JSON.parse(text);
    } catch {
      payload = text;
    }
    if (!response.ok) {
      throw new ApiError(response.status, payload);
    }
    return payload;
  }
}
