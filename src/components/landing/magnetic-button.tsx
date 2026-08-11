"use client";
import { useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";
import { useMounted } from "@/components/util/client-only";

interface Props {
  children: ReactNode;
  variant?: "primary" | "ghost";
  href?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Cursor-following button.
 *
 * Hydration safety: before mount we render a plain, static <a>/<button> with
 * identical classes — zero motion, zero divergence. After mount the magnetic
 * version takes over. The two are visually identical at rest, so there's no
 * flash.
 */
export function MagneticButton({ children, variant = "primary", className, href, onClick }: Props) {
  const mounted = useMounted();

  const baseClass = cn(
    "relative inline-flex items-center justify-center gap-2 px-7 py-3 text-sm font-medium",
    "rounded-full transition-all duration-300 active:scale-[0.97]",
    variant === "primary"
      ? "bg-foreground text-background hover:shadow-[0_10px_30px_-10px_rgba(20,15,12,0.5)]"
      : "border border-border text-foreground hover:bg-secondary",
    className,
  );

  if (!mounted) {
    const content = <span className="inline-flex items-center gap-2">{children}</span>;
    return href ? (
      <a href={href} className={cn(baseClass, "inline-flex")}>{content}</a>
    ) : (
      <button onClick={onClick} className={baseClass}>{content}</button>
    );
  }

  return (
    <MagneticInner variant={variant} href={href} onClick={onClick} className={baseClass}>
      {children}
    </MagneticInner>
  );
}

function MagneticInner({
  children, variant, href, onClick, className,
}: {
  children: ReactNode;
  variant: "primary" | "ghost";
  href?: string;
  onClick?: () => void;
  className: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 300, damping: 20 });
  const sy = useSpring(y, { stiffness: 300, damping: 20 });
  const [hover, setHover] = useState(false);

  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.4);
  }
  function handleLeave() {
    x.set(0); y.set(0); setHover(false);
  }

  const inner = (
    <motion.button
      ref={ref}
      style={{ x: sx, y: sy }}
      onMouseMove={handleMove}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={handleLeave}
      onClick={onClick}
      className={className}
    >
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      {variant === "primary" && hover && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full opacity-30 blur-xl bg-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.25 }}
          exit={{ opacity: 0 }}
        />
      )}
    </motion.button>
  );

  return href ? <a href={href} className="inline-block">{inner}</a> : inner;
}
