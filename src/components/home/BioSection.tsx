'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

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
            'rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl shadow-slate-200/40 transition-all duration-700 ease-[cubic-bezier(0.26,0.6,0.33,1)]',
            visible ? 'translate-x-0 opacity-100' : 'translate-x-16 opacity-0',
          )}
        >
          <p className="text-xs uppercase tracking-[0.55em] text-slate-500">Signal chain</p>
          <div className="mt-6 space-y-5">
            {signals.map((signal) => (
              <div key={signal.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.4em] text-slate-500">{signal.label}</p>
                <p className="mt-2 text-base text-slate-900">{signal.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

