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

  useEffect(() => {
    if (!sectionRef.current || !contentRef.current) return;

    // Detect Safari - use Lenis integration for Safari, native scroll for Chrome/mobile
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const useLenisIntegration = isSafari && !isTouchDevice && lenis;

    // Update ScrollTrigger - use native scroll for Chrome/mobile, Lenis for Safari
    const updateScrollTrigger = () => {
      ScrollTrigger.update();
    };

    let scrollUpdateRaf: number | null = null;
    const handleScroll = () => {
      // No throttling - update immediately
      if (scrollUpdateRaf !== null) {
        cancelAnimationFrame(scrollUpdateRaf);
      }
      scrollUpdateRaf = requestAnimationFrame(() => {
        updateScrollTrigger();
        scrollUpdateRaf = null;
      });
    };

    // Use native scroll for Chrome/mobile, Lenis for Safari
    if (useLenisIntegration) {
      lenis.on('scroll', handleScroll);
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }

    ScrollTrigger.config({
      autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load',
      ignoreMobileResize: true,
    });

    const ctx = gsap.context(() => {
      if (contentRef.current) {
        contentRef.current.style.willChange = 'transform, opacity';
        contentRef.current.style.backfaceVisibility = 'hidden';
        contentRef.current.style.transform = 'translateZ(0)';
      }

      headingsRef.current.forEach((heading) => {
        if (heading) {
          heading.style.willChange = 'transform, opacity';
          heading.style.backfaceVisibility = 'hidden';
          heading.style.transform = 'translateZ(0)';
        }
      });

      gsap.set(contentRef.current, {
        opacity: 0,
        y: 80,
        force3D: true,
      });

      gsap.set(headingsRef.current, {
        opacity: 0,
        y: 30,
        force3D: true,
      });

      const entranceTL = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 75%',
          end: 'top 25%',
          toggleActions: 'play none none reverse',
          markers: false,
          refreshPriority: -1,
        },
      });

      entranceTL.to(contentRef.current, {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: 'power2.out',
        force3D: true,
      });

      entranceTL.to(
        headingsRef.current,
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.15,
          ease: 'power2.out',
          force3D: true,
          onComplete: () => {
            if (contentRef.current) {
              contentRef.current.style.willChange = 'auto';
            }
            headingsRef.current.forEach((heading) => {
              if (heading) {
                heading.style.willChange = 'auto';
              }
            });
          },
        },
        '-=0.4',
      );
    });

    return () => {
      ctx.revert();
      if (useLenisIntegration) {
        lenis.off('scroll', handleScroll);
      } else {
        window.removeEventListener('scroll', handleScroll);
      }
      if (scrollUpdateRaf) cancelAnimationFrame(scrollUpdateRaf);
      const content = contentRef.current;
      const headings = headingsRef.current;
      if (content) {
        content.style.willChange = 'auto';
      }
      headings.forEach((heading) => {
        if (heading) {
          heading.style.willChange = 'auto';
        }
      });
    };
  }, [lenis]);

  return (
    <section
      ref={sectionRef}
      id="bio"
      className="relative isolate overflow-hidden bg-transparent px-6 py-24 text-slate-900"
      style={{ scrollBehavior: 'auto' }}
    >
      
      <div className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center">
        <div
          ref={contentRef}
          className="flex flex-col items-center justify-center space-y-6 text-center rounded-3xl bg-white/50 p-8"
          style={{
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            perspective: '1000px',
            contain: 'layout style paint',
            contentVisibility: 'auto',
          }}
        >
          {/* <h2 
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
          </h2> */}

          <h2 
            ref={(el) => { if (el) headingsRef.current[0] = el; }}
            className="text-5xl"
          >
            Taming <span className="!text-emerald-700 font-chikoria font-bold">chaos</span>, 
            tuning <span className="!text-emerald-700 font-chikoria font-bold">code</span>,
             and chasing <span className="!text-emerald-700 font-chikoria font-bold">clarity</span> in every connection.
          </h2>

          <h2 
            ref={(el) => { if (el) headingsRef.current[1] = el; }}
            className="text-5xl"
          > 
            Blending <span className="!text-emerald-700 font-chikoria font-bold">hardware </span>  
            and <span className="!text-emerald-700 font-chikoria font-bold">software</span> into something 
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

