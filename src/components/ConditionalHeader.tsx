'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';

export default function ConditionalHeader() {
  const pathname = usePathname();
  
  // Don't show the main header on RL Tracker and Analytics pages
  if (pathname === '/RLTracker' || pathname === '/analytics') {
    return null;
  }
  
  return <Header />;
} 