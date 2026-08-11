import Link from "next/link";
import { ArrowRight, ArrowDown } from "lucide-react";
import { ScrollspyNav } from "@/components/landing/scrollspy-nav";
import { MagneticButton } from "@/components/landing/magnetic-button";
import { LiveDemo } from "@/components/landing/live-demo";
import { CapabilitiesGrid } from "@/components/landing/capabilities-grid";
import { SystemDiagram } from "@/components/landing/system-diagram";

export default function Landing() {
  return (
    <div className="bg-background text-foreground overflow-x-clip">
      <ScrollspyNav />

      <Hero />
      <Demo />
      <Capabilities />
      <System />
      <Closing />
      <Footer />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   1. HERO — full viewport. Editorial serif headline,
   ambient gradient, magnetic CTA. Pure first impression.
   ──────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section
      id="hero"
      className="relative min-h-screen flex items-center grain"
    >
      {/* Layered ambient backgrounds */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, hsl(var(--foreground)/0.04), transparent 60%), radial-gradient(40% 40% at 80% 80%, hsl(var(--foreground)/0.03), transparent 70%)",
        }}
      />

      <div className="container max-w-5xl relative z-10 pt-32 pb-20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/70 bg-card/60 backdrop-blur-sm text-xs text-muted-foreground mb-10">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
          Local-first · No sign-in required
        </div>

        <h1 className="font-display text-[clamp(3.5rem,9vw,8rem)] leading-[0.95] tracking-tight">
          <span className="block">An assistant</span>
          <span className="block italic text-muted-foreground">that organizes</span>
          <span className="block">the life you already have.</span>
        </h1>

        <p className="mt-10 max-w-xl text-lg text-muted-foreground leading-relaxed">
          Type or speak the way you&apos;d talk to a friend. Life OS turns intent
          into tasks, goals, and a calendar — without forms, without friction.
        </p>

        <div className="mt-12 flex items-center gap-4 flex-wrap">
          <MagneticButton href="/dashboard">
            Open workspace
            <ArrowRight className="h-4 w-4" />
          </MagneticButton>
          <MagneticButton variant="ghost" href="#demo">
            See it in action
          </MagneticButton>
        </div>

        <div className="mt-16 flex items-center gap-8 text-xs text-muted-foreground font-mono">
          <span>0 setup</span>
          <span className="h-3 w-px bg-border" />
          <span>1 click in</span>
          <span className="h-3 w-px bg-border" />
          <span>∞ thoughts captured</span>
        </div>
      </div>

      <a
        href="#demo"
        aria-label="Scroll to demo"
        className="absolute bottom-10 left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowDown className="h-4 w-4 animate-bounce" strokeWidth={1.5} />
      </a>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   2. DEMO — the auto-playing conversation. The "aha".
   Generous space, soft surface.
   ──────────────────────────────────────────────────────────── */
function Demo() {
  return (
    <section
      id="demo"
      className="relative py-32 md:py-44 border-t border-border/40"
    >
      <div className="container max-w-5xl">
        <SectionHeader
          eyebrow="The conversation"
          title={<>Say it the way<br/><em className="italic text-muted-foreground">you actually think it.</em></>}
          lede="Life OS listens, parses, schedules — then steps back. You stay in flow."
        />

        <div className="mt-20">
          <LiveDemo />
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   3. CAPABILITIES — asymmetric grid, four cards.
   Slight off-white background to delineate from demo.
   ──────────────────────────────────────────────────────────── */
function Capabilities() {
  return (
    <section
      id="capabilities"
      className="relative py-32 md:py-44 bg-secondary/30 border-t border-border/40"
    >
      <div className="container max-w-5xl">
        <SectionHeader
          eyebrow="Capabilities"
          title={<>Designed for the way<br/><em className="italic text-muted-foreground">your day actually unfolds.</em></>}
          lede="Four primitives. Composable. Aware of each other. No app-switching."
        />

        <div className="mt-20">
          <CapabilitiesGrid />
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   4. SYSTEM — dark canvas. The architecture diagram.
   Differentiates radically from the other sections.
   ──────────────────────────────────────────────────────────── */
function System() {
  return (
    <section
      id="system"
      className="relative py-32 md:py-44 bg-neutral-950 text-neutral-100"
    >
      <div className="container max-w-5xl">
        <SectionHeader
          eyebrow="Under the hood"
          title={<>Private by default.<br/><em className="italic text-neutral-400">Self-hostable on purpose.</em></>}
          lede="The model runs on your machine. Your notes never leave your disk. Calendar sync is opt-in."
          tone="dark"
        />

        <div className="mt-20">
          <SystemDiagram />
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   5. CLOSING — single sentence, single button.
   ──────────────────────────────────────────────────────────── */
function Closing() {
  return (
    <section className="relative py-32 md:py-44 border-t border-border/40 grain">
      <div className="container max-w-3xl text-center relative">
        <h2 className="font-display text-[clamp(2.5rem,6vw,5rem)] leading-tight">
          Stop managing your tools.
          <br />
          <em className="italic text-muted-foreground">Just tell them what you want.</em>
        </h2>
        <div className="mt-12">
          <MagneticButton href="/dashboard">
            Open workspace
            <ArrowRight className="h-4 w-4" />
          </MagneticButton>
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          No sign-in. No card. Everything saved locally.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/40 py-10">
      <div className="container max-w-6xl flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <Link href="/" className="inline-flex items-baseline gap-1.5">
          <span className="font-display text-base italic">Life</span>
          <span className="font-display text-base italic">OS</span>
        </Link>
        <p>Open-source · Privacy-first · Self-hostable</p>
        <p>© {new Date().getFullYear()}</p>
      </div>
    </footer>
  );
}

/* Reusable section header — keeps spacing and rhythm consistent. */
function SectionHeader({
  eyebrow, title, lede, tone = "light",
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede: string;
  tone?: "light" | "dark";
}) {
  const muted = tone === "dark" ? "text-neutral-400" : "text-muted-foreground";
  return (
    <div className="max-w-3xl">
      <p className={`text-xs uppercase tracking-[0.2em] ${muted} font-mono`}>{eyebrow}</p>
      <h2 className="mt-5 font-display text-[clamp(2rem,5vw,4rem)] leading-[1.05] tracking-tight">
        {title}
      </h2>
      <p className={`mt-6 text-base md:text-lg ${muted} leading-relaxed max-w-xl`}>{lede}</p>
    </div>
  );
}
