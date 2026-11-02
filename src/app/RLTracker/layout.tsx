import type { Viewport } from 'next';

// Lets env(safe-area-inset-*) report real values on iOS for the fixed goal bar.
export const viewport: Viewport = { viewportFit: 'cover' };

export default function RLTrackerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
