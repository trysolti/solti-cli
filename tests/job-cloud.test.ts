/**
 * Change 048 — `solti job run --cloud/--region` send JSON arrays.
 *
 * Live incident: the CLI sent `cloud: "azure"` (scalar); the API's documented
 * scalar form accepted it and the scalar JSON string was persisted into
 * jobs.cloud, 500ing every /1/jobs* read (see changes/048--* in solti-specs).
 * These tests pin: repeatable + comma-separated flags normalize to arrays,
 * and no cloud/region key is sent when the flags are absent.
 */

import { describe, expect, test } from "bun:test";
import { afterEach, beforeEach } from "bun:test";

import { parseStringList } from "../src/lib/parse.js";
import { jobRun } from "../src/commands/job.js";

// --- parseStringList (repeatable + comma-separated flag values) --------------

describe("parseStringList", () => {
  test("splits comma-separated values", () => {
    expect(parseStringList(["aws,gcp"])).toEqual(["aws", "gcp"]);
  });

  test("keeps one entry per repeat", () => {
    expect(parseStringList(["aws", "gcp"])).toEqual(["aws", "gcp"]);
  });

  test("mixes repeats and comma-separated values", () => {
    expect(parseStringList(["aws,gcp", "azure"])).toEqual(["aws", "gcp", "azure"]);
  });

  test("trims whitespace and drops empty items", () => {
    expect(parseStringList(["aws, gcp, "])).toEqual(["aws", "gcp"]);
  });

  test("coerces a scalar string (commander single-use option value)", () => {
    expect(parseStringList("aws")).toEqual(["aws"]);
  });

  test("undefined yields an empty array", () => {
    expect(parseStringList(undefined)).toEqual([]);
  });
});

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

describe("job run cloud/region payload", () => {
  test("repeated --cloud flags are sent as an array", async () => {
    await jobRun({ image: "alpine:latest", cloud: ["aws", "gcp"], positional: [] });
    expect(captured[0]?.body).toMatchObject({ cloud: ["aws", "gcp"] });
  });

  test("comma-separated --cloud is normalized to an array", async () => {
    await jobRun({ image: "alpine:latest", cloud: ["aws,gcp"], positional: [] });
    expect(captured[0]?.body).toMatchObject({ cloud: ["aws", "gcp"] });
  });

  test("a scalar option value (single flag use) is sent as an array", async () => {
    // Regression for the incident: a plain string must never reach the wire.
    await jobRun({ image: "alpine:latest", cloud: "azure" as unknown as string[], positional: [] });
    expect(captured[0]?.body).toMatchObject({ cloud: ["azure"] });
  });

  test("no cloud/region flags omit the keys entirely", async () => {
    await jobRun({ image: "alpine:latest", positional: [] });
    const body = captured[0]?.body as Record<string, unknown>;
    expect("cloud" in body).toBe(false);
    expect("region" in body).toBe(false);
  });

  test("--region supports repeats and comma-separated values", async () => {
    await jobRun({
      image: "alpine:latest",
      region: ["us-east-1,europe", "apac"],
      positional: [],
    });
    expect(captured[0]?.body).toMatchObject({ region: ["us-east-1", "europe", "apac"] });
  });
});
