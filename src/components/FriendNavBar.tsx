'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function FriendNavBar() {
  const pathname = usePathname();

  return (
    <nav className="glass-panel border-b border-white/8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <h1 className="text-xl font-medium text-[#f5f8f1]">🎵 RL Tracker</h1>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 sm:space-x-4 md:space-x-8">
            <Link
              href="/RLTracker"
              className={`px-2 py-1 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors duration-200 ${
                pathname === '/RLTracker'
                  ? 'bg-white/10 text-[#f5f8f1]'
                  : 'text-white/60 hover:text-[#f5f8f1] hover:bg-white/5'
              }`}
            >
              🎮 Track Goals
            </Link>
            
            <Link
              href="/analytics"
              className={`px-2 py-1 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors duration-200 ${
                pathname === '/analytics'
                  ? 'bg-white/10 text-[#f5f8f1]'
                  : 'text-white/60 hover:text-[#f5f8f1] hover:bg-white/5'
              }`}
            >
              📊 Analytics
            </Link>
        
            <Link
              href="/analytics/songs"
              className={`px-2 py-1 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors duration-200 ${
                pathname === '/analytics/songs'
                  ? 'bg-white/10 text-[#f5f8f1]'
                  : 'text-white/60 hover:text-[#f5f8f1] hover:bg-white/5'
              }`}
            >
              🎵 All Songs
            </Link>
            
            <Link
              href="/"
              className="px-2 py-1 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium text-white/60 hover:text-[#f5f8f1] hover:bg-white/5 transition-colors duration-200"
            >
              🏠 Back to Site
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
} 