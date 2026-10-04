import { NextResponse } from "next/server";
import { getStore } from "../store";
import { requireUser } from "../guard";
import { friendlyError } from "../anthropic";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  try {
    const store = getStore();
    return NextResponse.json({ sponsors: await store.listSponsors(), memory: store.kind });
  } catch (err: unknown) {
    return NextResponse.json({ sponsors: [], error: friendlyError(err) }, { status: 500 });
  }
}
