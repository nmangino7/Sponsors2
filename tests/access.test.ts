import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAccess, isAllowedEmail, authConfigured } from "../app/api/access.ts";

const configured = { AZURE_AD_CLIENT_ID: "id", AZURE_AD_CLIENT_SECRET: "s", AZURE_AD_TENANT_ID: "t", NEXTAUTH_SECRET: "n" };

test("fails closed in production when sign-in isn't configured", () => {
  const d = decideAccess({ user: { email: "nick@fingyms.com" } }, { NODE_ENV: "production" });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.status, 503);
});

test("AUTH_DISABLED only works outside production", () => {
  assert.equal(decideAccess(null, { NODE_ENV: "development", AUTH_DISABLED: "1" }).ok, true);
  assert.equal(decideAccess(null, { NODE_ENV: "production", AUTH_DISABLED: "1" }).ok, false);
});

test("no session -> 401; outside account -> 403; team account -> allowed", () => {
  const env = { NODE_ENV: "production", ...configured };
  const none = decideAccess(null, env);
  assert.equal(!none.ok && none.status, 401);
  const outsider = decideAccess({ user: { email: "someone@gmail.com" } }, env);
  assert.equal(!outsider.ok && outsider.status, 403);
  const nick = decideAccess({ user: { email: "Nicholas.Mangino@FinGyms.com", name: "Nick" } }, env);
  assert.deepEqual(nick, { ok: true, user: { email: "nicholas.mangino@fingyms.com", name: "Nick" } });
});

test("allowlist: default team domains, overrides, and explicit addresses", () => {
  assert.equal(isAllowedEmail("autumn@fingyms.com", {}), true);
  assert.equal(isAllowedEmail("lexi@floridafa.com", {}), true);
  assert.equal(isAllowedEmail("x@gmail.com", {}), false);
  assert.equal(isAllowedEmail("x@fingyms.com", { ALLOWED_EMAIL_DOMAINS: "example.org" }), false);
  assert.equal(isAllowedEmail("guest@gmail.com", { ALLOWED_EMAILS: "guest@gmail.com" }), true);
  assert.equal(isAllowedEmail(null, {}), false);
  assert.equal(authConfigured(configured), true);
  assert.equal(authConfigured({ AZURE_AD_CLIENT_ID: "id" }), false);
});
