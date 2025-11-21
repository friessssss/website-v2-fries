import React from "react";
import "./globals.css";
import clsx from "clsx";
import type { Metadata } from "next";
import { Urbanist } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/react";

import SiteHeader from "@/components/navigation/SiteHeader";
import SiteFooter from "@/components/navigation/SiteFooter";
import { getSiteSettings } from "@/lib/content";

const urbanist = Urbanist({ subsets: ["latin"], variable: "--font-display" });

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();

  return {
    title: settings.siteTitle,
    description: settings.siteDescription,
    keywords: settings.metaKeywords,
    openGraph: {
      title: settings.siteTitle,
      description: settings.siteDescription,
      images: settings.ogImageUrl ? [{ url: settings.ogImageUrl }] : undefined,
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getSiteSettings();

  return (
    <html lang="en">
      <body
        className={clsx(
          urbanist.variable,
          "relative min-h-screen bg-ink text-sand antialiased",
        )}
        style={
          {
            "--accent-fancy": settings.fancyAccent ?? "#F15A24",
            "--accent-simple": settings.simpleAccent ?? "#2563eb",
          } as React.CSSProperties
        }
      >
        <div className="fixed inset-0 -z-10 bg-grid opacity-[0.12]" aria-hidden />
        <div className="noise pointer-events-none fixed inset-0 -z-[5] opacity-40" />
        <SiteHeader settings={settings} />
        <main>{children}</main>
        <SpeedInsights />
        <Analytics />
        <SiteFooter settings={settings} />
      </body>
    </html>
  );
}