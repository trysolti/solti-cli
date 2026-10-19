import { request } from "../api/client.js";
import { getActiveAccount, readActive, writeActive } from "../config/store.js";

interface ProjectSummary {
  id: string;
  displayName?: string;
  organizationId: string;
}

async function listAllProjects(): Promise<ProjectSummary[]> {
  const { organizations } = (await request("organizations", { global: true })) as {
    organizations: Array<{ id: string; displayName?: string }>;
  };
  const all: ProjectSummary[] = [];
  for (const org of organizations) {
    const { projects } = (await request(`organizations/${org.id}/projects`, {
      global: true,
    })) as { projects: ProjectSummary[] };
    all.push(...projects);
  }
  return all;
}

export async function projectList(options: { org?: string }): Promise<void> {
  if (options.org !== undefined) {
    const { organizations } = (await request("organizations", { global: true })) as {
      organizations: Array<{ id: string; displayName?: string }>;
    };
    const org =
      organizations.find((o) => o.id === options.org) ??
      organizations.find((o) => o.displayName === options.org);
    if (org === undefined) {
      console.error(`Organization ${options.org} not found.`);
      process.exitCode = 1;
      return;
    }
    const { projects } = (await request(`organizations/${org.id}/projects`, {
      global: true,
    })) as { projects: ProjectSummary[] };
    printProjects(projects);
    return;
  }
  printProjects(await listAllProjects());
}

function printProjects(projects: ProjectSummary[]): void {
  if (projects.length === 0) {
    console.log("No projects. Create one with `solti project create <name> --org <org>`.");
    return;
  }
  for (const project of projects) {
    console.log(`${project.id}  ${project.displayName ?? "(unnamed)"}`);
  }
}

export async function projectCreate(
  name: string,
  options: { org: string },
): Promise<void> {
  const { organizations } = (await request("organizations", { global: true })) as {
    organizations: Array<{ id: string; displayName?: string }>;
  };
  const org =
    organizations.find((o) => o.id === options.org) ??
    organizations.find((o) => o.displayName === options.org);
  if (org === undefined) {
    console.error(`Organization ${options.org} not found.`);
    process.exitCode = 1;
    return;
  }
  const project = (await request(`organizations/${org.id}/projects`, {
    method: "POST",
    global: true,
    body: { name },
  })) as ProjectSummary;
  console.log(`Project created: ${project.displayName} (${project.id})`);
}

export async function projectShow(projectId: string): Promise<void> {
  const project = (await request(`projects/${projectId}`, { global: true })) as ProjectSummary;
  console.log(`Project:         ${project.displayName ?? "(unnamed)"}`);
  console.log(`ID:              ${project.id}`);
  console.log(`Organization ID: ${project.organizationId}`);
}

export async function projectUse(projectId: string): Promise<void> {
  const account = await getActiveAccount();
  if (account === null) {
    console.error("No logged-in account. Run `solti account login` first.");
    process.exitCode = 1;
    return;
  }
  // Validate access before switching.
  await request(`projects/${projectId}`, { global: true });
  const active = await readActive();
  const profileName = process.env.SOLTI_PROFILE ?? active.active_profile;
  if (profileName !== null && profileName !== undefined) {
    const { readProfile, writeProfile } = await import("../config/store.js");
    const config = await readProfile(account, profileName);
    await writeProfile(account, profileName, {
      project_id: projectId,
      api_key: config?.api_key ?? null,
      api_url: config?.api_url ?? null,
    });
  } else {
    await writeActive({ ...active, active_profile: "default" });
    const { writeProfile } = await import("../config/store.js");
    await writeProfile(account, "default", { project_id: projectId, api_key: null, api_url: null });
  }
  console.log(`Active project set to ${projectId}.`);
  // Change 033 D-1: the shared global host scopes requests via the
  // X-Solti-Project-Id header; per-project wildcard hosts are not deployed.
  console.log(`API base URL: https://api.solti.run/1`);
}

export async function projectDelete(projectId: string, options: { yes?: boolean } = {}): Promise<void> {
  if (!options.yes) {
    console.error("This permanently deletes the project. Re-run with --yes to confirm.");
    process.exitCode = 1;
    return;
  }
  await request(`projects/${projectId}`, { method: "DELETE", global: true });
  console.log(`Project ${projectId} deleted.`);
}
