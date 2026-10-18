import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe slice of the auth configuration. It deliberately contains no
 * database or Node-only imports so that it can power the proxy (middleware).
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
