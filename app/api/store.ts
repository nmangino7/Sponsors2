import type { Store } from "./store-model.ts";
import { MemoryStore } from "./memory-store.ts";
import { PgStore } from "./pg-store.ts";

// Kept on globalThis: Next bundles each route separately, and a module-level variable would
// give every route its own store (an empty MemoryStore per route; a schema check per route).
const g = globalThis as typeof globalThis & { __sponsorStore?: Store };

/** Postgres when DATABASE_URL is set (Vercel + Neon); otherwise an in-memory store that
 *  forgets everything on restart — the UI shows a banner so nobody mistakes it for memory. */
export function getStore(): Store {
  if (!g.__sponsorStore) g.__sponsorStore = process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new MemoryStore();
  return g.__sponsorStore;
}
