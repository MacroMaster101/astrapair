"use client";

import { motion } from "motion/react";
import { useReducedMotion } from "./use-reduced-motion";

/** Fades content up as it enters the viewport, once. Static and fully visible under reduced motion, once the setting is read. */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li";
}) {
  const reduce = useReducedMotion();
  const Component = as === "li" ? motion.li : motion.div;
  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: 36 }}
      animate={reduce ? { opacity: 1, y: 0 } : undefined}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.85, delay, ease: [0.16, 1, 0.3, 1] }
      }
    >
      {children}
    </Component>
  );
}
