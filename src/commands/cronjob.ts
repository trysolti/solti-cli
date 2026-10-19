import fs from "node:fs";

import { request } from "../api/client.js";

interface Cronjob {
  id: string;
  name: string;
  cron_spec: string;
  is_active: boolean;
  last_triggered_at?: string;
  job_definition?: { image?: string };
}

export async function cronjobList(): Promise<void> {
  // Trailing slash: collection routes live at /1/cronjobs/ (see key.ts).
  const data = (await request("cronjobs/")) as { cronjobs?: Cronjob[] };
  const items = data.cronjobs ?? [];
  if (items.length === 0) {
    console.log("No cronjobs. Create one with `solti cronjob create --name <n> --schedule <cron> --image <img>`.");
    return;
  }
  for (const c of items) {
    console.log(`${c.name} | ${c.cron_spec} | ${c.is_active ? "active" : "inactive"} | last: ${c.last_triggered_at ?? "Never"}`);
  }
}

export async function cronjobShow(idOrName: string): Promise<void> {
  const c = (await request(`cronjobs/${idOrName}`)) as Cronjob;
  console.log(`Name:       ${c.name}`);
  console.log(`ID:         ${c.id}`);
  console.log(`Schedule:   ${c.cron_spec} (UTC)`);
  console.log(`Active:     ${c.is_active}`);
  console.log(`Image:      ${c.job_definition?.image ?? "—"}`);
  console.log(`Last run:   ${c.last_triggered_at ?? "Never"}`);
}

export async function cronjobCreate(options: {
  name: string;
  schedule: string;
  file?: string;
  image?: string;
  command?: string;
  args?: string;
  active?: string;
}): Promise<void> {
  // Two forms per tools/cli.md: inline (--image [+ --command/--args]) or a
  // workload YAML/JSON file reused as the job_definition template (--file).
  let jobDefinition: Record<string, unknown>;
  if (options.file !== undefined) {
    if (options.image !== undefined || options.command !== undefined || options.args !== undefined) {
      throw new Error("--file cannot be combined with --image/--command/--args");
    }
    const raw = fs.readFileSync(options.file, "utf8");
    let template: Record<string, unknown>;
    try {
      template = JSON.parse(raw);
    } catch {
      const { parse } = await import("yaml");
      template = parse(raw) as Record<string, unknown>;
    }
    // JobDefinition forbids extra fields — notably a fixed `name` and the
    // submit-only `namePrefix` (cronjobs/dtos.py).
    delete template.name;
    delete template.namePrefix;
    jobDefinition = template;
  } else {
    if (options.image === undefined) {
      throw new Error("--image is required (or pass --file <job.yaml>)");
    }
    jobDefinition = {
      image: options.image,
      command: options.command?.split(" ").filter(Boolean),
      args: options.args?.split(" ").filter(Boolean),
    };
  }
  const payload = {
    name: options.name,
    cron_spec: options.schedule,
    is_active: options.active !== "false",
    job_definition: jobDefinition,
  };
  // Trailing slash: collection routes live at /1/cronjobs/ (see key.ts).
  const c = (await request("cronjobs/", { method: "POST", body: payload })) as Cronjob;
  console.log(`Cronjob created: ${c.name} (${c.id})`);
}

export async function cronjobUpdate(
  idOrName: string,
  options: { schedule?: string; active?: string; image?: string },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (options.schedule !== undefined) body.cron_spec = options.schedule;
  if (options.active !== undefined) body.is_active = options.active !== "false";
  if (options.image !== undefined) body.job_definition = { image: options.image };
  const c = (await request(`cronjobs/${idOrName}`, { method: "PATCH", body })) as Cronjob;
  console.log(`Cronjob ${c.name} updated.`);
}

export async function cronjobDelete(idOrName: string): Promise<void> {
  await request(`cronjobs/${idOrName}`, { method: "DELETE" });
  console.log(`Cronjob ${idOrName} deleted.`);
}
