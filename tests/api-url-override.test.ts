import { describe, expect, test } from "bun:test";

import { resolveApiUrlOverride } from "../src/api/client.ts";

// resolveApiUrlOverride (src/api/client.ts): headless env auth
// (SOLTI_API_KEY without SOLTI_PROFILE) must bypass local profile config so
// SOLTI_API_URL actually controls the target host; with SOLTI_PROFILE set
// explicitly, that profile's api_url wins over the env var.
describe("resolveApiUrlOverride precedence", () => {

  test("headless: SOLTI_API_URL wins, active profile is not consulted", async () => {
    const saved = { key: process.env.SOLTI_API_KEY, profile: process.env.SOLTI_PROFILE, url: process.env.SOLTI_API_URL };
    process.env.SOLTI_API_KEY = "k-test";
    delete process.env.SOLTI_PROFILE;
    process.env.SOLTI_API_URL = "https://preview.api.solti.run";
    try {
      expect(await resolveApiUrlOverride()).toBe("https://preview.api.solti.run");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("headless without SOLTI_API_URL: no override (global default applies)", async () => {
    const saved = { key: process.env.SOLTI_API_KEY, profile: process.env.SOLTI_PROFILE, url: process.env.SOLTI_API_URL };
    process.env.SOLTI_API_KEY = "k-test";
    delete process.env.SOLTI_PROFILE;
    delete process.env.SOLTI_API_URL;
    try {
      expect(await resolveApiUrlOverride()).toBeNull();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("explicit SOLTI_PROFILE: a profile without api_url falls through to SOLTI_API_URL", async () => {
    const saved = { key: process.env.SOLTI_API_KEY, profile: process.env.SOLTI_PROFILE, url: process.env.SOLTI_API_URL };
    delete process.env.SOLTI_API_KEY;
    process.env.SOLTI_PROFILE = "solti-cli-test-nonexistent-profile";
    process.env.SOLTI_API_URL = "https://preview.api.solti.run";
    try {
      expect(await resolveApiUrlOverride()).toBe("https://preview.api.solti.run");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
