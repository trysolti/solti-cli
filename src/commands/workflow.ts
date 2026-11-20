import fs from "node:fs";

import { request } from "../api/client.js";

// Response shapes per the Workflows API (change 086; OpenAPI 0.3.0
// WorkflowCreateResponse / WorkflowDetail / WorkflowNode / ListWorkflowsResponse).
interface WorkflowNode {
  job_id: string;
  name: string;
  status: string;
  vm_status?: string | null;
  error_message?: string | null;
  estimated_cost?: number | null;
  actual_cost?: number | null;
}

export async function workflowSubmit(
  file: string,
  options: { name?: string; namePrefix?: string } = {},
): Promise<void> {
  const raw = fs.readFileSync(file, "utf8");
  // Same JSON-then-YAML loading as `solti job run -f` (jobRun).
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const { parse } = await import("yaml");
    parsed = parse(raw) as Record<string, unknown>;
  }
  const templates = parsed.templates;
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error(
      `Invalid workflow file '${file}' — expected an object with a non-empty \`templates\` list (WorkflowCreateRequest)`,
    );
  }
  // Explicit flags win over name/namePrefix carried in the file (091 D-3).
  const payload = {
    name: options.name ?? (parsed.name as string | undefined),
    namePrefix: options.namePrefix ?? (parsed.namePrefix as string | undefined),
    templates,
  };
  // Trailing slash: collection routes live at /1/workflows/ (see jobList —
  // a bare /1/workflows 307-redirects behind the TLS-terminating LB).
  const workflow = (await request("workflows/", { method: "POST", body: payload })) as {
    workflow_id?: string;
    id?: string;
    name: string;
    status: string;
  };
  console.log(
    `Workflow submitted: ${workflow.name} (${workflow.workflow_id ?? workflow.id}) — ${workflow.status}`,
  );
}

export async function workflowGet(idOrName: string): Promise<void> {
  const workflow = (await request(`workflows/${idOrName}`)) as {
    id: string;
    name: string;
    status: string;
    error_message?: string | null;
    node_count?: number;
    estimated_cost?: number | null;
    actual_cost?: number | null;
    nodes?: WorkflowNode[];
  };
  console.log(`Name:         ${workflow.name}`);
  console.log(`ID:           ${workflow.id}`);
  console.log(`Status:       ${workflow.status}`);
  if (workflow.error_message) console.log(`Error:        ${workflow.error_message}`);
  console.log(`Nodes:        ${workflow.node_count ?? workflow.nodes?.length ?? "—"}`);
  console.log(`Cost (EST):   ${workflow.estimated_cost ?? "—"}`);
  console.log(`Cost (ACT):   ${workflow.actual_cost ?? "—"}`);
  console.log("\nNODE | STATUS | VM STATUS | JOB ID | COST (EST/ACT) | ERROR");
  for (const node of workflow.nodes ?? []) {
    console.log(
      `${node.name} | ${node.status} | ${node.vm_status ?? "—"} | ${node.job_id} | ${
        node.estimated_cost ?? "—"
      }/${node.actual_cost ?? "—"} | ${node.error_message ?? "—"}`,
    );
  }
}

export async function workflowList(
  options: { status?: string; limit?: string; offset?: string } = {},
): Promise<void> {
  // GET /1/workflows query params: status (running|succeeded|failed|cancelled),
  // limit (default 50/max 200), offset. Forwarded verbatim; the API validates.
  const query = new URLSearchParams();
  if (options.status !== undefined) query.set("status", options.status);
  if (options.limit !== undefined) query.set("limit", options.limit);
  if (options.offset !== undefined) query.set("offset", options.offset);
  const qs = query.toString();
  const data = (await request(`workflows/${qs ? `?${qs}` : ""}`)) as {
    workflows: Array<{ name: string; status: string; node_count?: number }>;
  };
  if (data.workflows.length === 0) {
    console.log("No workflows. Submit one with `solti workflow submit <file.yaml>`.");
    return;
  }
  console.log("NAME | STATUS | NODES");
  for (const workflow of data.workflows) {
    console.log(`${workflow.name} | ${workflow.status} | ${workflow.node_count ?? "—"}`);
  }
}

export async function workflowCancel(idOrName: string, options: { yes?: boolean } = {}): Promise<void> {
  // Confirmation pattern mirrors projectDelete/organizationDelete: no
  // interactive prompt — refuse until --yes.
  if (!options.yes) {
    console.error("This cancels every non-terminal node job of the workflow. Re-run with --yes to confirm.");
    process.exitCode = 1;
    return;
  }
  // Only valid while the workflow is running (the API 409s otherwise).
  await request(`workflows/${idOrName}/cancel`, { method: "POST" });
  console.log(`Cancellation requested for ${idOrName}.`);
}
