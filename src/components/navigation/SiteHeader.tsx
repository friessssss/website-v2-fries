"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

import type { SiteSettings } from "@/types/content";

type SiteHeaderProps = {
  settings: SiteSettings;
};

const hiddenPaths = ["/RLTracker", "/analytics", "/analytics/songs"];

export default function SiteHeader({ settings }: SiteHeaderProps) {
  const pathname = usePathname();
  const navLinks = settings.navLinks ?? [];
  const contactHref = settings.contactEmail
    ? `mailto:${settings.contactEmail}`
    : "mailto:hi@zachrobertson.co";

  const isHidden = hiddenPaths.some((path) =>
    path === "/RLTracker" ? pathname === path : pathname.startsWith(path),
  );

  if (isHidden) {
    return null;
  }

  return (
    <header className="sticky top-4 z-40 mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-0">
      <div className="flex items-center justify-between rounded-full border border-white/15 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.15),_rgba(5,7,18,0.8))] px-5 py-3 text-xs font-semibold uppercase tracking-[0.35em] text-white shadow-[0.75rem_0.75rem_0_#04030a] backdrop-blur-2xl">
        <Link
          href="/"
          className="flex items-center gap-2 text-[0.72em]"
        >
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#ff4df2]" />
          Zach Robertson
        </Link>
        <nav className="hidden items-center gap-2 md:flex" aria-label="Primary">
          {navLinks.map((link) => (
            <NavLink key={link.label + link.href} link={link} />
          ))}
        </nav>
        <a
          href={contactHref}
          className="rounded-full bg-gradient-to-r from-[#ffae00] via-[#ffd727] to-[#c4ff4d] px-3 py-1 text-[0.65em] font-bold text-slate-900 shadow-[0.4rem_0.4rem_0_#020205] transition hover:-translate-y-0.5"
        >
          Say Hi
        </a>
      </div>
    </header>
  );
}

function NavLink({
  link,
}: {
  link: NonNullable<SiteSettings["navLinks"]>[number];
}) {
  const pathname = usePathname();
  const isExternal = link.href.startsWith("http") || link.href.startsWith("mailto:");
  const isActive =
    !isExternal &&
    (link.href === "/" ? pathname === "/" : pathname.startsWith(link.href));

  const baseClasses =
    "rounded-full px-3 py-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white text-[0.65em]";

  if (link.variant === "primary") {
    const accentClass = "bg-[var(--accent-fancy,#f15a24)] text-slate-950";
    return isExternal ? (
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        className={clsx(baseClasses, accentClass, "font-semibold")}
      >
        {link.label}
      </a>
    ) : (
      <Link href={link.href} className={clsx(baseClasses, accentClass, "font-semibold")}>
        {link.label}
      </Link>
    );
  }

  const defaultClasses = clsx(
    baseClasses,
    "text-white/60 hover:text-white",
    isActive && "bg-white/15 text-white shadow-[inset_0_0_20px_rgba(255,255,255,0.15)]",
  );

  if (isExternal) {
    return (
      <a href={link.href} target="_blank" rel="noreferrer" className={defaultClasses}>
        {link.label}
      </a>
    );
  }

  return (
    <Link href={link.href} className={defaultClasses}>
      {link.label}
    </Link>
  );
}

