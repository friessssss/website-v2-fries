'use client';

import { useEffect, useRef, useState } from 'react';
import { workHistory } from '@/data/home';

export default function WorkTimeline() {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    itemRefs.current.forEach((ref, index) => {
      if (!ref) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setVisibleItems((prev) => new Set(prev).add(index));
            }
          });
        },
        {
          threshold: 0.2,
          rootMargin: '0px 0px -100px 0px',
        }
      );

      observer.observe(ref);
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);

  return (
    <div className="relative w-full">
      <h2 className="text-4xl md:text-5xl font-light text-white/90 mb-16 text-left">
        Work History
      </h2>
      
      <div className="relative">
        {/* Vertical line - positioned on the left */}
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white/20" />
        
        {/* Timeline items */}
        <div className="space-y-16">
          {workHistory.map((item, index) => {
            const isVisible = visibleItems.has(index);
            
            return (
              <div
                key={index}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                className="relative flex items-start justify-start"
              >
                {/* Timeline point */}
                <div className="absolute left-0 w-4 h-4 rounded-full bg-white/40 border-2 border-white/60 transform -translate-x-1/2 -translate-y-1 z-10" />
                
                {/* Content */}
                <div
                  className={`flex-1 ml-12 text-left transition-all duration-1000 ease-out ${
                    isVisible
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 -translate-x-8'
                  }`}
                  style={{
                    transitionDelay: `${index * 150}ms`,
                  }}
                >
                  <div className="text-white/60 text-sm font-mono mb-2">
                    {item.year}
                  </div>
                  <h3 className="text-2xl md:text-3xl font-light text-white/90 mb-2">
                    {item.title}
                  </h3>
                  <div className="text-white/70 text-lg mb-3 font-light">
                    {item.company}
                  </div>
                  <p className="text-white/60 text-base leading-relaxed mb-4">
                    {item.description}
                  </p>
                  <div className="flex flex-wrap gap-2 justify-start">
                    {item.technologies.map((tech, techIndex) => (
                      <span
                        key={techIndex}
                        className="px-3 py-1 text-xs font-mono text-white/50 bg-white/5 rounded border border-white/10"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

