/**
 * Solti ID (Authorizer) OAuth 2.0 Authorization Code + PKCE flow for the
 * Solti CLI (Change 057f — direct loopback PKCE, no relay, no solti-api
 * token endpoints).
 *
 * Registered reserved interactive clients (Change 057b spike; public clients,
 * no secret — authorization_code+PKCE token exchanges need client_id alone,
 * refresh/revoke need client_id + token):
 * - live  Authorizer (https://id.solti.run):     `113215f1a2a2beeed9f5c6279e3537a2`
 * - dev   Authorizer (https://id.dev.solti.run): `b7435147811323ceb1055d8bec85b315`
 * - Redirect URIs http://localhost:4242..4245/callback (exact-match, also
 *   registered as allowed origins); scopes `openid offline_access email
 *   profile`. No OAuth `resource` param: access tokens are Authorizer JWTs
 *   with aud=client_id and solti-api now validates aud=client_id (057e).
 *
 * The DEFAULT issuer is the live one: the CLI's default API host is the live
 * `https://api.solti.run/1`, and the live API rejects dev-issued tokens
 * — the previous dev default made plain `solti account login` unusable
 * against the default API (Change 048). Dev-issuer sign-in remains available
 * via SOLTI_AUTHORIZER_ISSUER / SOLTI_AUTHORIZER_CLIENT_ID (the pre-migration
 * SOLTI_LOGTO_ISSUER / SOLTI_LOGTO_CLIENT_ID names are still honored as
 * deprecated fallbacks so existing env profiles survive the migration).
 * Whichever environment a login used is persisted per account
 * (AuthStore.issuer/client_id) so token refresh and logout hit the same
 * Authorizer instance.
 */

import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";

import {
  deleteAuth,
  getActiveAccount,
  listAccounts,
  readActive,
  readAuth,
  writeActive,
  writeAuth,
  type AuthStore,
} from "../config/store.js";

export const CLIENT_ID =
  process.env.SOLTI_AUTHORIZER_CLIENT_ID ??
  process.env.SOLTI_LOGTO_CLIENT_ID ??
  "113215f1a2a2beeed9f5c6279e3537a2";
export const ISSUER =
  process.env.SOLTI_AUTHORIZER_ISSUER ??
  process.env.SOLTI_LOGTO_ISSUER ??
  "https://id.solti.run";
export const SCOPES = "openid offline_access email profile";

/** Manual endpoint fallback for issuers whose OIDC discovery is unavailable
 * (Change 057b evidence: Authorizer serves the standard paths). */
function fallbackEndpoints(issuer: string): Discovery {
  return {
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
  };
}

/** Resolved per-account OIDC endpoints: the issuer/client_id persisted at
 * login wins; legacy auth.json entries fall back to the `iss`/`client_id`
 * claims of the stored access_token JWT, then to the module defaults. */
export interface OidcConfig {
  issuer: string;
  clientId: string;
}

/** Decodes JWT payload claims (no signature check — best-effort hints only). */
function decodeJwtClaims(token: string | undefined): Record<string, unknown> | null {
  if (token === undefined) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** Per-account OIDC resolution for refresh/logout (pure — unit-tested). */
export function resolveOidc(auth: {
  issuer?: string;
  client_id?: string;
  access_token: string;
}): OidcConfig {
  const claims = decodeJwtClaims(auth.access_token);
  const issuer =
    auth.issuer ??
    (typeof claims?.iss === "string" && claims.iss !== "" ? claims.iss : null) ??
    ISSUER;
  const clientId =
    auth.client_id ??
    (typeof claims?.client_id === "string" && claims.client_id !== "" ? claims.client_id : null) ??
    CLIENT_ID;
  return { issuer, clientId };
}

/** Fixed registered loopback port range (spec §1.1 / logto-changes.md §5.1).
 * The listener binds dual-stack (no explicit host) so browsers resolving
 * `localhost` to ::1 still reach the callback server (observed in the 057f
 * e2e: Chromium connected to ::1 only). */
const CALLBACK_PORTS = [4242, 4243, 4244, 4245];
const CALLBACK_PATH = "/callback";

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint?: string;
}

const discoveryCache = new Map<string, Discovery>();

export async function discover(issuer: string = ISSUER): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached !== undefined) return cached;
  try {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const discovery = (await response.json()) as Discovery;
    discoveryCache.set(issuer, discovery);
    return discovery;
  } catch {
    // Discovery unavailable — fall back to the standard Authorizer paths.
    const discovery = fallbackEndpoints(issuer);
    discoveryCache.set(issuer, discovery);
    return discovery;
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function openBrowser(url: string): void {
  import("node:child_process").then(({ spawn }) => {
    const platform = process.platform;
    const command =
      platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    try {
      spawn(command, args, { stdio: "ignore", detached: true }).unref();
    } catch {
      // Browser auto-open failed — the URL is printed to the terminal anyway.
    }
  });
}

interface LoginResult {
  email: string;
  auth: AuthStore;
}

/** Runs the full Authorization Code + PKCE flow and stores tokens. */
export async function login(options?: { launchBrowser?: boolean }): Promise<LoginResult> {
  const launchBrowser = options?.launchBrowser ?? true;
  const oidc = await discover();

  const codeVerifier = base64url(crypto.randomBytes(64));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));

  // Bind the first free loopback port in the registered range.
  const server = await bindCallbackServer();
  const port = (server.address() as net.AddressInfo).port;
  const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;

  const authorizationUrl = new URL(oidc.authorization_endpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", SCOPES);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", state);

  if (launchBrowser) {
    console.log(`Opening browser for sign-in:\n  ${authorizationUrl.toString()}\n`);
    openBrowser(authorizationUrl.toString());
  } else {
    console.log(`Sign-in URL (open it in a browser to continue):\n  ${authorizationUrl.toString()}\n`);
  }

  const code = await waitForCallback(server, state);
  server.close();

  const tokens = (await exchangeCode(oidc, code, redirectUri, codeVerifier)) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    id_token?: string;
  };

  // Diagnostics: help identify what the issuer actually granted.
  if (tokens.access_token.split(".").length !== 3) {
    console.error(
      "(warning: access token is opaque, not a JWT — the API resource was not bound to the grant)",
    );
  }
  if (tokens.refresh_token === undefined || tokens.refresh_token === "") {
    console.error("(warning: no refresh token issued)");
  }

  const email = decodeIdTokenEmail(tokens.id_token) ?? (await tryUserinfoEmail(oidc, tokens.access_token));
  if (email === null || email === undefined) {
    throw new Error("Could not determine the account email from the token response.");
  }

  const auth: AuthStore = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? "",
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    token_type: tokens.token_type ?? "Bearer",
    email,
    // Persist the environment this login used so refresh/logout stay on the
    // same Authorizer instance (Change 048, retargeted by 057f).
    issuer: ISSUER,
    client_id: CLIENT_ID,
  };
  await writeAuth(email, auth);

  // Switch the active account (adds the account if another one was active).
  const active = await readActive();
  await writeActive({ ...active, active_account: email });

  return { email, auth };
}

function bindCallbackServer(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    let lastError: Error | null = null;
    const tryPort = (index: number): void => {
      if (index >= CALLBACK_PORTS.length) {
        reject(
          new Error(
            `All callback ports (${CALLBACK_PORTS.join(", ")}) are busy. ` +
              `Free one of them and run \`solti account login\` again.`,
          ),
        );
        return;
      }
      const port = CALLBACK_PORTS[index];
      const server = http.createServer();
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          lastError = error;
          tryPort(index + 1);
        } else {
          reject(error);
        }
      });
      server.listen(port, () => {
        resolve(server);
      });
    };
    tryPort(0);
    void lastError;
  });
}

function waitForCallback(server: http.Server, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Sign-in timed out waiting for the browser callback (5 minutes)."));
    }, 5 * 60 * 1000);

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", `http://localhost`);
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        `<!doctype html><html><body style="font-family: sans-serif; text-align: center; padding-top: 4rem;">` +
          `<h2>Solti CLI</h2><p>${
            error ?? "Sign-in complete. You can close this window and return to the terminal."
          }</p></body></html>`,
      );

      clearTimeout(timeout);
      if (error !== null && error !== undefined && error !== "") {
        reject(new Error(`Sign-in failed: ${error}`));
      } else if (state !== expectedState) {
        reject(new Error("Sign-in failed: state mismatch (possible CSRF). Try again."));
      } else if (code === null || code === "") {
        reject(new Error("Sign-in failed: missing authorization code."));
      } else {
        resolve(code);
      }
    });
  });
}

async function exchangeCode(
  oidc: Discovery,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<unknown> {
  const response = await fetch(oidc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${await response.text()}`);
  }
  return response.json();
}

/** Best-effort email from the id_token JWT claims (email scope). */
function decodeIdTokenEmail(idToken?: string): string | null {
  if (idToken === undefined) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload.email ?? payload.username ?? null;
  } catch {
    return null;
  }
}

async function tryUserinfoEmail(
  oidc: Discovery,
  accessToken: string,
): Promise<string | null> {
  try {
    const userinfo = await fetchUserinfo(oidc, accessToken);
    return userinfo.email ?? userinfo.username ?? null;
  } catch {
    return null;
  }
}

async function fetchUserinfo(
  oidc: Discovery,
  accessToken: string,
): Promise<{ sub: string; email?: string; username?: string }> {
  const response = await fetch(oidc.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Userinfo lookup failed (HTTP ${response.status})`);
  }
  return (await response.json()) as { sub: string; email?: string; username?: string };
}

/** Returns a fresh access token for the given account, refreshing if needed. */
export async function ensureFreshAccessToken(email: string): Promise<string> {
  const auth = await readAuth(email);
  if (auth === null) {
    throw new Error(`No stored credentials for ${email}. Run \`solti account login\`.`);
  }

  const expiresAt = Date.parse(auth.expires_at);
  const refreshThreshold = Date.now() + 5 * 60 * 1000;
  // An opaque (non-JWT) access token is useless against JWT-verifying APIs —
  // treat it as stale and refresh into a JWT.
  const isJwt = auth.access_token.split(".").length === 3;
  if (Number.isFinite(expiresAt) && expiresAt > refreshThreshold && isJwt) {
    return auth.access_token;
  }

  if (auth.refresh_token === "") {
    throw new Error(
      `Session for ${email} expired and no refresh token is stored. Run \`solti account login\`.`,
    );
  }

  const { issuer, clientId } = resolveOidc(auth);
  const oidc = await discover(issuer);
  const response = await fetch(oidc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refresh_token,
      client_id: clientId,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Token refresh failed for ${email} (HTTP ${response.status}): ` +
        `session expired — run \`solti account login\` again.`,
    );
  }
  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };
  const updated: AuthStore = {
    ...auth,
    access_token: tokens.access_token,
    // Authorizer rotates refresh tokens on use — persist the new one.
    refresh_token: tokens.refresh_token ?? auth.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    // Stamp the resolved environment so legacy auth.json entries are upgraded.
    issuer,
    client_id: clientId,
  };
  await writeAuth(email, updated);
  return updated.access_token;
}

/** Best-effort refresh token revocation + local credential deletion. */
export async function logout(email: string): Promise<void> {
  const auth = await readAuth(email);
  if (auth !== null && auth.refresh_token !== "") {
    try {
      const { issuer, clientId } = resolveOidc(auth);
      const oidc = await discover(issuer);
      if (oidc.revocation_endpoint !== undefined) {
        await fetch(oidc.revocation_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: auth.refresh_token, client_id: clientId }),
        });
      }
    } catch {
      // Best-effort only; local deletion happens regardless.
    }
  }
  await deleteAuth(email);
  const active = await readActive();
  if (active.active_account === email) {
    const remaining = (await listAccounts()).filter((name) => name !== email);
    await writeActive({
      ...active,
      active_account: remaining[0],
    });
  }
}

/** Returns the active account, or null with guidance already printed. */
export async function requireActiveAccount(): Promise<string> {
  const account = await getActiveAccount();
  if (account === null) {
    console.error("No logged-in account. Run `solti account login` first.");
    process.exit(1);
  }
  return account;
}
