/**
 * Change 048 — per-account issuer resolution (retargeted to Solti ID /
 * Authorizer by Change 057f).
 *
 * The CLI's default API host is the live `https://api.solti.run/1`, and the
 * live API rejects dev-issued tokens, so plain `solti account login` must
 * default to the live issuer (live Authorizer client from the 057b spike:
 * `113215f1a2a2beeed9f5c6279e3537a2`). The environment used at login is
 * persisted per account (AuthStore.issuer/client_id) so refresh and logout
 * stay on the same issuer. Legacy auth.json entries (no `issuer` field)
 * fall back to the `iss`/`client_id` claims of the stored access_token JWT,
 * then to the module defaults.
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

  test("defaults point at the live Solti ID / Authorizer (matching the default API host)", () => {
    expect(ISSUER).toBe("https://id.solti.run");
    expect(CLIENT_ID).toBe("113215f1a2a2beeed9f5c6279e3537a2");
  });
});
