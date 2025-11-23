'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PiCarBold } from 'react-icons/pi';

import FluidCursor from '@/components/FluidCursor';
import { useLenisScroll } from '@/components/LenisProvider';

type Stat = {
  label: string;
  value: string;
  meta: string;
};

type HeroSectionProps = {
  stats: Stat[];
};

export default function HeroSection({ stats }: HeroSectionProps) {
  const lenis = useLenisScroll();
  const router = useRouter();

  const scrollToBio = () => {
    if (lenis) {
      lenis.scrollTo('#bio', {
        offset: -20,
        duration: 1.2,
        easing: (t: number) => 1 - Math.pow(1 - t, 4),
      });
      return;
    }
    document.querySelector('#bio')?.scrollIntoView({ behavior: 'smooth' });
  };

  const openTracker = () => {
    router.push('/RLTracker');
  };

  return (
    <section
      id="hero"
      className="hero-field relative isolate flex min-h-screen items-center justify-center overflow-hidden px-6 py-20 text-center text-[#f5f8f1] bg-[#040705]"
    >
      <FluidCursor />
      <div className="relative z-20 mx-auto flex max-w-5xl flex-col items-center gap-10 pointer-events-none">
        <div className="space-y-3">
          <p className="text-xs uppercase font-chikoria tracking-[0.75em] !text-[var(--accent-muted)] !text-white">
            Zach Robertson
          </p>
          <h1 className="hero-name text-[clamp(3.2rem,7vw,7rem)] font-semibold uppercase leading-[0.88] tracking-tight">
            Zach Robertson
          </h1>
          <p className="hero-tagline text-sm font-semibold uppercase tracking-[0.6em] text-[var(--accent-muted)]">
            Hardware • Software Integration Engineer
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-4 text-sm font-semibold uppercase tracking-[0.4em]">
          <Link
            href="mailto:hey@zachrobertson.co"
            className="pointer-events-auto rounded-full font-chikoria border 
            border-transparent bg-[var(--accent-lime)] px-5 py-3 !text-black transition
             hover:bg-white hover:!text-[var(--accent-lime)] !text-lg"
          >
            Get in touch
          </Link>
        </div>
        
      </div>
      <div className="pointer-events-none">
        <button
          type="button"
          onClick={openTracker}
          className="group pointer-events-auto absolute right-8 top-8 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.5em] text-white/60 transition hover:border-[var(--accent-lime)] hover:bg-[var(--accent-lime)]/15 hover:text-white/90"
          title="Calibration car"
          aria-label="Open RL Tracker"
        >
          <PiCarBold className="text-lg opacity-70 transition group-hover:opacity-100" />
          <span className="sr-only">Launch RL Tracker</span>
        </button>
      </div>
    </section>
  );
}

