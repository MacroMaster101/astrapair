"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The brand mark held between two slowly counter-rotating orbits: two charts
 * moving around a shared centre. Static under prefers-reduced-motion.
 */
export function OrbitVisual({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const spin = (seconds: number, direction: 1 | -1) =>
    reduce
      ? {}
      : {
          animate: { rotate: 360 * direction },
          transition: {
            duration: seconds,
            repeat: Infinity,
            ease: "linear" as const,
          },
        };

  return (
    <div className={cn("relative aspect-square w-full", className)} aria-hidden>
      <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--primary)_45%,transparent),transparent_70%)] blur-2xl" />

      <motion.div className="absolute inset-[4%]" {...spin(90, 1)}>
        <div className="absolute inset-0 rounded-full border border-border" />
        <span className="absolute top-[6%] left-[22%] size-3 rounded-full bg-primary shadow-[0_0_16px_4px] shadow-primary/50" />
      </motion.div>

      <motion.div className="absolute inset-[16%]" {...spin(60, -1)}>
        <div className="absolute inset-0 rounded-full border border-dashed border-border" />
        <span className="absolute right-[4%] bottom-[24%] size-2.5 rounded-full bg-brand-violet shadow-[0_0_14px_4px] shadow-brand-violet/50" />
      </motion.div>

      <motion.div
        className="absolute inset-[26%]"
        initial={reduce ? false : { opacity: 0, scale: 0.9 }}
        animate={reduce ? undefined : { opacity: 1, scale: 1, y: [0, -8, 0] }}
        transition={{
          opacity: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
          scale: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
          y: { duration: 6, repeat: Infinity, ease: "easeInOut" },
        }}
      >
        <Image
          src="/brand/astrapair-mark.webp"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 280px, 50vw"
          className="object-contain drop-shadow-[0_12px_40px_rgb(90_70_255/0.45)]"
        />
      </motion.div>
    </div>
  );
}
