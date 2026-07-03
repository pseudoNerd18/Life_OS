"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid, Sparkles, Calendar, NotebookText,
  Target, Settings as SettingsIcon, Sun, Moon, LogOut,
} from "lucide-react";
import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useMounted } from "@/components/util/client-only";
import type { CurrentUser } from "@/lib/session";

const nav = [
  { href: "/dashboard", label: "Today",     icon: LayoutGrid },
  { href: "/assistant", label: "Assistant", icon: Sparkles },
  { href: "/calendar",  label: "Calendar",  icon: Calendar },
  { href: "/notes",     label: "Notes",     icon: NotebookText },
  { href: "/goals",     label: "Goals",     icon: Target },
];

export function Sidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  const mounted = useMounted();
  const { resolvedTheme, setTheme } = useTheme();
  // Until mounted, next-themes can't know the theme — render a deterministic
  // default so server and first client paint agree. After mount, the real
  // resolved theme drives the icon.
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-background flex flex-col h-screen sticky top-0">
      <div className="px-5 pt-6 pb-4">
        <Link href="/" className="inline-flex items-baseline gap-1.5 group">
          <span className="font-display text-2xl italic leading-none">Life</span>
          <span className="font-display text-2xl italic leading-none text-muted-foreground group-hover:text-foreground transition-colors">
            OS
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-2 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-secondary rounded-md"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon className="h-4 w-4 relative z-10" strokeWidth={1.75} />
              <span className="relative z-10">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-2 py-2 space-y-0.5">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
            pathname === "/settings"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          <SettingsIcon className="h-4 w-4" strokeWidth={1.75} />
          Settings
        </Link>

        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          disabled={!mounted}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors disabled:opacity-60"
          aria-label="Toggle theme"
        >
          {isDark ? (
            <Sun className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <Moon className="h-4 w-4" strokeWidth={1.75} />
          )}
          {isDark ? "Light mode" : "Dark mode"}
        </button>
      </div>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 rounded-md p-2">
          <Avatar>
            <AvatarFallback>
              {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">{user.name ?? user.email}</p>
            {user.name && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            aria-label="Sign out"
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  );
}
