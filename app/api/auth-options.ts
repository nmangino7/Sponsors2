import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { authConfigured, isAllowedEmail } from "./access";

// Microsoft sign-in against FGA's own tenant (single-tenant). Teammates from other
// orgs (e.g. floridafa.com) are added as guests in that tenant — no code change needed.
const env = process.env;

type MsProfile = { email?: string; preferred_username?: string; upn?: string } | undefined;
const msEmail = (p: MsProfile) => p?.email ?? p?.preferred_username ?? p?.upn ?? null;

export const authOptions: NextAuthOptions = {
  providers: authConfigured(env)
    ? [AzureADProvider({ clientId: env.AZURE_AD_CLIENT_ID!, clientSecret: env.AZURE_AD_CLIENT_SECRET!, tenantId: env.AZURE_AD_TENANT_ID })]
    : [],
  secret: env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  callbacks: {
    async signIn({ user, profile }) {
      return isAllowedEmail(user?.email ?? msEmail(profile as MsProfile), env);
    },
    async jwt({ token, profile }) {
      // Guest accounts often carry the address in preferred_username, not email.
      if (profile && !token.email) token.email = msEmail(profile as MsProfile);
      return token;
    },
  },
};
