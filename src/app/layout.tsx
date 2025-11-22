import './globals.css';
import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

import Footer from '@/components/Footer';
import { LenisProvider } from '@/components/LenisProvider';

export const metadata: Metadata = {
  title: 'Zach Robertson — Hardware & Software Integration',
  description:
    'Hardware/software integration engineer building immersive systems that bridge physical product, embedded firmware, and cloud orchestration.',
  openGraph: {
    title: 'Zach Robertson — Hardware & Software Integration',
    description:
      'Hardware/software integration engineer building immersive systems that bridge physical product, embedded firmware, and cloud orchestration.',
    url: 'https://zachrobertson.co',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="relative min-h-screen bg-[#040705] text-[#f5f8f1] antialiased">
        <LenisProvider>
          <main className="pt-0">{children}</main>
          <Footer />
          <SpeedInsights />
          <Analytics />
        </LenisProvider>
      </body>
    </html>
  );
}
