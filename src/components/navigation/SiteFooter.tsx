import Link from "next/link";

import type { SiteSettings } from "@/types/content";

type FooterProps = {
  settings: SiteSettings;
};

export default function SiteFooter({ settings }: FooterProps) {
  const footerLinks = settings.footerLinks ?? [];

  return (
    <footer className="relative mt-24 border-t border-white/5 bg-black/60 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/60">
            Zach Robertson
          </p>
          <p className="text-base text-white/80">
            {settings.siteDescription ??
              "Engineer crafting fancy web things, RL telemetry, and sonic UI toys."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {footerLinks.map((link) => (
            <FooterLink key={link.href + link.label} label={link.label} href={link.href} />
          ))}
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ label, href }: { label: string; href: string }) {
  const isExternal = href.startsWith("http") || href.startsWith("mailto:");

  const base =
    "rounded-full border border-white/10 px-3 py-1 text-white/70 transition hover:border-white/40 hover:text-white";

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={base}>
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className={base}>
      {label}
    </Link>
  );
}

