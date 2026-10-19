"use client";

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Pause, Play } from "lucide-react";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Server and hydration show a still; the animation starts after preferences load.
function serverReducedMotion() {
  return true;
}

/** A real, locally generated GIF with a still fallback and user pause control. */
export function OrbitAnimation() {
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    serverReducedMotion,
  );
  const playing = !paused && !reduced;
  return (
    <div className="orbit-animation" data-playing={playing}>
      <div
        className="orbit-animation-art"
        role="img"
        aria-label="Two linked orbits illustrate the connection between two birth charts"
      >
        {(["light", "dark"] as const).map((theme) => (
          <div key={theme} className={`orbit-theme-${theme}`}>
            <Image
              src={`/animations/connection-orbit-${theme}.gif`}
              alt=""
              width={320}
              height={176}
              unoptimized
              loading="eager"
              className="orbit-motion"
            />
            <Image
              src={`/animations/connection-orbit-${theme}-still.png`}
              alt=""
              width={320}
              height={176}
              loading="eager"
              className="orbit-still"
            />
          </div>
        ))}
      </div>
      <div className="orbit-animation-caption">
        <span>Two charts, one connection.</span>
        <button
          type="button"
          className="orbit-control"
          aria-label={paused ? "Play orbit animation" : "Pause orbit animation"}
          onClick={() => setPaused(!paused)}
        >
          {paused ? (
            <Play size={13} aria-hidden />
          ) : (
            <Pause size={13} aria-hidden />
          )}
          <span>{paused ? "Play" : "Pause"}</span>
        </button>
      </div>
    </div>
  );
}
