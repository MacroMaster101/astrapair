"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useReducedMotion } from "./use-reduced-motion";

export function CelestialScene() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const travel = useTransform(scrollYProgress, [0, 1], [0, 85]);
  const rotation = useTransform(scrollYProgress, [0, 1], [0, 5]);
  const y = useSpring(travel, { stiffness: 80, damping: 25 });
  return (
    <div ref={ref} className="hero-art">
      <motion.div
        className="celestial-scene"
        style={{ y: reduced ? 0 : y, rotate: reduced ? 0 : rotation }}
        initial={reduced ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <Image
          src="/images/celestial-pair.png"
          alt="Two luminous blue celestial spheres connected by a delicate orbit"
          fill
          priority
          sizes="(max-width: 767px) 100vw, 60vw"
          className="object-contain"
        />
      </motion.div>
    </div>
  );
}
