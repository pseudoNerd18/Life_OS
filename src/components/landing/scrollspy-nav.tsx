"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useMounted } from "@/components/util/client-only";

const SECTIONS = [
  { id: "demo",         label: "See it" },
  { id: "capabilities", label: "Capabilities" },
  { id: "system",       label: "System" },
];

/**
 * Scrollspy navigation with sliding underline.
 *
 * Hydration safety:
 *  - Initial `active` and `scrolled` are deterministic constants ("hero",
 *    false) so server and first client render agree.
 *  - IntersectionObserver + scroll listener only attach after mount.
 *  - The sliding underline (Framer `layoutId`) only renders post-mount; before
 *    that we render a plain static underline so there's no layout jump.
 */
export function ScrollspyNav() {
  const mounted = useMounted();
  const [active, setActive] = useState<string>("hero");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const els = ["hero", ...SECTIONS.map((s) => s.id)]
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];
    if (!els.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [mounted]);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    setActive(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <header
      className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-300",
        scrolled
          ? "backdrop-blur-xl bg-background/70 border-b border-border/40"
          : "bg-transparent border-b border-transparent",
      )}
    >
      <div className="container max-w-6xl flex items-center justify-between h-16">
        <button
          onClick={() => scrollTo("hero")}
          className="inline-flex items-baseline gap-1.5"
          aria-label="Back to top"
        >
          <span className="font-display text-xl italic">Life</span>
          <span className="font-display text-xl italic text-muted-foreground">OS</span>
        </button>

        <nav className="hidden md:flex items-center gap-1">
          {SECTIONS.map((s) => {
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={cn(
                  "relative px-4 py-2 text-sm transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
                {isActive && (
                  mounted ? (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute left-3 right-3 -bottom-0.5 h-px bg-foreground"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  ) : (
                    <span className="absolute left-3 right-3 -bottom-0.5 h-px bg-foreground" />
                  )
                )}
              </button>
            );
          })}
        </nav>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium transition-all hover:bg-foreground/85 active:scale-[0.97]"
        >
          Open workspace
        </Link>
      </div>
    </header>
  );
}
