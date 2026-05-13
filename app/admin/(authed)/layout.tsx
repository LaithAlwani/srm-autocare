import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken, isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { api } from "@/convex/_generated/api";
import { AdminShell } from "@/components/admin/admin-shell";

// Server-side gate. Runs BEFORE any admin page renders, so non-admin users
// can never receive HTML for protected pages — not even the brief flash that
// a purely client-side guard would allow during query loading. Layered on top
// of:
//   1. proxy.ts — bounces unauthenticated requests away from /admin/*
//   2. AdminShell (client) — covers in-app navigation after this layout has
//      rendered, since this server check only runs on initial request.
//   3. convex requireAdmin() in every admin mutation — enforces the same
//      rule at the data layer, so even an authorized session can't escalate.
export default async function AuthedAdminLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthenticatedNextjs())) {
    redirect("/admin/login");
  }

  const me = await fetchQuery(
    api.users.currentUser,
    {},
    { token: await convexAuthNextjsToken() },
  );

  if (!me || (me.role !== "owner" && me.role !== "admin")) {
    // No HTML for protected pages leaves the server. The login page handles
    // the "access denied" messaging if the user lingers.
    redirect("/admin/login?denied=1");
  }

  return <AdminShell>{children}</AdminShell>;
}
