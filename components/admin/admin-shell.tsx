"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  CalendarCheck,
  Image as ImageIcon,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/services", label: "Services", icon: Sparkles },
  { href: "/admin/add-ons", label: "Add-ons", icon: Plus },
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
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes — otherwise tapping a
  // nav link would leave the menu open over the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close on Escape and lock body scroll while the drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

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

  // Sidebar contents — rendered in two places: as a permanent sidebar on
  // desktop, and inside the slide-in drawer on mobile.
  const sidebarBody = (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border">
        <Link href="/" className="text-headline-md font-extrabold uppercase tracking-tighter block">
          {siteConfig.name}
        </Link>
        <span className="text-label-tech text-primary">Admin</span>
      </div>
      <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
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
      <div className="p-4 border-t border-border">
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
    </div>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      {/* Mobile top bar — only visible below md. Hosts the burger trigger. */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-surface-container-lowest border-b border-border">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          aria-controls="admin-mobile-drawer"
          className="w-10 h-10 flex items-center justify-center border border-border text-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <Menu size={18} />
        </button>
        <Link
          href="/admin"
          className="text-headline-md font-extrabold uppercase tracking-tighter"
        >
          {siteConfig.shortName} <span className="text-primary">Admin</span>
        </Link>
        {/* Spacer to keep the title visually centered between the burger and a
            same-width invisible element on the right. */}
        <span className="w-10 h-10" aria-hidden="true" />
      </header>

      {/* Permanent sidebar (desktop only). */}
      <aside className="hidden md:block border-r border-border bg-surface-container-lowest">
        {sidebarBody}
      </aside>

      {/* Mobile drawer + scrim. Always mounted so CSS can transition both
          directions cleanly (no JS mount/unmount choreography needed). */}
      <div
        className={`fixed inset-0 z-40 bg-surface/70 backdrop-blur md:hidden transition-opacity duration-200 ${
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="admin-mobile-drawer"
        role="dialog"
        aria-modal={mobileOpen ? true : undefined}
        aria-hidden={!mobileOpen}
        aria-label="Admin navigation"
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-surface-container-lowest border-r border-border md:hidden flex flex-col transition-transform duration-250 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center text-foreground-muted hover:text-foreground"
        >
          <X size={18} />
        </button>
        {sidebarBody}
      </aside>

      {/* Content */}
      <main className="p-6 md:p-12 overflow-y-auto">{children}</main>
    </div>
  );
}
