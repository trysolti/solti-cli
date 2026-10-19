import { request } from "../api/client.js";

interface KeyEntry {
  id: string;
  name: string;
  role?: string;
  created_at?: string;
}

export async function keyList(): Promise<void> {
  // Trailing slash: collection routes live at /1/keys/ (a bare /1/keys
  // 307-redirects to an http:// Location behind the TLS-terminating LB).
  const data = (await request("keys/")) as { keys?: KeyEntry[] };
  const items = data.keys ?? [];
  if (items.length === 0) {
    console.log("No API keys. Create one with `solti key create --name <n> --role <role>`.");
    return;
  }
  for (const k of items) {
    // The id is needed for `solti key delete <id>` (Zitadel user id).
    console.log(`${k.name}  (${k.role ?? "no role"})  id: ${k.id}`);
  }
}

export async function keyCreate(options: {
  name: string;
  role: string;
  expiresAt?: string;
}): Promise<void> {
  const body: Record<string, unknown> = { name: options.name, role: options.role };
  if (options.expiresAt !== undefined) body.expires_at = options.expiresAt;
  // CreateKeyResponse fields: id, name, value (the one-time token), role.
  const created = (await request("keys/", { method: "POST", body })) as {
    name: string;
    value?: string;
    api_key?: string;
    token?: string;
  };
  const token = created.value ?? created.api_key ?? created.token;
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
