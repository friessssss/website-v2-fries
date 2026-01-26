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

  const emailLink = contactLinks.find((link) => link.label === 'Email');
  const linkedInLink = contactLinks.find((link) => link.label === 'LinkedIn');
  const githubLink = contactLinks.find((link) => link.label === 'GitHub');

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
        <div className="text-right space-y-8">
          <h2 className="text-4xl md:text-5xl font-light text-white/90 mb-12">
            Contact
          </h2>
          
          <div className="space-y-4 flex flex-col items-end">
            {emailLink && (
              <a
                href={emailLink.href}
                className="group block w-full"
              >
                <div className="px-8 py-4 border border-white/20 bg-white/5 rounded hover:bg-white/10 hover:border-white/40 transition-all duration-300 text-right">
                  <div className="text-white/90 text-lg font-light group-hover:text-white transition-colors">
                    Email
                  </div>
                  <div className="text-white/50 text-sm mt-1 font-mono">
                    {emailLink.description}
                  </div>
                </div>
              </a>
            )}
            
            {linkedInLink && (
              <a
                href={linkedInLink.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block w-full"
              >
                <div className="px-8 py-4 border border-white/20 bg-white/5 rounded hover:bg-white/10 hover:border-white/40 transition-all duration-300 text-right">
                  <div className="text-white/90 text-lg font-light group-hover:text-white transition-colors">
                    LinkedIn
                  </div>
                  <div className="text-white/50 text-sm mt-1 font-mono">
                    {linkedInLink.description}
                  </div>
                </div>
              </a>
            )}
            
            {githubLink && (
              <a
                href={githubLink.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block w-full"
              >
                <div className="px-8 py-4 border border-white/20 bg-white/5 rounded hover:bg-white/10 hover:border-white/40 transition-all duration-300 text-right">
                  <div className="text-white/90 text-lg font-light group-hover:text-white transition-colors">
                    GitHub
                  </div>
                  <div className="text-white/50 text-sm mt-1 font-mono">
                    {githubLink.description}
                  </div>
                </div>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

