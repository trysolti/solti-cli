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
  const data = (await request("cronjobs")) as { cronjobs?: Cronjob[] };
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
  image: string;
  command?: string;
  args?: string;
  active?: string;
}): Promise<void> {
  const payload = {
    name: options.name,
    cron_spec: options.schedule,
    is_active: options.active !== "false",
    job_definition: {
      image: options.image,
      command: options.command?.split(" ").filter(Boolean),
      args: options.args?.split(" ").filter(Boolean),
    },
  };
  const c = (await request("cronjobs", { method: "POST", body: payload })) as Cronjob;
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
