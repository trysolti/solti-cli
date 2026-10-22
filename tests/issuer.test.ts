/**
 * Change 048 — per-account LogTo issuer resolution.
 *
 * The CLI's default API host is the live `https://api.solti.run/1`, but the
 * OAuth issuer defaulted to the dev LogTo — the live API rejects dev-issued
 * tokens ("Missing user context for project scope"), so plain `solti account
 * login` was unusable. Fix: default issuer/client_id are the live LogTo
 * (Change 007 B3: CLI app `1mo3mre0396x2a1ux5q93`), and the environment used
 * at login is persisted per account (AuthStore.issuer/client_id) so refresh
 * and logout stay on the same LogTo. Legacy auth.json entries (no `issuer`
 * field) fall back to the `iss`/`client_id` claims of the stored access_token
 * JWT, then to the module defaults.
 */

import { describe, expect, test } from "bun:test";

import { ISSUER, CLIENT_ID, resolveOidc } from "../src/auth/oauth.js";
import type { AuthStore } from "../src/config/store.js";

function fakeJwt(claims: Record<string, unknown>): string {
  return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
}

function makeAuth(overrides: Partial<AuthStore> = {}): AuthStore {
  return {
    access_token: fakeJwt({ iss: "https://auth.dev.solti.run/oidc", client_id: "sae2x70zlqqv4qs3gw6cu" }),
    refresh_token: "r",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    token_type: "Bearer",
    ...overrides,
  };
}

describe("resolveOidc", () => {
  test("persisted issuer/client_id win over token claims", () => {
    const config = resolveOidc(
      makeAuth({ issuer: "https://auth.solti.run/oidc", client_id: "1mo3mre0396x2a1ux5q93" }),
    );
    expect(config).toEqual({
      issuer: "https://auth.solti.run/oidc",
      clientId: "1mo3mre0396x2a1ux5q93",
    });
  });

  test("legacy auth.json falls back to the stored token's iss/client_id claims", () => {
    const config = resolveOidc(makeAuth());
    expect(config).toEqual({
      issuer: "https://auth.dev.solti.run/oidc",
      clientId: "sae2x70zlqqv4qs3gw6cu",
    });
  });

  test("opaque token without claims falls back to the module defaults", () => {
    const config = resolveOidc({ ...makeAuth({ access_token: "opaque" }) });
    expect(config).toEqual({ issuer: ISSUER, clientId: CLIENT_ID });
  });

  test("defaults point at the live LogTo (matching the default API host)", () => {
    expect(ISSUER).toBe("https://auth.solti.run/oidc");
    expect(CLIENT_ID).toBe("1mo3mre0396x2a1ux5q93");
  });
});
