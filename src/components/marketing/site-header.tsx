"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#reading", label: "Your reading" },
  { href: "#privacy", label: "Privacy" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting)
            setActive(entry.target.id ? "#" + entry.target.id : "");
        }
      },
      { rootMargin: "-20% 0px -45% 0px", threshold: 0 },
    );
    for (const link of NAV_LINKS) {
      const section = document.querySelector(link.href);
      if (section) observer.observe(section);
    }
    document
      .querySelectorAll(
        ".celestial-hero, .faq-section, .closing-section, .site-footer",
      )
      .forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !header.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const closeMenu = () => {
    setOpen(false);
    menuButton.current?.focus();
  };
  return (
    <header
      ref={header}
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) closeMenu();
      }}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <nav aria-label="Main" className="site-container header-inner">
        <Link href="/" aria-label="AstraPair home">
          <LogoLockup />
        </Link>
        <div className="desktop-nav">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={active === link.href ? "location" : undefined}
              onClick={() => setActive(link.href)}
            >
              {active === link.href && (
                <motion.span
                  className="nav-active-background"
                  layoutId="nav-active"
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 350, damping: 30 }
                  }
                />
              )}
              <span>{link.label}</span>
            </a>
          ))}
        </div>
        <div className="header-actions">
          <ThemeToggle />
          <Link href="/login" className="header-sign-in">
            Sign in
          </Link>
          <Link href="/signup" className="header-cta">
            <span>Get started</span>
            <ArrowUpRight size={16} strokeWidth={1.75} aria-hidden />
          </Link>
          <button
            ref={menuButton}
            type="button"
            className="mobile-menu-button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls={open ? "mobile-navigation" : undefined}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.nav
            id="mobile-navigation"
            aria-label="Mobile"
            className="mobile-navigation"
            initial={reduced ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeMenu();
            }}
          >
            {NAV_LINKS.map((link) => (
              <a
                href={link.href}
                key={link.href}
                onClick={() => {
                  setActive(link.href);
                  setOpen(false);
                }}
              >
                {link.label}
                <ArrowUpRight size={16} aria-hidden />
              </a>
            ))}
            <Link href="/login" onClick={() => setOpen(false)}>
              Sign in
              <ArrowUpRight size={16} aria-hidden />
            </Link>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
