import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth-options";
import { authConfigured, decideAccess, devBypass } from "./access";

export interface AppUser {
  email: string;
  name: string | null;
}

/** Every data route starts with this: `const user = await requireUser(); if (user instanceof NextResponse) return user;` */
export async function requireUser(): Promise<AppUser | NextResponse> {
  const env = process.env;
  const session = devBypass(env) || !authConfigured(env) ? null : await getServerSession(authOptions);
  const d = decideAccess(session, env);
  if (d.ok) return d.user;
  return NextResponse.json({ error: d.error, authRequired: d.status === 401 }, { status: d.status });
}
