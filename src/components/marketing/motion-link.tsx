"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion, useMotionValue, useSpring } from "motion/react";
import { useReducedMotion } from "./use-reduced-motion";

export function MotionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 200, damping: 18 });
  const springY = useSpring(y, { stiffness: 200, damping: 18 });
  return (
    <motion.span
      className="motion-link-wrap"
      style={{ x: reduced ? 0 : springX, y: reduced ? 0 : springY }}
      onPointerMove={(event) => {
        if (reduced || event.pointerType !== "mouse") return;
        const rect = event.currentTarget.getBoundingClientRect();
        x.set((event.clientX - rect.left - rect.width / 2) * 0.045);
        y.set((event.clientY - rect.top - rect.height / 2) * 0.1);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      <Link href={href} className="celestial-button">
        {children}
      </Link>
    </motion.span>
  );
}
