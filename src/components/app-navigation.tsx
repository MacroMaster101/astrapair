"use client";

import { CircleHelp, HeartHandshake, Orbit, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/chart", label: "Chart", icon: Orbit },
  { href: "/partner", label: "Partner", icon: HeartHandshake },
  { href: "/ask", label: "Ask", icon: CircleHelp },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNavigation() {
  const pathname = usePathname();
  return (
    <div className="app-nav-links">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={
            pathname === link.href || pathname.startsWith(link.href + "/")
              ? "page"
              : undefined
          }
        >
          <link.icon size={16} strokeWidth={1.5} aria-hidden />
          <span>{link.label}</span>
        </Link>
      ))}
    </div>
  );
}
