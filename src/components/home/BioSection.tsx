'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useLenisScroll } from '@/components/LenisProvider';
import SignalChainCanvas from './SignalChainCanvas';

// Register GSAP plugins
gsap.registerPlugin(ScrollTrigger);

type BioSectionProps = {
  paragraphs: string[];
  signals: { label: string; value: string }[];
};

export default function BioSection({ paragraphs, signals }: BioSectionProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headingsRef = useRef<HTMLHeadingElement[]>([]);
  const lenis = useLenisScroll();
  const lastScrollTimeRef = useRef(0);

  useEffect(() => {
    if (!sectionRef.current || !contentRef.current || !lenis) return;

    // Detect mobile/touch device
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Integrate Lenis with ScrollTrigger
    lenis.on('scroll', ScrollTrigger.update);

    // Magnetic snap effect - continuous pull when in range
    let magneticRaf: number | null = null;
    let isUserScrolling = false;
    let scrollStopTimeout: NodeJS.Timeout | null = null;

    const handleScroll = () => {
      isUserScrolling = true;
      lastScrollTimeRef.current = Date.now();
      
      // Reset scroll stop detection
      if (scrollStopTimeout) clearTimeout(scrollStopTimeout);
      scrollStopTimeout = setTimeout(() => {
        isUserScrolling = false;
      }, 150);
    };

    lenis.on('scroll', handleScroll);

    const ctx = gsap.context(() => {
      // Set initial hidden state - no scale to avoid jumpiness
      gsap.set(contentRef.current, {
        opacity: 0,
        y: 80,
      });

      gsap.set(headingsRef.current, {
        opacity: 0,
        y: 30,
      });

      // Magnetic snap trigger zone - continuous pull effect
      const magneticTrigger = ScrollTrigger.create({
        trigger: sectionRef.current,
        start: 'top 90%',
        end: 'bottom 10%',
        onUpdate: () => {
          if (isUserScrolling) {
            if (magneticRaf) {
              cancelAnimationFrame(magneticRaf);
              magneticRaf = null;
            }
            return;
          }
          
          const sectionTop = sectionRef.current!.getBoundingClientRect().top;
          const viewportCenter = window.innerHeight / 2;
          const distanceFromCenter = sectionTop - viewportCenter;
          const maxDistance = window.innerHeight * 0.25; // Magnetic field extends 25% of viewport
          
          // Only apply magnetic pull if within range and user has stopped scrolling
          // On mobile, use longer delay and weaker strength to avoid interfering with touch scrolling
          const scrollDelay = isTouchDevice ? 600 : 400;
          const timeSinceScroll = Date.now() - lastScrollTimeRef.current;
          if (Math.abs(distanceFromCenter) < maxDistance && timeSinceScroll > scrollDelay) {
            // Calculate magnetic strength (stronger when closer to center, weaker at edges)
            // Reduce strength on mobile to avoid interfering with touch scrolling
            const baseStrength = isTouchDevice ? 0.06 : 0.12;
            const normalizedDistance = Math.abs(distanceFromCenter) / maxDistance;
            const magneticStrength = Math.pow(1 - normalizedDistance, 2) * baseStrength;
            
            // Apply gradual magnetic pull using requestAnimationFrame for smoothness
            if (!magneticRaf) {
              const applyMagneticPull = () => {
                if (isUserScrolling) {
                  magneticRaf = null;
                  return;
                }
                
                const currentSectionTop = sectionRef.current!.getBoundingClientRect().top;
                const currentDistance = currentSectionTop - viewportCenter;
                
                if (Math.abs(currentDistance) > 5) { // Only adjust if more than 5px away
                  const pullAmount = -currentDistance * magneticStrength * 0.1; // Gradual pull
                  lenis.scrollTo(lenis.scroll + pullAmount, {
                    duration: 0.1,
                    easing: (t) => t, // Linear for smooth continuous pull
                    immediate: false,
                  });
                  
                  magneticRaf = requestAnimationFrame(applyMagneticPull);
                } else {
                  magneticRaf = null;
                }
              };
              
              magneticRaf = requestAnimationFrame(applyMagneticPull);
            }
          } else {
            // Stop magnetic pull when out of range
            if (magneticRaf) {
              cancelAnimationFrame(magneticRaf);
              magneticRaf = null;
            }
          }
        },
        onLeave: () => {
          if (magneticRaf) {
            cancelAnimationFrame(magneticRaf);
            magneticRaf = null;
          }
        },
        onLeaveBack: () => {
          if (magneticRaf) {
            cancelAnimationFrame(magneticRaf);
            magneticRaf = null;
          }
        },
      });

      // Smooth entrance animation - no conflicting transforms
      const entranceTL = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 40%',
          end: 'top 5%',
          toggleActions: 'play none none reverse',
        },
      });

      // Animate container smoothly
      entranceTL.to(contentRef.current, {
        opacity: 1,
        y: 0,
        duration: 1.2,
        ease: 'power2.out',
      });

      // Stagger animate headings smoothly - no scale or rotation to avoid jumpiness
      entranceTL.to(
        headingsRef.current,
        {
          opacity: 1,
          y: 0,
          duration: 0.9,
          stagger: {
            amount: 0.5,
            from: 'start',
          },
          ease: 'power2.out',
        },
        '-=0.8',
      );

      // Subtle glow effect when section is active
      const glowTL = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 50%',
          end: 'top 25%',
          toggleActions: 'play none none reverse',
        },
      });

      glowTL.to(headingsRef.current, {
        filter: 'drop-shadow(0 0 15px rgba(16, 185, 129, 0.25))',
        duration: 1.0,
        stagger: 0.08,
        ease: 'power1.out',
      });
    });

    return () => {
      ctx.revert();
      lenis.off('scroll', ScrollTrigger.update);
      lenis.off('scroll', handleScroll);
      if (scrollStopTimeout) clearTimeout(scrollStopTimeout);
      if (magneticRaf) cancelAnimationFrame(magneticRaf);
    };
  }, [lenis]);

  return (
    <section
      ref={sectionRef}
      id="bio"
      className="relative isolate overflow-hidden bg-transparent px-6 py-24 text-slate-900"
    >
      
      <div className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center">
        <div
          ref={contentRef}
          className="flex flex-col items-center justify-center space-y-6 text-center rounded-3xl bg-white/40 p-8 backdrop-blur-sm"
        >
          <h2 
            ref={(el) => { if (el) headingsRef.current[0] = el; }}
            className="text-5xl"
          >
            Chasing <span className="!text-emerald-700 font-chikoria font-bold">faults</span> and{' '}
            <span className="!text-emerald-700 font-chikoria font-bold">fixes</span>,<br /> with equal thrill.
          </h2>
          <h2 
            ref={(el) => { if (el) headingsRef.current[1] = el; }}
            className="text-5xl"
          >
            Merging software, hardware, and <span className="!text-emerald-700 font-chikoria font-bold">chaos</span> into something
            that <span className="!text-emerald-700 font-chikoria font-bold">works</span>.
          </h2>
          <h2 
            ref={(el) => { if (el) headingsRef.current[2] = el; }}
            className="text-5xl"
          >
            Defining a new era of <span className="!text-emerald-700 font-chikoria font-bold">electric adventure</span>.
          </h2>
        </div>
        {/* <div
          className={clsx(
            'rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-2xl shadow-slate-200/40 transition-all duration-700 ease-[cubic-bezier(0.26,0.6,0.33,1)] overflow-hidden',
            visible ? 'translate-x-0 opacity-100' : 'translate-x-16 opacity-0',
          )}
        >
          <div className="h-[500px] w-full sm:h-[600px] md:h-[700px]">
            <SignalChainCanvas />
          </div>
        </div> */}
      </div>
    </section>
  );
}

