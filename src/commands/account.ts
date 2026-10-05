import {
  getActiveAccount,
  listAccounts,
  readActive,
  readAuth,
  writeActive,
} from "../config/store.js";
import { ensureFreshAccessToken, login, logout } from "../auth/oauth.js";
import { request } from "../api/client.js";

function redact(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

export async function accountLogin(): Promise<void> {
  const { email } = await login();
  console.log(`Logged in as ${email}.`);
}

export async function accountLogout(): Promise<void> {
  const account = await getActiveAccount();
  if (account === null) {
    console.error("No logged-in account.");
    process.exitCode = 1;
    return;
  }
  await logout(account);
  console.log(`Logged out ${account}.`);
}

export async function accountList(): Promise<void> {
  const accounts = await listAccounts();
  const active = await getActiveAccount();
  if (accounts.length === 0) {
    console.log("No accounts logged in. Run `solti account login`.");
    return;
  }
  for (const account of accounts) {
    const marker = account === active ? "*" : " ";
    console.log(`${marker} ${account}`);
  }
}

export async function accountSwitch(email: string): Promise<void> {
  const accounts = await listAccounts();
  if (!accounts.includes(email)) {
    console.error(`Account ${email} is not logged in locally. Run \`solti account login\` first.`);
    process.exitCode = 1;
    return;
  }
  const active = await readActive();
  await writeActive({ ...active, active_account: email });
  console.log(`Switched to ${email}.`);
}

export async function accountShow(email?: string): Promise<void> {
  const account = email ?? (await getActiveAccount());
  if (account === null || account === undefined) {
    console.error("No logged-in account. Run `solti account login` or pass an email.");
    process.exitCode = 1;
    return;
  }

  const auth = await readAuth(account);
  if (auth === null) {
    console.error(`Account ${account} is not logged in locally.`);
    process.exitCode = 1;
    return;
  }

  // Refresh proactively so `expires_at` shown to the user is accurate.
  let tokenPreview: string;
  let expiresAt: string;
  try {
    const token = await ensureFreshAccessToken(account);
    tokenPreview = redact(token);
    expiresAt = (await readAuth(account))?.expires_at ?? auth.expires_at;
  } catch (error) {
    tokenPreview = redact(auth.access_token);
    expiresAt = auth.expires_at;
    console.error(`(warning: ${(error as Error).message})`);
  }

  console.log(`Account:  ${account}`);
  console.log(`Token:    ${tokenPreview} (expires ${expiresAt})`);

  // Organization memberships come from the global account API (WS2).
  try {
    const accountInfo = (await request("account", { global: true })) as {
      email?: string;
      organizations?: Array<{ id: string; name?: string; role?: string }>;
    };
    if (accountInfo.organizations !== undefined && accountInfo.organizations.length > 0) {
      console.log("Organizations:");
      for (const organization of accountInfo.organizations) {
        console.log(`  - ${organization.name ?? organization.id}${organization.role !== undefined ? ` (${organization.role})` : ""}`);
      }
    }
  } catch {
    console.log("Organizations: (unavailable — account API not reachable)");
  }
}
