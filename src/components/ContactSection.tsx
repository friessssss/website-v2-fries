'use client';

import { useEffect, useRef, useState } from 'react';
import { contactLinks } from '@/data/home';

export default function ContactSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
          }
        });
      },
      {
        threshold: 0.3,
        rootMargin: '0px 0px -100px 0px',
      }
    );

    observer.observe(sectionRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={sectionRef}
      className="relative w-full flex items-center justify-end"
    >
      <div
        className={`transition-all duration-1000 ease-out ${
          isVisible
            ? 'opacity-100 translate-x-0'
            : 'opacity-0 translate-x-12'
        }`}
      >
        <div className="text-right space-y-6 md:space-y-8">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-light text-white/90 mb-6 md:mb-12">
            Contact
          </h2>
          
          <div className="space-y-3 md:space-y-4 flex flex-col items-end">
            {contactLinks.map((link) => {
              const isExternal = link.href.startsWith('http') || link.href.endsWith('.pdf');
              return (
                <a
                  key={link.label}
                  href={link.href}
                  {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="group block w-full md:w-auto"
                >
                  <div className="px-4 py-3 md:px-8 md:py-4 border border-white/20 bg-white/5 rounded hover:bg-white/10 hover:border-white/40 transition-all duration-300 text-right">
                    <div className="text-white/90 text-base md:text-lg font-light group-hover:text-white transition-colors">
                      {link.label}
                    </div>
                    <div className="text-white/50 text-xs md:text-sm mt-1 font-mono">
                      {link.description}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

