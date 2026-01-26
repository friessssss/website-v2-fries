import Link from 'next/link';
import AsciiDitherBackground from '@/components/AsciiDitherBackground';
import AsciiTorusKnot from '@/components/AsciiTorusKnot';

export default function Page() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        <AsciiDitherBackground />
        <AsciiTorusKnot />
      </div>
      
      {/* Top left corner button */}
      <div className="fixed top-0 left-0 pt-10 pl-[90px] z-10">
        <Link 
          href="/RLTracker"
          className="group inline-block"
        >
          <p className="text-white/40 text-sm md:text-base font-light font-mono tracking-tight hover:text-white/60 transition-colors duration-200">
            {'>'} RLTracker
          </p>
        </Link>
      </div>
      
      {/* Bottom left corner text */}
      <div className="fixed bottom-0 left-0 pb-10 pl-[90px] z-10">
        <h1 className="text-white text-6xl md:text-7xl font-normal tracking-tight">
          Zach Robertson
        </h1>
      </div>
      
      {/* Bottom right corner text */}
      <div className="fixed bottom-0 right-0 pb-10 pr-[90px] z-10">
        <p className="text-white/90 text-4xl md:text-5xl font-light">
          Integration Engineer
        </p>
      </div>
    </div>
  );
}
