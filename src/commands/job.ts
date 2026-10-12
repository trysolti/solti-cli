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

export async function jobStatus(jobIdOrName: string, options: { watch?: boolean } = {}): Promise<void> {
  const terminalStates = new Set(["succeeded", "failed", "cancelled"]);
  const render = (job: Record<string, unknown> & Job) => {
    console.log(`Name:         ${job.name}`);
    console.log(`ID:           ${job.id}`);
    console.log(`Status:       ${job.status}`);
    console.log(`VM Status:    ${job.vm_status ?? "—"}`);
    console.log(`Cost (EST):   ${job.estimated_cost ?? "—"}`);
    console.log(`Cost (ACT):   ${job.actual_cost ?? "—"}`);
    console.log(`Retries:      ${job.retry_count ?? 0}/${job.max_retries ?? 0}`);
    if (job.error_summary) console.log(`Error:        ${job.error_summary}`);
  };

  if (!options.watch) {
    render((await request(`jobs/${jobIdOrName}`)) as Record<string, unknown> & Job);
    return;
  }

  // §3.9: stream status updates in place until a terminal state — the CLI
  // counterpart of the SDKs' `wait_until_complete`.
  process.stdout.write("\x1b[2J\x1b[H");
  let lastStatus: string | null = null;
  for (;;) {
    const job = (await request(`jobs/${jobIdOrName}`)) as Record<string, unknown> & Job;
    if (job.status !== lastStatus) {
      process.stdout.write("\x1b[2J\x1b[H");
      render(job);
      lastStatus = job.status;
    }
    if (terminalStates.has(job.status)) {
      console.log(`\nJob reached terminal state: ${job.status}`);
      process.exitCode = job.status === "succeeded" ? 0 : 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
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
  volumeName?: string;
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
      maxRetries: options.maxRetries !== undefined ? Number(options.maxRetries) : undefined,
      env: Object.fromEntries((options.env ?? []).map((e) => e.split("=", 2))),
      volumes: Object.fromEntries(
        (options.volume ?? []).map((v) => {
          // Two formats per tools/cli.md: shorthand `bucket:mountPath` or the
          // structured `bucket=<b>,mountPath=<p>[,connection=...][,prefix=...]`.
          // The volume name (map key) defaults to the bucket name unless
          // `--volume-name <name>` is given.
          let volume: { bucket: string; mountPath: string; connection?: string; prefix?: string };
          if (v.includes("=")) {
            const parts = Object.fromEntries(
              v.split(",").map((pair) => pair.split("=", 2) as [string, string]),
            );
            if (!parts.bucket || !parts.mountPath) {
              throw new Error(
                `Invalid --volume spec '${v}' — expected bucket=<b>,mountPath=<p>[,connection=...][,prefix=...]`,
              );
            }
            volume = { bucket: parts.bucket, mountPath: parts.mountPath };
            if (parts.connection) volume.connection = parts.connection;
            if (parts.prefix) volume.prefix = parts.prefix;
          } else {
            const [bucket, mountPath] = v.split(":");
            if (!bucket || !mountPath) {
              throw new Error(`Invalid --volume spec '${v}' — expected <bucket>:<mountPath>`);
            }
            volume = { bucket, mountPath };
          }
          return [options.volumeName ?? volume.bucket, volume];
        }),
      ),
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
