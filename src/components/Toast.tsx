'use client';

import { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
}

export default function Toast({ message, isVisible, onClose }: ToastProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setIsAnimating(false);
        setTimeout(onClose, 300); // Wait for animation to complete
      }, 3000); // Show for 3 seconds

      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 right-4 z-50">
      <div
        className={`transform transition-all duration-300 ease-in-out ${
          isAnimating ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}
      >
        <div className="bg-green-500 text-white px-6 py-4 rounded-lg shadow-lg border border-green-400">
          <div className="flex items-center space-x-2">
            <span className="text-xl">🎉</span>
            <span className="font-medium">{message}</span>
          </div>
        </div>
      </div>
    </div>
  );
} 