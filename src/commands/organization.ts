import { request } from "../api/client.js";

export async function organizationList(): Promise<void> {
  const { organizations } = (await request("organizations", { global: true })) as {
    organizations: Array<{ id: string; displayName?: string; category?: string; role?: string }>;
  };
  if (organizations.length === 0) {
    console.log("No organizations. Create one with `solti organization create <name>`.");
    return;
  }
  for (const org of organizations) {
    console.log(`${org.id}  ${org.displayName ?? "(unnamed)"}${org.role ? `  (${org.role})` : ""}`);
  }
}

export async function organizationCreate(name: string): Promise<void> {
  const org = (await request("organizations", {
    method: "POST",
    global: true,
    body: { name, category: "personal" },
  })) as { id: string; displayName: string };
  console.log(`Organization created: ${org.displayName} (${org.id})`);
}

export async function organizationShow(orgIdOrName: string): Promise<void> {
  // Resolve by id directly, otherwise by display name.
  const { organizations } = (await request("organizations", { global: true })) as {
    organizations: Array<{ id: string; displayName?: string }>;
  };
  const org =
    organizations.find((o) => o.id === orgIdOrName) ??
    organizations.find((o) => o.displayName === orgIdOrName);
  if (org === undefined) {
    console.error(`Organization ${orgIdOrName} not found.`);
    process.exitCode = 1;
    return;
  }
  const detail = (await request(`organizations/${org.id}`, { global: true })) as {
    id: string;
    displayName?: string;
    category?: string;
    role?: string;
  };
  const members = (await request(`organizations/${org.id}/members`, { global: true }).catch(
    () => null,
  )) as { members?: Array<{ email?: string; role?: string }> } | null;

  console.log(`Organization: ${detail.displayName ?? "(unnamed)"}`);
  console.log(`ID:           ${detail.id}`);
  console.log(`Category:     ${detail.category ?? "—"}`);
  console.log(`Your role:    ${detail.role ?? "—"}`);
  if (members?.members?.length) {
    console.log("Members:");
    for (const member of members.members) {
      console.log(`  - ${member.email ?? "(unknown)"}${member.role ? ` (${member.role})` : ""}`);
    }
  }
}

export async function organizationDelete(orgIdOrName: string, options: { yes?: boolean } = {}): Promise<void> {
  const { organizations } = (await request("organizations", { global: true })) as {
    organizations: Array<{ id: string; displayName?: string }>;
  };
  const org = organizations.find((o) => o.id === orgIdOrName) ?? organizations.find((o) => o.displayName === orgIdOrName);
  if (org === undefined) {
    console.error(`Organization ${orgIdOrName} not found.`);
    process.exitCode = 1;
    return;
  }
  const confirmed = options.yes === true;
  if (!confirmed) {
    console.error(
      `This permanently deletes ${org.displayName ?? org.id} and all its projects. Re-run with --yes to confirm.`,
    );
    process.exitCode = 1;
    return;
  }
  await request(`organizations/${org.id}`, { method: "DELETE", global: true });
  console.log(`Organization ${org.displayName ?? org.id} deleted.`);
}
