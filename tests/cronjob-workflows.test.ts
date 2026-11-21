/**
 * Change 092 WS2 — `solti cronjob workflows <id_or_name>`.
 *
 * Mirrors the workflow command tests (fetch-stub payload captures): the run
 * history of a cronjob's spawned workflows is fetched from
 * GET /1/cronjobs/{id_or_name}/workflows (same ListWorkflowsResponse envelope
 * as GET /1/workflows), with --status/--limit/--offset forwarded as query
 * params, and rows rendered NAME | STATUS | CREATED | ENDED ("—" for the
 * nullable ended_at while a run is still going).
 */

import { describe, expect, test } from "bun:test";
import { afterEach, beforeEach } from "bun:test";

import { cronjobWorkflows } from "../src/commands/cronjob.js";

// --- request captures via stubbed fetch ---------------------------------------

type CapturedRequest = { url: string; method: string; body: unknown };

let captured: CapturedRequest[] = [];
let nextResponse: unknown = { workflows: [], total: 0, offset: 0, limit: 50 };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  nextResponse = { workflows: [], total: 0, offset: 0, limit: 50 };
  process.env.SOLTI_API_KEY = "test-key";
  process.env.SOLTI_PROJECT_ID = "proj-1";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(nextResponse), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.exitCode = undefined;
});

// --- console capture ------------------------------------------------------------

async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (msg?: unknown) => lines.push(String(msg));
  try {
    await run();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

// --- path + query params --------------------------------------------------------

describe("cronjob workflows query params", () => {
  test("GETs /1/cronjobs/{id_or_name}/workflows with --status/--limit/--offset forwarded", async () => {
    nextResponse = { workflows: [], total: 0, offset: 5, limit: 10 };
    await cronjobWorkflows("nightly", { status: "failed", limit: "10", offset: "5" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("GET");
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe("/1/cronjobs/nightly/workflows");
    expect(url.searchParams.get("status")).toBe("failed");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("5");
  });

  test("no flags send a bare request without query params", async () => {
    await cronjobWorkflows("nightly");
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe("/1/cronjobs/nightly/workflows");
    expect(url.search).toBe("");
  });
});

// --- render ---------------------------------------------------------------------

describe("cronjob workflows render", () => {
  test("renders NAME | STATUS | CREATED | ENDED rows per run", async () => {
    nextResponse = {
      workflows: [
        {
          id: "wf-1",
          name: "nightly-20261121T0200",
          status: "succeeded",
          cronjob_name: "nightly",
          created_at: "2026-11-21T02:00:05Z",
          ended_at: "2026-11-21T02:04:59Z",
        },
        {
          id: "wf-2",
          name: "nightly-20261122T0200",
          status: "running",
          cronjob_name: "nightly",
          created_at: "2026-11-22T02:00:06Z",
          ended_at: null,
        },
      ],
      total: 2,
      offset: 0,
      limit: 50,
    };
    const lines = await captureLogs(() => cronjobWorkflows("nightly"));
    expect(lines.some((l) => l.trim().startsWith("NAME | STATUS | CREATED | ENDED"))).toBe(true);
    expect(
      lines.some(
        (l) =>
          l.includes("nightly-20261121T0200 | succeeded") &&
          l.includes("2026-11-21T02:00:05Z") &&
          l.includes("2026-11-21T02:04:59Z"),
      ),
    ).toBe(true);
    expect(
      lines.some((l) => l.includes("nightly-20261122T0200 | running") && l.includes("—")),
    ).toBe(true);
  });

  test("an empty history prints a no-runs hint", async () => {
    const lines = await captureLogs(() => cronjobWorkflows("nightly"));
    expect(lines.some((l) => l.includes("No workflow runs for nightly yet."))).toBe(true);
  });
});
