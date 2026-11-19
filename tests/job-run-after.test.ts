/**
 * Change 090 — `solti job run --run-after <RFC3339|ISO8601>`.
 *
 * The flag is client-side validated (timezone-aware datetime required; the
 * API answers 422 for naive datetimes, so the CLI must never send one) and
 * forwarded verbatim as `runAfter` in the POST /1/jobs payload (camelCase
 * per constitution/system/api/spec.md §3.0). Semantics: the job stays
 * `queued` with no VM until the instant passes.
 */

import { describe, expect, test } from "bun:test";
import { afterEach, beforeEach } from "bun:test";

import { jobRun } from "../src/commands/job.js";

// --- jobRun payload captures via stubbed fetch -------------------------------

type CapturedRequest = { url: string; method: string; body: unknown };

let captured: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  process.env.SOLTI_API_KEY = "test-key";
  process.env.SOLTI_PROJECT_ID = "proj-1";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify({ job_id: "job-1", name: "t", status: "queued" }), {
      status: 200,
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("job run run-after payload", () => {
  test("--run-after is forwarded verbatim as runAfter (camelCase payload)", async () => {
    await jobRun({ image: "alpine:latest", runAfter: "2026-11-25T02:00:00Z", positional: [] });
    expect(captured[0]?.body).toMatchObject({ runAfter: "2026-11-25T02:00:00Z" });
  });

  test("an offset datetime is accepted and sent as given (API normalizes to UTC)", async () => {
    await jobRun({ image: "alpine:latest", runAfter: "2026-11-25T11:00:00+09:00", positional: [] });
    expect(captured[0]?.body).toMatchObject({ runAfter: "2026-11-25T11:00:00+09:00" });
  });

  test("no --run-after flag omits the key entirely", async () => {
    await jobRun({ image: "alpine:latest", positional: [] });
    expect("runAfter" in (captured[0]?.body as Record<string, unknown>)).toBe(false);
  });

  test("naive datetime (no timezone) is rejected before any request is sent", async () => {
    await expect(
      jobRun({ image: "alpine:latest", runAfter: "2026-11-25T02:00:00", positional: [] }),
    ).rejects.toThrow("naive datetime without a timezone");
    expect(captured).toHaveLength(0);
  });

  test("garbage input is rejected before any request is sent", async () => {
    await expect(
      jobRun({ image: "alpine:latest", runAfter: "next-tuesday", positional: [] }),
    ).rejects.toThrow("expected an RFC 3339 / ISO 8601 datetime with timezone");
    expect(captured).toHaveLength(0);
  });

  test("impossible calendar datetime is rejected before any request is sent", async () => {
    await expect(
      jobRun({ image: "alpine:latest", runAfter: "2026-02-30T00:00:00Z", positional: [] }),
    ).rejects.toThrow("not a real calendar datetime");
    expect(captured).toHaveLength(0);
  });
});
