import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth-options";
import { authConfigured, decideAccess, devBypass } from "../access";
import { getStore } from "../store";

export const dynamic = "force-dynamic";

// Tells the UI whether to show the sign-in screen and the "memory not connected" banner.
export async function GET() {
  const env = process.env;
  const configured = authConfigured(env);
  const session = devBypass(env) || !configured ? null : await getServerSession(authOptions);
  const d = decideAccess(session, env);
  return NextResponse.json({
    user: d.ok ? d.user : null,
    error: d.ok ? null : d.error,
    status: d.ok ? 200 : d.status,
    authConfigured: configured,
    devBypass: devBypass(env),
    memory: getStore().kind,
    aiKey: !!env.ANTHROPIC_API_KEY, // the paid Claude API writer is only offered when a key is set
  });
}
