import { request } from "../api/client.js";

export async function keyList(): Promise<void> {
  const data = (await request("keys")) as {
    keys?: Array<{ name: string; role?: string; created_at?: string }>;
  };
  const items = data.keys ?? [];
  if (items.length === 0) {
    console.log("No API keys. Create one with `solti key create --name <n> --role <role>`.");
    return;
  }
  for (const k of items) {
    console.log(`${k.name}  (${k.role ?? "no role"})`);
  }
}

export async function keyCreate(options: {
  name: string;
  role: string;
  expiresAt?: string;
}): Promise<void> {
  const body: Record<string, unknown> = { name: options.name, role: options.role };
  if (options.expiresAt !== undefined) body.expires_at = options.expiresAt;
  const created = (await request("keys", { method: "POST", body })) as {
    name: string;
    api_key?: string;
    token?: string;
  };
  const token = created.api_key ?? created.token;
  console.log(`API key created: ${created.name}`);
  if (token !== undefined) {
    console.log(`\n${token}\n`);
    console.log("(store it now — it is shown only once)");
  }
}

export async function keyDelete(idOrName: string): Promise<void> {
  await request(`keys/${idOrName}`, { method: "DELETE" });
  console.log(`API key ${idOrName} deleted.`);
}
