import fs from "node:fs";

import { request } from "../api/client.js";

interface Job {
  id: string;
  name: string;
  status: string;
  image?: string;
  estimated_cost?: number;
  actual_cost?: number;
  retry_count?: number;
  max_retries?: number;
}

export async function jobList(): Promise<void> {
  const data = (await request("jobs")) as { jobs: Job[] };
  if (data.jobs.length === 0) {
    console.log("No jobs. Submit one with `solti job run --image <image> -- <cmd>`.");
    return;
  }
  console.log("NAME | STATUS | IMAGE | COST (EST/ACT)");
  for (const job of data.jobs) {
    console.log(
      `${job.name} | ${job.status} | ${job.image ?? "—"} | ${
        job.estimated_cost ?? "—"
      }/${job.actual_cost ?? "—"}`,
    );
  }
}

export async function jobStatus(jobIdOrName: string): Promise<void> {
  const job = (await request(`jobs/${jobIdOrName}`)) as Record<string, unknown> & Job;
  console.log(`Name:         ${job.name}`);
  console.log(`ID:           ${job.id}`);
  console.log(`Status:       ${job.status}`);
  console.log(`VM Status:    ${job.vm_status ?? "—"}`);
  console.log(`Cost (EST):   ${job.estimated_cost ?? "—"}`);
  console.log(`Cost (ACT):   ${job.actual_cost ?? "—"}`);
  console.log(`Retries:      ${job.retry_count ?? 0}/${job.max_retries ?? 0}`);
  if (job.error_summary) console.log(`Error:        ${job.error_summary}`);
}

export async function jobCancel(jobIdOrName: string): Promise<void> {
  await request(`jobs/${jobIdOrName}/cancel`, { method: "POST" });
  console.log(`Cancellation requested for ${jobIdOrName}.`);
}

export async function jobRun(options: {
  file?: string;
  image?: string;
  command?: string[];
  args?: string[];
  name?: string;
  namePrefix?: string;
  maxRetries?: string;
  env?: string[];
  volume?: string[];
  resources?: string;
  label?: string[];
  tag?: string[];
  cloud?: string;
  region?: string;
  positional: string[];
}): Promise<void> {
  let payload: Record<string, unknown>;

  if (options.file !== undefined) {
    const raw = fs.readFileSync(options.file, "utf8");
    // Minimal YAML/JSON support: JSON parses directly; YAML requires the yaml
    // package. Try JSON first, then fall back to a lazy import of yaml.
    try {
      payload = JSON.parse(raw);
    } catch {
      const { parse } = await import("yaml");
      payload = parse(raw) as Record<string, unknown>;
    }
  } else {
    if (options.image === undefined) {
      console.error("--image is required (or pass -f <workload.yaml>).");
      process.exitCode = 1;
      return;
    }
    payload = {
      image: options.image,
      command: options.command,
      args: options.args ?? (options.positional.length > 0 ? options.positional : undefined),
      name: options.name,
      namePrefix: options.namePrefix,
      max_retries: options.maxRetries !== undefined ? Number(options.maxRetries) : undefined,
      env: Object.fromEntries((options.env ?? []).map((e) => e.split("=", 2))),
      volumes: options.volume?.map((v) => {
        const [bucket, mountPath] = v.split(":");
        return { bucket, mountPath };
      }),
      labels: Object.fromEntries((options.label ?? []).map((l) => l.split("=", 2))),
      tags: options.tag,
      cloud: options.cloud,
      region: options.region,
    };
    if (options.resources !== undefined) {
      const [cpu, memory] = options.resources.split(",");
      payload.resources = {
        cpu: Number(cpu),
        ...(memory !== undefined ? { memory: memory.trim() } : {}),
      };
    }
  }

  const job = (await request("jobs", { method: "POST", body: payload })) as {
    job_id?: string;
    id?: string;
    name: string;
    status: string;
  };
  console.log(`Job submitted: ${job.name} (${job.job_id ?? job.id}) — ${job.status}`);
}
