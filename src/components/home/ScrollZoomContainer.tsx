'use client';

import { useEffect, useRef, useState } from 'react';
import { useLenisScroll } from '@/components/LenisProvider';

type ScrollZoomContainerProps = {
  hero: React.ReactNode;
  content: React.ReactNode;
  horizontalTexts?: string[];
};

export default function ScrollZoomContainer({ 
  hero, 
  content,
  horizontalTexts = [
    "HARDWARE • SOFTWARE • INTEGRATION",
    "SYSTEMS • SIGNALS • CALIBRATION",
    "PROTOTYPING • TESTING • DEPLOYMENT"
  ]
}: ScrollZoomContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroWrapperRef = useRef<HTMLDivElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const lenis = useLenisScroll();
  const [scrollProgress, setScrollProgress] = useState(0);
  
  // Calculate the height needed for the zoom effect
  // We want the zoom to happen over a certain scroll distance
  const ZOOM_SCROLL_HEIGHT = typeof window !== 'undefined' ? window.innerHeight * 3 : 3000;
  const MIN_SCALE = 0.2;
  
  useEffect(() => {
    if (!lenis) return;
    
    const handleScroll = () => {
      if (!containerRef.current) return;
      
      const scrollY = window.scrollY;
      const containerTop = containerRef.current.offsetTop;
      
      // Calculate how far we've scrolled into the zoom container
      const scrollIntoContainer = scrollY - containerTop;
      
      // Calculate progress (0 to 1) over the zoom scroll distance
      const progress = Math.max(0, Math.min(scrollIntoContainer / ZOOM_SCROLL_HEIGHT, 1));
      setScrollProgress(progress);
      
      // Calculate scale (1 to 0.2)
      const scale = 1 - (progress * (1 - MIN_SCALE));
      
      // Apply transform to hero - keep it centered
      if (heroWrapperRef.current) {
        heroWrapperRef.current.style.transform = `scale(${scale})`;
        
        // Add rounded corners as it zooms out
        // Start adding border radius after 20% zoom progress, max at 80%
        const borderRadiusProgress = Math.max(0, Math.min((progress), 1));
        const borderRadius = borderRadiusProgress * 180; // Max 60px radius
        heroWrapperRef.current.style.borderRadius = `${borderRadius}px`;
      }
    };
    
    lenis.on('scroll', handleScroll);
    handleScroll(); // Initial call
    
    return () => {
      lenis.off('scroll', handleScroll);
    };
  }, [lenis, ZOOM_SCROLL_HEIGHT]);
  
  // Calculate horizontal text position
  const getTextOffset = (index: number) => {
    // Different speeds for parallax effect
    const speed = 1 + (index * 0.3);
    const direction = index % 2 === 0 ? 1 : -1;
    return scrollProgress * 100 * speed * direction;
  };
  
  return (
    <div ref={containerRef} className="relative">
      {/* Zoom scroll area - hero stays fixed and centered during this */}
      <div 
        className="relative w-full"
        style={{ height: `${ZOOM_SCROLL_HEIGHT}px` }}
      >
        {/* Horizontal scrolling texts - behind the hero, visible over topographic background */}
        <div 
          ref={textContainerRef}
          className="fixed top-0 left-0 w-full h-screen flex flex-col items-center justify-center gap-12 pointer-events-none"
          style={{
            zIndex: 40,
            opacity: scrollProgress > 0.15 && scrollProgress < 0.85 ? 
              Math.min((scrollProgress - 0.15) / 0.15, (0.85 - scrollProgress) / 0.15) : 0,
            visibility: scrollProgress >= 1 ? 'hidden' : 'visible'
          }}
        >
          {horizontalTexts.map((text, index) => (
            <div
              key={index}
              className="whitespace-nowrap text-[clamp(2rem,5vw,4rem)] font-bold uppercase tracking-wider text-slate-900"
              style={{
                transform: `translateX(${getTextOffset(index)}%)`,
                textShadow: '0 2px 20px rgba(255, 255, 255, 0.8), 0 0 40px rgba(255, 255, 255, 0.5)'
              }}
            >
              {text}
            </div>
          ))}
        </div>
        
        {/* Fixed hero that zooms out from center - WITH green background */}
        <div 
          className="fixed top-0 left-0 w-full h-screen flex items-center justify-center overflow-hidden pointer-events-none"
          style={{
            zIndex: 50,
            opacity: scrollProgress >= 0.95 ? 0 : 1,
            visibility: scrollProgress >= 1 ? 'hidden' : 'visible',
            transition: 'opacity 0.3s ease-out'
          }}
        >
          <div
            ref={heroWrapperRef}
            className="will-change-transform overflow-hidden"
            style={{
              transformOrigin: 'center center',
              width: '100vw',
              height: '100vh',
            }}
          >
            <div 
              className="w-full h-full"
              style={{
                pointerEvents: scrollProgress >= 1 ? 'none' : 'auto',
              }}
            >
              {hero}
            </div>
          </div>
        </div>
      </div>
      
      {/* Main content - appears after zoom completes */}
      <div 
        className="relative"
        style={{
          minHeight: '100vh',
          zIndex: 100
        }}
      >
        {content}
      </div>
    </div>
  );
}

