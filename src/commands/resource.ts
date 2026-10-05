import { request } from "../api/client.js";

export async function resourceList(options: {
  type?: string;
  connection?: string;
}): Promise<void> {
  // API route for compute pools is /1/resources/virtual-machine-pools.
  const routeFor: Record<string, string> = {
    storages: "storages",
    repositories: "repositories",
    "vm-pools": "virtual-machine-pools",
  };
  const types = options.type !== undefined ? [options.type] : ["storages", "repositories", "vm-pools"];
  for (const type of types) {
    const query = new URLSearchParams();
    if (options.connection !== undefined) query.set("connection_id", options.connection);
    const qs = query.toString();
    const path = `resources/${routeFor[type] ?? type}${qs ? `?${qs}` : ""}`;
    const data = (await request(path)) as Record<string, Array<Record<string, unknown>>>;
    const key = Object.keys(data).find((k) => Array.isArray(data[k])) ?? "";
    const items = data[key] ?? [];
    console.log(`\n${type} (${items.length}):`);
    for (const item of items) {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const region = (metadata.region ?? metadata.location ?? "—") as string;
      console.log(`  - ${item.name}  [${item.platform}${region !== "—" ? ` · ${region}` : ""}]`);
    }
  }
}
