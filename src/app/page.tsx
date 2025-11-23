import Link from 'next/link';

import BioSectionBlock from '@/components/home/BioSection';
import HeroSection from '@/components/home/HeroSection';
import ScrollZoomContainer from '@/components/home/ScrollZoomContainer';
import TopographicBackground from '@/components/home/TopographicBackground';
import {
  bioParagraphs,
  bioSignals,
  heroStats,
  projectDeck,
  systemPillars,
} from '@/data/home';

export default function Page() {
  return (
    <div className="relative">
      <div className="fixed inset-0 bg-white -z-20" />
      <TopographicBackground />
      <ScrollZoomContainer
        hero={<HeroSection stats={heroStats} />}
        content={
          <>
            <BioSectionBlock paragraphs={bioParagraphs} signals={bioSignals} />
            <SystemsSection />
            <ProjectsSection />
            <LabCallout />
          </>
        }
      />
    </div>
  );
}

function SystemsSection() {
  return (
    <section id="systems" className="relative isolate px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.55em] text-slate-500">Systems</p>
            <h2 className="mt-3 text-4xl font-semibold text-slate-900 sm:text-5xl">
              Where I plug in.
            </h2>
          </div>
          <p className="max-w-lg text-sm text-slate-600">
            Hardware to cloud, concept to operator view. I architect the connective tissue so every layer stays in tune.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {systemPillars.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-3xl border border-slate-200 bg-white/50 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-sm"
            >
              <h3 className="text-xl font-semibold text-slate-900">{pillar.title}</h3>
              <p className="mt-3 text-sm text-slate-600">{pillar.description}</p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-700/80">
                {pillar.artifacts.map((artifact) => (
                  <span
                    key={artifact}
                    className="rounded-full border border-emerald-200/30 bg-emerald-50/50 px-3 py-1 text-emerald-800/70"
                  >
                    {artifact}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProjectsSection() {
  return (
    <section id="work" className="relative isolate px-6 py-28">
      <div className="mx-auto max-w-6xl space-y-12">
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.55em] text-slate-500">Selected work</p>
          <h2 className="text-4xl font-semibold text-slate-900 sm:text-5xl">Recent labs, launches, and rituals.</h2>
          <p className="max-w-3xl text-sm text-slate-600">
            A sampling of the environments and artifacts I build—each one blends tactile hardware, resilient software, and
            brave teams.
          </p>
        </div>
        <div className="grid gap-6">
          {projectDeck.map((project) => (
            <article
              key={project.title}
              className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-xl shadow-slate-200/40 backdrop-blur-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.4em] text-slate-500">
                <span>{project.timeframe}</span>
              </div>
              <h3 className="text-2xl font-semibold text-slate-900">{project.title}</h3>
              <p className="text-base text-slate-600">{project.summary}</p>
              <p className="text-sm font-semibold uppercase tracking-[0.4em] text-emerald-600">
                Outcome: {project.result}
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                {project.stack.map((tech) => (
                  <span key={tech} className="rounded-full border border-slate-200 px-3 py-1 text-slate-600">
                    {tech}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function LabCallout() {
  return (
    <section className="relative isolate px-6 pb-28">
      <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-white/80 p-10 text-center shadow-xl shadow-slate-200/40 backdrop-blur-sm">
        <p className="text-xs uppercase tracking-[0.55em] text-slate-500">Next build</p>
        <h2 className="mt-4 text-4xl font-semibold text-slate-900">Need an integration layer that behaves like a product?</h2>
        <p className="mt-4 text-base text-slate-600">
          I love helping teams turn messy prototypes into confident launches. Lenis drives the story, contrast keeps it
          legible, and the hardware finally has a voice.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm font-semibold uppercase tracking-[0.35em]">
          <Link
            href="mailto:hey@zachrobertson.co"
            className="rounded-full border border-slate-200 bg-slate-50 px-8 py-3 text-slate-900 transition hover:border-slate-300 hover:bg-slate-100"
          >
            Email Zach
          </Link>
          <Link
            href="https://www.linkedin.com/in/zrobertson"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-transparent bg-emerald-500/80 px-8 py-3 text-white transition hover:bg-emerald-600"
          >
            Connect on LinkedIn
          </Link>
        </div>
      </div>
    </section>
  );
}
