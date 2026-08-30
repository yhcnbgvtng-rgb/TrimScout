// Auth.js v5 config — Credentials (email/password) + Google.
//
// No DB adapter here on purpose: Credentials sign-in can't work through
// Auth.js's standard adapter flow (it has no concept of a password), so the
// common pattern — and the one used here — is to skip the adapter entirely
// and do the user lookup/creation yourself, via the box's auth API
// (lib/authApi.ts) rather than a direct DB connection (see that file's own
// header comment for why). Sessions are JWT-based, so no `sessions` table
// is needed either.
//
// Google is wired in below but stays inert until real credentials land in
// Vercel's env. Apple was deliberately left out — it requires a paid
// ($99/yr) Apple Developer account; the `user_accounts.provider` enum still
// has an 'apple' value reserved if this changes later, but nothing in the
// app currently offers it.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { verifyCredentials, oauthUpsert, type AuthUser } from "./lib/authApi";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    // The app has its own AuthModal rather than a dedicated Auth.js page;
    // errors redirect to home with a query param the modal can read.
    error: "/",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;
        try {
          const user = await verifyCredentials(email, password);
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.avatarUrl,
            role: user.role,
            phone: user.phone,
            zipCode: user.zipCode,
            dealerName: user.dealerName,
          };
        } catch {
          // Wrong password / unknown email / suspended account — Auth.js
          // treats a null return as "invalid credentials" uniformly, which
          // is the right behavior here (never reveal *why* sign-in failed).
          return null;
        }
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") {
        return true; // Credentials already resolved a real user in authorize()
      }
      if (!user.email) return false;
      try {
        const resolved: AuthUser = await oauthUpsert({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          email: user.email,
          name: user.name || undefined,
          avatarUrl: user.image || undefined,
        });
        // Stash the real DB-backed fields onto the user object so the jwt
        // callback below (which only ever sees `user` on this first call)
        // can pick up id/role/etc. from our own table, not the OAuth
        // provider's profile.
        user.id = resolved.id;
        (user as any).role = resolved.role;
        (user as any).phone = resolved.phone;
        (user as any).zipCode = resolved.zipCode;
        (user as any).dealerName = resolved.dealerName;
        return true;
      } catch {
        return false;
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.phone = (user as any).phone;
        token.zipCode = (user as any).zipCode;
        token.dealerName = (user as any).dealerName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).phone = token.phone;
        (session.user as any).zipCode = token.zipCode;
        (session.user as any).dealerName = token.dealerName;
      }
      return session;
    },
  },
});
