'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function FriendNavBar() {
  const pathname = usePathname();

  return (
    <nav className="bg-gray-900 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <h1 className="text-xl font-bold">🎵 RL Tracker</h1>
            </div>
          </div>
          
          <div className="flex items-center space-x-8">
            <Link
              href="/RLTracker"
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                pathname === '/RLTracker'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              🎮 Track Goals
            </Link>
            
            <Link
              href="/analytics"
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                pathname === '/analytics'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
            >
              📊 Analytics
            </Link>
            
            <Link
              href="/"
              className="px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 transition-colors duration-200"
            >
              🏠 Back to Site
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
} 