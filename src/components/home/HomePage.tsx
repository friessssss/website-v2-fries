"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useInView } from "framer-motion";
import Lenis from "lenis";

import FluidCursor from "@/components/effects/FluidCursor";
import InteractiveWires from "@/components/effects/InteractiveWires";
import RichText from "@/components/content/RichText";
import type { HomeContent, ProjectCard } from "@/types/content";

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  }),
};

type HomePageProps = {
  content: HomeContent;
};

export default function HomePage({ content }: HomePageProps) {
  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.08,
      smoothWheel: true,
      syncTouch: true,
    });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#02030c] text-white">
      <Hero content={content.hero} />
      <main className="space-y-16 pb-32 pt-12">
        <ManifestoSection content={content.about} />
        <SectionDivider label="Profile" />
        <AboutSection content={content.about} />
        <SectionDivider label="Experience" />
        <ExperienceSection content={content.experience} />
        <SectionDivider label="Projects" />
        <ProjectsSection content={content.projects} />
        <SectionDivider label="Rocket League" />
        <RocketLeagueSection content={content.rl} />
        <SectionDivider label="Now Playing" />
        <NowPlayingSection content={content.nowPlaying} />
      </main>
    </div>
  );
}

function Hero({ content }: { content: HomeContent["hero"] }) {
  const ctas = content.ctas ?? [];
  const heroRef = useRef<HTMLElement>(null);
  const showCursor = useInView(heroRef, { amount: 0.5, margin: "-10% 0px -10% 0px" });

  const heroCopy = useMemo(() => {
    if (content.subtitle) return content.subtitle;
    return "Hardware + software integration engineer building tactile systems, telemetry, and sonic UI.";
  }, [content.subtitle]);

  return (
    <section
      ref={heroRef}
      className="relative isolate overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(100,255,190,0.12),_transparent_55%),_linear-gradient(180deg,#050716_0%,#03030d_55%,#020203_100%)] px-6 pb-32 pt-32 sm:px-10 lg:px-16"
    >
      <AnimatePresence>
        {showCursor && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <FluidCursor targetRef={heroRef} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 max-w-5xl space-y-8">
        <motion.span
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.5em]"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.1}
        >
          Hardware • Software Integration
          <span className="h-2 w-2 rounded-full bg-[#00ffd2]" />
        </motion.span>

        <motion.h1
          className="text-5xl font-black uppercase leading-[0.85] text-white drop-shadow-[0_15px_40px_rgba(0,0,0,0.65)] sm:text-7xl lg:text-8xl xl:text-[9rem]"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.2}
        >
          Zach Robertson
        </motion.h1>

        <motion.div
          className="flex flex-wrap gap-4 text-sm uppercase tracking-[0.5em] text-white/70"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.3}
        >
          <HeroBadge>Mechanical Engineer</HeroBadge>
          <HeroBadge>Computer Science</HeroBadge>
          <HeroBadge>HW/SW Integration</HeroBadge>
        </motion.div>

        <motion.p
          className="max-w-3xl text-lg text-white/80 sm:text-xl"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.35}
        >
          {heroCopy}
        </motion.p>

        <motion.div
          className="flex flex-wrap gap-4"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.45}
        >
          {ctas.map((cta) => (
            <HeroButton key={cta.href + cta.label} href={cta.href} variant={cta.style}>
              {cta.label}
            </HeroButton>
          ))}
          <HeroButton href="/RLTracker" variant="ghost">
            RL Tracker
          </HeroButton>
        </motion.div>
      </div>

      <motion.div
        className="relative z-10 mt-16 h-[280px] overflow-hidden rounded-[36px] border border-white/10 bg-black/40 shadow-[1.2rem_1.2rem_0_#02030a]"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.55}
      >
        <InteractiveWires />
      </motion.div>

      <motion.div
        className="relative z-10 mt-16"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.65}
      >
        <StatsBelt stats={content.stats ?? []} />
      </motion.div>
    </section>
  );
}

function HeroBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold tracking-[0.45em] text-white/70 transition hover:-translate-y-0.5 hover:text-white">
      {children}
    </span>
  );
}

function HeroButton({
  href,
  children,
  variant = "solid",
}: {
  href: string;
  children: React.ReactNode;
  variant?: string | null;
}) {
  const base =
    "rounded-full px-6 py-2 text-sm font-semibold uppercase tracking-[0.4em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

  if (variant === "outline") {
    return (
      <Link href={href} className={`${base} border border-white/30 text-white hover:bg-white/10`}>
        {children}
      </Link>
    );
  }

  if (variant === "ghost") {
    return (
      <Link href={href} className={`${base} text-white/80 hover:text-white`}>
        {children}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`${base} bg-[#f7ff00] text-slate-950 shadow-[0.6rem_0.6rem_0_#01040d] hover:-translate-y-0.5`}
    >
      {children}
    </Link>
  );
}

function StatsBelt({ stats }: { stats: HomeContent["hero"]["stats"] }) {
  if (!stats?.length) return null;

  return (
    <div className="flex flex-wrap gap-4 rounded-3xl border border-white/15 bg-[#090f1d]/80 p-5 backdrop-blur">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="min-w-[140px] rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
        >
          <p className="text-2xl font-bold text-white">{stat.value}</p>
          <p className="text-xs uppercase tracking-[0.4em] text-white/50">{stat.label}</p>
          {stat.detail && <p className="text-sm text-white/60">{stat.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function ManifestoSection({ content }: { content: HomeContent["about"] }) {
  const lines =
    content.highlights && content.highlights.some(Boolean)
      ? content.highlights.map((line) => line.toUpperCase())
      : [
          "REDEFINING LIMITS, FIGHTING FOR [WINS],",
          "BRINGING MECHANICAL INTUITION INTO SOFTWARE [SYSTEMS],",
          "WIRING DATA LOOPS FOR TRACK-LEVEL [FOCUS],",
          "DEFINING A [LEGACY] IN HW + SW INTEGRATION.",
        ];

  return (
    <section className="relative min-h-screen overflow-hidden bg-[#10140a] px-6 py-16 sm:px-10 lg:px-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(208,255,84,0.08),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20">
        <svg
          viewBox="0 0 800 600"
          className="h-full w-full"
          preserveAspectRatio="none"
          role="presentation"
        >
          <path
            d="M0 100 Q200 50 400 120 T800 80"
            stroke="#d0ff54"
            strokeWidth="0.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M0 300 Q200 260 400 340 T800 320"
            stroke="#9ccf5b"
            strokeWidth="0.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M0 500 Q200 460 400 530 T800 520"
            stroke="#d0ff54"
            strokeWidth="0.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="relative z-10 flex min-h-[70vh] flex-col justify-center gap-6 text-[#f5f5ef]">
        {lines.map((line, idx) => (
          <LineWithHighlights key={`${line}-${idx}`} text={line} />
        ))}
      </div>
    </section>
  );
}

function LineWithHighlights({ text }: { text: string }) {
  const segments = text.split(/\[(.*?)\]/g);
  return (
    <p className="text-3xl font-black uppercase leading-[1.05] tracking-tight sm:text-4xl lg:text-[3.8rem]">
      {segments.map((segment, idx) =>
        idx % 2 === 1 ? (
          <span
            key={`${segment}-${idx}`}
            className="font-serif text-[#d0ff54] drop-shadow-[0_0_25px_rgba(208,255,84,0.35)]"
          >
            {segment}
          </span>
        ) : (
          <span key={`${segment}-${idx}`}>{segment}</span>
        ),
      )}
    </p>
  );
}

function AboutSection({ content }: { content: HomeContent["about"] }) {
  return (
    <section className="px-6 sm:px-10 lg:px-16">
      <div className="rounded-[36px] border border-white/10 bg-gradient-to-br from-[#13002b] via-[#050014] to-[#000000] p-8 shadow-[1.2rem_1.2rem_0_#01040d]">
        <motion.p
          className="text-xs uppercase tracking-[0.6em] text-white/40"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.6 }}
        >
          About
        </motion.p>
        <motion.h2
          className="mt-3 text-3xl font-semibold"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.6 }}
          custom={0.15}
        >
          {content.title}
        </motion.h2>
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.6 }}
          custom={0.25}
        >
          <RichText value={content.body} className="mt-6 text-lg text-white/80" />
        </motion.div>
        <motion.ul
          className="mt-6 grid gap-4 sm:grid-cols-2"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.6 }}
          custom={0.35}
        >
          {(content.highlights ?? []).map((item) => (
            <li
              key={item}
              className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70"
            >
              {item}
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

function ExperienceSection({ content }: { content: HomeContent["experience"] }) {
  const entries = content.entries ?? [];

  return (
    <section className="px-6 sm:px-10 lg:px-16">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="lg:w-1/3">
          <p className="text-xs uppercase tracking-[0.6em] text-white/40">Experience</p>
          <h2 className="mt-3 text-3xl font-semibold">{content.heading}</h2>
          <p className="mt-2 text-white/70">
            Scaling hardware-software platforms, leading teams, and shipping telemetry that keeps
            squads synced.
          </p>
        </div>
        <div className="grid flex-1 gap-4">
          {entries.map((entry) => (
            <motion.div
              key={`${entry.company}-${entry.role}`}
              className="rounded-3xl border border-white/10 bg-black/60 p-6"
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.3 }}
            >
              <p className="text-xs uppercase tracking-[0.5em] text-white/40">{entry.range}</p>
              <h3 className="mt-3 text-2xl font-semibold">{entry.role}</h3>
              <p className="text-white/70">{entry.company}</p>
              {entry.summary && <p className="mt-3 text-sm text-white/70">{entry.summary}</p>}
              {entry.highlights && (
                <ul className="mt-4 space-y-2 text-sm text-white/80">
                  {entry.highlights.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#00ffd2]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProjectsSection({ content }: { content: HomeContent["projects"] }) {
  const items = content.items ?? [];

  return (
    <section className="px-6 sm:px-10 lg:px-16">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.6em] text-white/40">Projects</p>
            <h2 className="mt-3 text-3xl font-semibold">{content.heading}</h2>
          </div>
          <Link
            href="/analytics"
            className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.4em] text-white/80"
          >
            Analytics
          </Link>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {items.map((project) => (
            <ProjectCardCard key={project.name} project={project} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProjectCardCard({ project }: { project: ProjectCard }) {
  return (
    <motion.div
      className="flex h-full flex-col rounded-3xl border border-white/10 bg-gradient-to-br from-[#17002e] via-[#060013] to-[#000] p-6"
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.4em] text-white/40">
        <span>{project.status ?? "live"}</span>
        {project.slug && <span>{project.slug}</span>}
      </div>
      <h3 className="mt-3 text-2xl font-semibold">{project.name}</h3>
      {project.summary && <p className="mt-2 text-sm text-white/70">{project.summary}</p>}
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/60">
        {(project.tech ?? []).map((tech) => (
          <span key={tech} className="rounded-full border border-white/15 px-3 py-1">
            {tech}
          </span>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3 text-sm font-semibold">
        {project.cta && <ProjectLink cta={project.cta} accent />}
        {project.secondaryLink && <ProjectLink cta={project.secondaryLink} />}
      </div>
    </motion.div>
  );
}

function ProjectLink({
  cta,
  accent = false,
}: {
  cta: NonNullable<ProjectCard["cta"]>;
  accent?: boolean;
}) {
  const isExternal = cta.href.startsWith("http") || cta.href.startsWith("mailto:");
  const className = accent
    ? "rounded-full bg-[#00ffd2] px-4 py-2 text-slate-950 shadow-[0.4rem_0.4rem_0_#01040d]"
    : "rounded-full border border-white/20 px-4 py-2 text-white/80";

  if (isExternal) {
    return (
      <a href={cta.href} target="_blank" rel="noreferrer" className={className}>
        {cta.label}
      </a>
    );
  }
  return (
    <Link href={cta.href} className={className}>
      {cta.label}
    </Link>
  );
}

function RocketLeagueSection({ content }: { content: HomeContent["rl"] }) {
  return (
    <section className="px-6 sm:px-10 lg:px-16">
      <div className="grid gap-6 rounded-[32px] border border-white/10 bg-[#020511] p-8 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.6em] text-white/40">Rocket League</p>
          <h2 className="mt-3 text-3xl font-semibold">{content.heading}</h2>
          {content.description && <p className="mt-3 text-white/70">{content.description}</p>}
          <ul className="mt-6 space-y-2 text-sm text-white/70">
            {(content.stats ?? []).map((stat) => (
              <li key={stat} className="flex gap-3">
                <span className="h-1.5 w-10 rounded-full bg-[#ff7fd1]" />
                <span>{stat}</span>
              </li>
            ))}
          </ul>
          {content.cta && (
            <div className="mt-6">
              <ProjectLink cta={content.cta} accent />
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-white/70">
          <p className="text-xs uppercase tracking-[0.5em] text-white/40">
            Live Telemetry Stack
          </p>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-white/60">Capture</dt>
              <dd>Custom overlay + MongoDB session store</dd>
            </div>
            <div>
              <dt className="text-white/60">Sync</dt>
              <dd>Spotify now playing merged with goal events</dd>
            </div>
            <div>
              <dt className="text-white/60">Insights</dt>
              <dd>Analytics dashboards for squad retros + trends</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function NowPlayingSection({ content }: { content: HomeContent["nowPlaying"] }) {
  const featured = content.featuredTracks ?? [];

  return (
    <section className="px-6 sm:px-10 lg:px-16">
      <div className="grid gap-6 rounded-[32px] border border-white/10 bg-gradient-to-r from-[#120032] via-[#060017] to-[#000000] p-8 lg:grid-cols-[1.2fr,0.8fr]">
        <div>
          <p className="text-xs uppercase tracking-[0.6em] text-white/40">Now Playing</p>
          <h2 className="mt-3 text-3xl font-semibold">{content.heading}</h2>
          {content.body && <p className="mt-3 text-white/70">{content.body}</p>}
          {content.spotifyHandle && (
            <p className="mt-2 text-sm text-white/60">Spotify: {content.spotifyHandle}</p>
          )}
          <ul className="mt-6 space-y-3">
            {featured.map((track) => (
              <li
                key={track.title}
                className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3"
              >
                <p className="text-lg font-semibold">{track.title}</p>
                {track.description && <p className="text-sm text-white/70">{track.description}</p>}
                {track.spotifyUrl && (
                  <a
                    href={track.spotifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs uppercase tracking-[0.4em] text-[#00ffd2]"
                  >
                    Listen
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
          {content.playlistEmbed ? (
            <iframe
              src={content.playlistEmbed}
              width="100%"
              height="360"
              title="Spotify playlist"
              className="rounded-xl border-0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-white/40">
              Playlist embed coming soon
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="px-6 sm:px-10 lg:px-16">
      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.6em] text-white/30">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        {label}
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>
    </div>
  );
}

