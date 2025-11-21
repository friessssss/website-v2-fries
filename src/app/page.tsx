import Link from 'next/link';

import BioSectionBlock from '@/components/home/BioSection';
import HeroSection from '@/components/home/HeroSection';
import {
  bioParagraphs,
  bioSignals,
  heroStats,
  projectDeck,
  systemPillars,
} from '@/data/home';

export default function Page() {
  return (
    <>
      <HeroSection stats={heroStats} />
      <BioSectionBlock paragraphs={bioParagraphs} signals={bioSignals} />
      <SystemsSection />
      <ProjectsSection />
      <LabCallout />
    </>
  );
}

function SystemsSection() {
  return (
    <section id="systems" className="relative isolate px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.55em] text-slate-500">Systems</p>
            <h2 className="mt-3 text-4xl font-semibold text-white sm:text-5xl">
              Where I plug in.
            </h2>
          </div>
          <p className="max-w-lg text-sm text-slate-400">
            Hardware to cloud, concept to operator view. I architect the connective tissue so every layer stays in tune.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {systemPillars.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-3xl border border-slate-800/70 bg-slate-950/70 p-6 shadow-2xl shadow-cyan-900/20"
            >
              <h3 className="text-xl font-semibold text-white">{pillar.title}</h3>
              <p className="mt-3 text-sm text-slate-400">{pillar.description}</p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/80">
                {pillar.artifacts.map((artifact) => (
                  <span
                    key={artifact}
                    className="rounded-full border border-cyan-200/30 px-3 py-1 text-cyan-100/70"
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
          <h2 className="text-4xl font-semibold text-white sm:text-5xl">Recent labs, launches, and rituals.</h2>
          <p className="max-w-3xl text-sm text-slate-400">
            A sampling of the environments and artifacts I build—each one blends tactile hardware, resilient software, and
            brave teams.
          </p>
        </div>
        <div className="grid gap-6">
          {projectDeck.map((project) => (
            <article
              key={project.title}
              className="flex flex-col gap-4 rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-950/80 via-slate-950/50 to-slate-900/60 p-8 shadow-2xl shadow-slate-900/30"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.4em] text-slate-500">
                <span>{project.timeframe}</span>
              </div>
              <h3 className="text-2xl font-semibold text-white">{project.title}</h3>
              <p className="text-base text-slate-300">{project.summary}</p>
              <p className="text-sm font-semibold uppercase tracking-[0.4em] text-emerald-300">
                Outcome: {project.result}
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                {project.stack.map((tech) => (
                  <span key={tech} className="rounded-full border border-white/10 px-3 py-1 text-white/70">
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
      <div className="mx-auto max-w-6xl rounded-3xl border border-slate-800/70 bg-slate-950/70 p-10 text-center shadow-2xl shadow-cyan-900/40">
        <p className="text-xs uppercase tracking-[0.55em] text-slate-500">Next build</p>
        <h2 className="mt-4 text-4xl font-semibold text-white">Need an integration layer that behaves like a product?</h2>
        <p className="mt-4 text-base text-slate-300">
          I love helping teams turn messy prototypes into confident launches. Lenis drives the story, contrast keeps it
          legible, and the hardware finally has a voice.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm font-semibold uppercase tracking-[0.35em]">
          <Link
            href="mailto:hey@zachrobertson.co"
            className="rounded-full border border-white/20 bg-white/5 px-8 py-3 text-white transition hover:border-white/40 hover:bg-white/10"
          >
            Email Zach
          </Link>
          <Link
            href="https://www.linkedin.com/in/zrobertson"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-transparent bg-cyan-500/80 px-8 py-3 text-slate-900 transition hover:bg-cyan-400"
          >
            Connect on LinkedIn
          </Link>
        </div>
      </div>
    </section>
  );
}
