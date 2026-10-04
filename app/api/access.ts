// Who may use the app. Pure so it can be unit-tested without Next or next-auth.

export interface AccessEnv {
  NODE_ENV?: string;
  AUTH_DISABLED?: string;
  AZURE_AD_CLIENT_ID?: string;
  AZURE_AD_CLIENT_SECRET?: string;
  AZURE_AD_TENANT_ID?: string;
  NEXTAUTH_SECRET?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  ALLOWED_EMAILS?: string;
}

export interface SessionLike {
  user?: { email?: string | null; name?: string | null } | null;
}

export type AccessDecision =
  | { ok: true; user: { email: string; name: string | null } }
  | { ok: false; status: 401 | 403 | 503; error: string };

export const DEFAULT_ALLOWED_DOMAINS = "fingyms.com,floridafa.com,georgiafa.com";

const list = (v: string | undefined) => (v ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

export function authConfigured(env: AccessEnv): boolean {
  return !!(env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET && env.AZURE_AD_TENANT_ID && env.NEXTAUTH_SECRET);
}

export function devBypass(env: AccessEnv): boolean {
  return env.AUTH_DISABLED === "1" && env.NODE_ENV !== "production";
}

export function isAllowedEmail(email: string | null | undefined, env: AccessEnv): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (list(env.ALLOWED_EMAILS).includes(e)) return true;
  const domain = e.split("@")[1];
  const domains = list(env.ALLOWED_EMAIL_DOMAINS || DEFAULT_ALLOWED_DOMAINS);
  return !!domain && domains.includes(domain);
}

/** Fails closed: sponsor data is stored, so no sign-in configuration means no access. */
export function decideAccess(session: SessionLike | null, env: AccessEnv): AccessDecision {
  if (devBypass(env)) return { ok: true, user: { email: "dev@localhost", name: "Local dev" } };
  if (!authConfigured(env)) {
    return { ok: false, status: 503, error: "Sign-in isn't configured yet. Set the Azure AD and NEXTAUTH_SECRET environment variables in Vercel." };
  }
  const email = session?.user?.email;
  if (!email) return { ok: false, status: 401, error: "Please sign in." };
  if (!isAllowedEmail(email, env)) return { ok: false, status: 403, error: "This account isn't on the allowed list for the sponsor app." };
  return { ok: true, user: { email: email.toLowerCase(), name: session?.user?.name ?? null } };
}
