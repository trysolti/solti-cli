/**
 * Change 091 WS3 — `solti workflow submit|get|list|cancel`.
 *
 * Mirrors the job command tests (fetch-stub payload captures): submit posts
 * the WorkflowCreateRequest payload `{name?, namePrefix?, templates}` to
 * /1/workflows/ (trailing slash, like jobs), loading YAML/JSON template files
 * with the same JSON-then-yaml fallback as `job run -f`, and explicit
 * --name/--name-prefix flags win over name/namePrefix carried in the file.
 * list forwards --status/--limit/--offset as query params; cancel follows the
 * projectDelete/organizationDelete --yes confirmation pattern.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { afterEach, beforeEach } from "bun:test";

import { workflowCancel, workflowGet, workflowList, workflowSubmit } from "../src/commands/workflow.js";

// --- request captures via stubbed fetch ---------------------------------------

type CapturedRequest = { url: string; method: string; body: unknown };

let captured: CapturedRequest[] = [];
let nextResponse: unknown = { workflow_id: "wf-1", name: "demo", status: "running", nodes: {} };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  nextResponse = { workflow_id: "wf-1", name: "demo", status: "running", nodes: {} };
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
  process.exitCode = 0;
});

// --- temp workflow files -------------------------------------------------------

let tmpDir: string | null = null;

function writeTempFile(name: string, content: string): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solti-workflow-test-"));
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

// --- workflow submit payload ---------------------------------------------------

describe("workflow submit payload", () => {
  test("JSON file templates POST to /1/workflows/ with a trailing slash", async () => {
    const file = writeTempFile(
      "wf.json",
      JSON.stringify({
        templates: [{ name: "build", job: { image: "alpine:latest", command: ["make"] } }],
      }),
    );
    await workflowSubmit(file);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("POST");
    expect(new URL(captured[0]!.url).pathname).toBe("/1/workflows/");
    expect(captured[0]?.body).toMatchObject({
      templates: [{ name: "build", job: { image: "alpine:latest", command: ["make"] } }],
    });
  });

  test("YAML file is loaded via the yaml fallback (same as job run -f)", async () => {
    const file = writeTempFile(
      "wf.yaml",
      [
        "templates:",
        "  - name: build",
        "    job:",
        "      image: alpine:latest",
        "    dependencies: []",
        "  - name: test",
        "    job:",
        "      image: alpine:latest",
        "    dependencies:",
        "      - build",
      ].join("\n"),
    );
    await workflowSubmit(file);
    expect(captured[0]?.body).toMatchObject({
      templates: [
        { name: "build", job: { image: "alpine:latest" }, dependencies: [] },
        { name: "test", job: { image: "alpine:latest" }, dependencies: ["build"] },
      ],
    });
  });

  test("--name/--name-prefix flags override values carried in the file", async () => {
    const file = writeTempFile(
      "wf.yaml",
      "name: file-name\nnamePrefix: file-prefix\ntemplates:\n  - name: build\n    job:\n      image: alpine:latest\n",
    );
    await workflowSubmit(file, { name: "cli-name", namePrefix: "cli-prefix" });
    expect(captured[0]?.body).toMatchObject({ name: "cli-name", namePrefix: "cli-prefix" });
    expect(captured[0]?.body).not.toMatchObject({ name: "file-name" });
  });

  test("file name/namePrefix are forwarded when no flags are given", async () => {
    const file = writeTempFile(
      "wf.yaml",
      "name: file-name\nnamePrefix: file-prefix\ntemplates:\n  - name: build\n    job:\n      image: alpine:latest\n",
    );
    await workflowSubmit(file);
    expect(captured[0]?.body).toMatchObject({ name: "file-name", namePrefix: "file-prefix" });
  });

  test("no name flags and none in the file omits the keys entirely", async () => {
    const file = writeTempFile(
      "wf.json",
      JSON.stringify({ templates: [{ name: "build", job: { image: "alpine:latest" } }] }),
    );
    await workflowSubmit(file);
    const body = captured[0]?.body as Record<string, unknown>;
    expect("name" in body).toBe(false);
    expect("namePrefix" in body).toBe(false);
  });

  test("a file without templates is rejected before any request is sent", async () => {
    const file = writeTempFile("bad.json", JSON.stringify({ image: "alpine:latest" }));
    await expect(workflowSubmit(file)).rejects.toThrow("non-empty `templates` list");
    expect(captured).toHaveLength(0);
  });

  test("an empty templates list is rejected before any request is sent", async () => {
    const file = writeTempFile("empty.json", JSON.stringify({ templates: [] }));
    await expect(workflowSubmit(file)).rejects.toThrow("non-empty `templates` list");
    expect(captured).toHaveLength(0);
  });
});

// --- workflow list / get / cancel ---------------------------------------------

describe("workflow list query params", () => {
  test("--status/--limit/--offset are forwarded as query params", async () => {
    nextResponse = { workflows: [], total: 0, offset: 0, limit: 10 };
    await workflowList({ status: "running", limit: "10", offset: "5" });
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe("/1/workflows/");
    expect(url.searchParams.get("status")).toBe("running");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("5");
  });

  test("no flags send a bare collection request without query params", async () => {
    nextResponse = { workflows: [], total: 0, offset: 0, limit: 50 };
    await workflowList();
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe("/1/workflows/");
    expect(url.search).toBe("");
  });
});

describe("workflow get", () => {
  test("fetches GET /1/workflows/{id_or_name}", async () => {
    nextResponse = {
      id: "wf-uuid-1",
      name: "demo",
      status: "running",
      node_count: 2,
      estimated_cost: 0.01,
      actual_cost: null,
      nodes: [
        { job_id: "job-a", name: "demo-build", status: "succeeded", vm_status: "terminated" },
        { job_id: "job-b", name: "demo-test", status: "running", error_message: null },
      ],
    };
    await workflowGet("demo");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("GET");
    expect(new URL(captured[0]!.url).pathname).toBe("/1/workflows/demo");
  });

  test("renders workflow status and a per-node table row per node job", async () => {
    nextResponse = {
      id: "wf-uuid-1",
      name: "demo",
      status: "running",
      node_count: 2,
      nodes: [
        { job_id: "job-a", name: "demo-build", status: "succeeded", vm_status: "terminated" },
        { job_id: "job-b", name: "demo-test", status: "running", error_message: "oom" },
      ],
    };
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => lines.push(String(msg));
    try {
      await workflowGet("demo");
    } finally {
      console.log = originalLog;
    }
    expect(lines.some((l) => l.includes("Status:       running"))).toBe(true);
    expect(lines.some((l) => l.trim().startsWith("NODE | STATUS | VM STATUS | JOB ID"))).toBe(true);
    expect(lines.some((l) => l.includes("demo-build | succeeded"))).toBe(true);
    expect(lines.some((l) => l.includes("demo-test | running") && l.includes("oom"))).toBe(true);
  });
});

describe("workflow cancel confirmation", () => {
  test("without --yes no request is sent and the exit code is set", async () => {
    await workflowCancel("demo");
    expect(captured).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  test("with --yes posts to /1/workflows/{id_or_name}/cancel", async () => {
    nextResponse = { workflow_id: "wf-1", name: "demo", status: "cancelled" };
    await workflowCancel("demo", { yes: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("POST");
    expect(new URL(captured[0]!.url).pathname).toBe("/1/workflows/demo/cancel");
  });
});
