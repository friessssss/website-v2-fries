'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';
import AsciiDitherBackground from '@/components/AsciiDitherBackground';
import AsciiTorusKnot from '@/components/AsciiTorusKnot';
import WorkTimeline from '@/components/WorkTimeline';
import ContactSection from '@/components/ContactSection';

export default function Page() {
  const scrollY = useScrollAnimation();
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Calculate opacity and transform based on scroll
  // Start fading at 50px, fully faded at 250px (quicker animation)
  const fadeStart = 50;
  const fadeEnd = 250;
  const scrollProgress = Math.min(1, Math.max(0, (scrollY - fadeStart) / (fadeEnd - fadeStart)));
  const opacity = 1 - scrollProgress;
  const translateY = scrollProgress * -50; // Move up 50px as we scroll
  const scale = isMobile ? 0.4 : 1;

  return (
    <div className="relative">
      {/* Hero Section - Full Screen */}
      <div className="relative min-h-screen flex flex-col items-center justify-center px-6">
        <AsciiDitherBackground />
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            opacity,
            transform: `translateY(${translateY}px) scale(${scale})`,
            transition: 'opacity 0.1s ease-out, transform 0.1s ease-out',
            zIndex: 10,
            transformOrigin: 'center center',
          }}
        >
          <AsciiTorusKnot />
        </div>
        <div className="max-w-4xl mx-auto text-center space-y-8 relative z-10">
        </div>
        
        {/* Top left corner button */}
        <div className="fixed top-0 left-0 pt-4 md:pt-10 pl-4 md:pl-[90px] z-20">
          <Link 
            href="/RLTracker"
            className="group inline-block"
          >
            <p className="text-white/40 text-xs md:text-base font-light font-mono tracking-tight hover:text-white/60 transition-colors duration-200">
              {'>'} RLTracker
            </p>
          </Link>
        </div>
        
        {/* Bottom left corner text */}
        <div 
          className="fixed bottom-0 left-0 pb-4 md:pb-10 pl-4 md:pl-[90px] z-20 max-w-[60%] md:max-w-none"
          style={{
            opacity,
            transform: `translateY(${translateY}px)`,
            transition: 'opacity 0.1s ease-out, transform 0.1s ease-out',
          }}
        >
          <h1 className="text-white text-2xl md:text-6xl lg:text-7xl font-normal tracking-tight leading-tight">
            Zach Robertson
          </h1>
        </div>
        
        {/* Bottom right corner text */}
        <div 
          className="fixed bottom-0 right-0 pb-4 md:pb-10 pr-4 md:pr-[90px] z-20 max-w-[60%] md:max-w-none"
          style={{
            opacity,
            transform: `translateY(${translateY}px)`,
            transition: 'opacity 0.1s ease-out, transform 0.1s ease-out',
          }}
        >
          <p className="text-white/90 text-lg md:text-4xl lg:text-5xl font-light leading-tight text-right">
            Integration Engineer
          </p>
        </div>
      </div>

      {/* Scrollable Content Sections */}
      <div className="relative z-10">
        {/* Work Timeline and Contact - Side by Side */}
        <div className="relative min-h-screen flex items-center py-8 md:py-0">
          <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-12 md:gap-8 lg:gap-24 px-4 md:px-8 lg:px-16">
            <WorkTimeline />
            <ContactSection />
          </div>
        </div>
      </div>
    </div>
  );
}
