import { request } from "../api/client.js";

export async function connectionList(): Promise<void> {
  const data = (await request("connections")) as {
    connections?: Array<{ name: string; type: string }>;
  };
  const items = data.connections ?? [];
  if (items.length === 0) {
    console.log("No connections. Create one with `solti connection create`.");
    return;
  }
  for (const c of items) console.log(`${c.name}  (${c.type})`);
}

export async function connectionGet(name: string): Promise<void> {
  const c = (await request(`connections/${name}`)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(c)) {
    if (key === "encrypted_credentials") continue;
    console.log(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
}

export async function connectionCreate(options: {
  name: string;
  type: string;
  accessKey?: string;
  secretKey?: string;
  keyfile?: string;
  projectId?: string;
  tenantId?: string;
  account?: string;
  token?: string;
  host?: string;
}): Promise<void> {
  const body: Record<string, unknown> = { name: options.name, type: options.type };
  const fs = await import("node:fs");
  switch (options.type) {
    case "aws":
      body.access_key_id = options.accessKey;
      body.secret_access_key = options.secretKey;
      break;
    case "gcp":
      body.gcp_project_id = options.projectId;
      body.keyfile_json = options.keyfile !== undefined ? fs.readFileSync(options.keyfile, "utf8") : undefined;
      break;
    case "azure":
      body.client_id = options.accessKey;
      body.client_secret = options.secretKey;
      body.subscription_id = options.projectId;
      body.tenant_id = options.tenantId;
      break;
    case "r2":
      body.account_id = options.account;
      body.access_key_id = options.accessKey;
      body.secret_access_key = options.secretKey;
      break;
    case "github":
      body.access_token = options.token;
      break;
    default:
      console.error(`Unknown connection type: ${options.type}`);
      process.exitCode = 1;
      return;
  }
  const created = (await request("connections", { method: "POST", body })) as {
    name: string;
    type: string;
  };
  console.log(`Connection created: ${created.name} (${created.type})`);
}

export async function connectionDelete(name: string): Promise<void> {
  await request(`connections/${name}`, { method: "DELETE" });
  console.log(`Connection ${name} deleted.`);
}
