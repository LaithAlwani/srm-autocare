import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";

export default function AuthedAdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
