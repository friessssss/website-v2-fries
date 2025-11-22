'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import SignalChainCanvas from './SignalChainCanvas';

type BioSectionProps = {
  paragraphs: string[];
  signals: { label: string; value: string }[];
};

export default function BioSection({ paragraphs, signals }: BioSectionProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!sectionRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="bio"
      className="relative isolate overflow-hidden bg-white px-6 py-24 text-slate-900"
    >
      <div className="mx-auto grid max-w-6xl gap-16 lg:grid-cols-[1.2fr_0.8fr]">
        <div
          className={clsx(
            'space-y-6 transition-all duration-700 ease-[cubic-bezier(0.26,0.6,0.33,1)]',
            visible ? 'translate-x-0 opacity-100' : '-translate-x-16 opacity-0',
          )}
        >
          <p className="text-xs uppercase tracking-[0.6em] text-slate-500">Full bio</p>
          <h2 className="text-4xl font-semibold text-slate-900 sm:text-5xl">
            Integration is an instrument—every layer needs to resonate.
          </h2>
          <div className="space-y-6 text-lg leading-relaxed text-slate-700">
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
        <div
          className={clsx(
            'rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-2xl shadow-slate-200/40 transition-all duration-700 ease-[cubic-bezier(0.26,0.6,0.33,1)] overflow-hidden',
            visible ? 'translate-x-0 opacity-100' : 'translate-x-16 opacity-0',
          )}
        >
          <div className="p-6 pb-4 sm:p-8 sm:pb-4">
            <p className="text-xs uppercase tracking-[0.55em] text-slate-500">Signal chain</p>
            <p className="mt-2 text-xs text-slate-400">Interactive 3D • Drag the wires!</p>
          </div>
          <div className="h-[500px] w-full sm:h-[600px] md:h-[700px]">
            <SignalChainCanvas />
          </div>
        </div>
      </div>
    </section>
  );
}

