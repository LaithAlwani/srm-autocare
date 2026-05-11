"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  CalendarCheck,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Sparkles,
  Loader2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/services", label: "Services", icon: Sparkles },
  { href: "/admin/gallery", label: "Gallery", icon: ImageIcon },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/admin/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const me = useQuery(api.users.currentUser);

  // Loading user — show neutral splash so we don't flash unauthorized content.
  if (me === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center text-foreground-muted">
        <Loader2 className="animate-spin mr-3" size={20} /> Loading admin...
      </div>
    );
  }

  // Signed in but no admin role — show access denied (the proxy already blocks
  // unauthenticated users; this catches users without owner/admin role).
  if (!me || (me.role !== "owner" && me.role !== "admin")) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Container className="max-w-md text-center">
          <div className="gloss-card p-10">
            <h1 className="text-headline-lg uppercase mb-4">Access denied</h1>
            <p className="text-body-md text-foreground-muted mb-8">
              Your account isn't authorized for the admin portal. Contact the owner if you believe
              this is a mistake.
            </p>
            <Button
              variant="secondary"
              size="md"
              onClick={async () => {
                await signOut();
                router.push("/admin/login");
              }}
            >
              <LogOut size={14} /> Sign out
            </Button>
          </div>
        </Container>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="border-r border-border bg-surface-container-lowest">
        <div className="p-6 border-b border-border">
          <Link href="/" className="text-headline-md font-extrabold uppercase tracking-tighter block">
            {siteConfig.name}
          </Link>
          <span className="text-label-tech text-primary">Admin</span>
        </div>
        <nav className="p-4 space-y-1">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 text-label-tech transition-colors border-l-2 ${
                  active
                    ? "bg-primary-container/10 text-primary border-primary"
                    : "text-foreground-muted border-transparent hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border mt-auto">
          <p className="text-label-tech text-foreground-muted mb-3 truncate">{me.email}</p>
          <Button
            variant="ghost"
            size="sm"
            block
            onClick={async () => {
              await signOut();
              router.push("/admin/login");
            }}
          >
            <LogOut size={14} /> Sign out
          </Button>
        </div>
      </aside>

      {/* Content */}
      <main className="p-8 md:p-12 overflow-y-auto">{children}</main>
    </div>
  );
}
