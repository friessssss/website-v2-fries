import { groq } from "next-sanity";
import type { Image, PortableTextBlock } from "sanity";

import { sanityFetch, urlForImage } from "./sanity";
import type {
  AboutContent,
  CTA,
  HomeContent,
  HomeExperienceContent,
  HomeProjectContent,
  NavLink,
  NowPlayingContent,
  RLContent,
  SiteSettings,
  Stat,
} from "@/types/content";

type HomeQueryResult = {
  heroEyebrow?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  heroImage?: Image;
  heroCtas?: CTA[];
  heroStats?: Stat[];
  aboutTitle?: string;
  aboutBody?: PortableTextBlock[];
  aboutHighlights?: string[];
  experienceHeading?: string;
  experienceEntries?: HomeExperienceContent["entries"];
  projectHeading?: string;
  projects?: HomeProjectContent["items"];
  rlHeading?: string;
  rlDescription?: string;
  rlStats?: string[];
  rlCta?: CTA | null;
  nowPlayingHeading?: string;
  nowPlayingBody?: string;
  spotifyHandle?: string;
  playlistEmbed?: string;
  featuredTracks?: NowPlayingContent["featuredTracks"];
};

type SiteSettingsQueryResult = {
  siteTitle?: string;
  siteDescription?: string;
  contactEmail?: string;
  navLinks?: NavLink[];
  footerLinks?: NavLink[];
  metaKeywords?: string[];
  fancyAccent?: string;
  simpleAccent?: string;
  ogImage?: Image;
};

const HOME_QUERY = groq`*[_type == "homePage"][0]{
  heroEyebrow,
  heroTitle,
  heroSubtitle,
  heroImage,
  heroCtas,
  heroStats,
  aboutTitle,
  aboutBody,
  aboutHighlights,
  experienceHeading,
  experienceEntries,
  projectHeading,
  projects,
  rlHeading,
  rlDescription,
  rlStats,
  rlCta,
  nowPlayingHeading,
  nowPlayingBody,
  spotifyHandle,
  playlistEmbed,
  featuredTracks
}`;

const SETTINGS_QUERY = groq`*[_type == "siteSettings"][0]{
  siteTitle,
  siteDescription,
  contactEmail,
  navLinks,
  footerLinks,
  metaKeywords,
  fancyAccent,
  simpleAccent,
  ogImage
}`;

const FALLBACK_ABOUT: AboutContent = {
  title: "Solving delightful problems",
  body: [
    {
      _key: "fallback-about",
      _type: "block",
      children: [
        {
          _key: "fallback-about-span",
          _type: "span",
          text: "Engineering leader building highly tactile web experiences, privacy-focused analytics, and live-service tools for teams that care about craft.",
        },
      ],
      markDefs: [],
      style: "normal",
    },
  ],
  highlights: [
    "Staff engineer @ Mission Lane",
    "Ex-Vercel, Zapier, Crown Castle",
    "Mentor for early-career devs",
  ],
};

const FALLBACK_EXPERIENCE: HomeExperienceContent = {
  heading: "Recent impact",
  entries: [
    {
      role: "Staff Engineer",
      company: "Mission Lane",
      range: "2023 — Present",
      summary:
        "Leading the experience platform team shipping financial tooling for 1M+ customers.",
      highlights: [
        "Built personalization surface powering 30% lift in engagement",
        "Migrated design system to React Server Components",
      ],
    },
    {
      role: "Senior Frontend Engineer",
      company: "Vercel",
      range: "2021 — 2023",
      summary:
        "Owned advanced deployment workflows and partner integrations used by Fortune 100 brands.",
    },
  ],
};

const FALLBACK_PROJECTS: HomeProjectContent = {
  heading: "Lab notes",
  items: [
    {
      name: "Rocket League Tracker",
      summary:
        "Live match companion that blends custom telemetry, Spotify presence, and realtime goal logging.",
      tech: ["Next.js", "MongoDB", "Spotify API"],
      cta: { label: "Open Tracker", href: "/RLTracker" },
      secondaryLink: { label: "Docs", href: "/analytics" },
      status: "live",
    },
    {
      name: "Fluid Cursor",
      summary:
        "Three.js playground that responds to velocity, depth, and audio-reactive shaders.",
      tech: ["Three.js", "Lenis"],
      cta: { label: "Try Demo", href: "#fancy" },
      status: "experiment",
    },
  ],
};

const FALLBACK_RL: RLContent = {
  heading: "Rocket League telemetry",
  description:
    "Custom match-day UI that tracks squad momentum, opponent patterns, and what Spotify track was playing when the net shook.",
  stats: [
    "120+ matches logged",
    "Live Spotify + goal splits",
    "Zero manual spreadsheets",
  ],
  cta: { label: "Launch RL Tracker", href: "/RLTracker" },
};

const FALLBACK_NOW_PLAYING: NowPlayingContent = {
  heading: "Now spinning",
  body: "Mostly future garage with the occasional math-rock riff. Catch the shared playlist or peep whatever is powering the code at 2AM.",
  spotifyHandle: "@zachrobertson",
  playlistEmbed:
    "https://open.spotify.com/embed/playlist/37i9dQZF1DX2sUQwD7tbmL?utm_source=generator",
  featuredTracks: [
    {
      title: "Slipstream Focus",
      description: "Instrumental basslines for deep work",
    },
    {
      title: "Rocket League Warmups",
      description: "High BPM cuts to jump straight into comp",
    },
  ],
};

const FALLBACK_HOME: HomeContent = {
  hero: {
    eyebrow: "Creative technologist",
    title: "Zach Robertson",
    subtitle:
      "Building tactile web experiences, realtime sports tools, and sonic-driven UI experiments.",
    ctas: [
      { label: "Fancy mode", href: "#fancy" },
      { label: "Simple mode", href: "#simple", style: "outline" },
    ],
    stats: [
      { label: "Rocket League logs", value: "120+" },
      { label: "Spotify automations", value: "6" },
      { label: "Ship cadence", value: "weekly" },
    ],
  },
  about: FALLBACK_ABOUT,
  experience: FALLBACK_EXPERIENCE,
  projects: FALLBACK_PROJECTS,
  rl: FALLBACK_RL,
  nowPlaying: FALLBACK_NOW_PLAYING,
};

const FALLBACK_SETTINGS: SiteSettings = {
  siteTitle: "Zach Robertson",
  siteDescription:
    "Engineer building delightful web experiments, Rocket League analytics, and audio-driven interactions.",
  contactEmail: "hi@zachrobertson.co",
  navLinks: [
    { label: "Home", href: "/" },
    { label: "RL Tracker", href: "/RLTracker" },
    { label: "Analytics", href: "/analytics" },
    { label: "Contact", href: "mailto:hi@zachrobertson.co", variant: "primary" },
  ],
  footerLinks: [
    { label: "Privacy", href: "/privacy-policy" },
    { label: "Terms", href: "/terms-of-service" },
    { label: "Spotify App", href: "/spotify-token.html" },
  ],
  fancyAccent: "#F15A24",
  simpleAccent: "#2563eb",
};

function mapHomeContent(data: HomeQueryResult | null): HomeContent {
  if (!data) {
    return FALLBACK_HOME;
  }

  const heroImageUrl = urlForImage(data.heroImage, 1200);

  return {
    hero: {
      eyebrow: data.heroEyebrow ?? FALLBACK_HOME.hero.eyebrow,
      title: data.heroTitle ?? FALLBACK_HOME.hero.title,
      subtitle: data.heroSubtitle ?? FALLBACK_HOME.hero.subtitle,
      imageUrl: heroImageUrl,
      ctas: data.heroCtas ?? FALLBACK_HOME.hero.ctas,
      stats: data.heroStats ?? FALLBACK_HOME.hero.stats,
    },
    about: {
      title: data.aboutTitle ?? FALLBACK_HOME.about.title,
      body: data.aboutBody ?? FALLBACK_HOME.about.body,
      highlights: data.aboutHighlights ?? FALLBACK_HOME.about.highlights,
    },
    experience: {
      heading: data.experienceHeading ?? FALLBACK_HOME.experience.heading,
      entries:
        data.experienceEntries ?? FALLBACK_HOME.experience.entries ?? [],
    },
    projects: {
      heading: data.projectHeading ?? FALLBACK_HOME.projects.heading,
      items: data.projects ?? FALLBACK_HOME.projects.items,
    },
    rl: {
      heading: data.rlHeading ?? FALLBACK_HOME.rl.heading,
      description: data.rlDescription ?? FALLBACK_HOME.rl.description,
      stats: data.rlStats ?? FALLBACK_HOME.rl.stats,
      cta: data.rlCta ?? FALLBACK_HOME.rl.cta,
    },
    nowPlaying: {
      heading: data.nowPlayingHeading ?? FALLBACK_HOME.nowPlaying.heading,
      body: data.nowPlayingBody ?? FALLBACK_HOME.nowPlaying.body,
      spotifyHandle:
        data.spotifyHandle ?? FALLBACK_HOME.nowPlaying.spotifyHandle,
      playlistEmbed:
        data.playlistEmbed ?? FALLBACK_HOME.nowPlaying.playlistEmbed,
      featuredTracks:
        data.featuredTracks ?? FALLBACK_HOME.nowPlaying.featuredTracks,
    },
  };
}

function mapSiteSettings(data: SiteSettingsQueryResult | null): SiteSettings {
  if (!data) {
    return FALLBACK_SETTINGS;
  }

  return {
    siteTitle: data.siteTitle ?? FALLBACK_SETTINGS.siteTitle,
    siteDescription: data.siteDescription ?? FALLBACK_SETTINGS.siteDescription,
    contactEmail: data.contactEmail ?? FALLBACK_SETTINGS.contactEmail,
    navLinks: data.navLinks ?? FALLBACK_SETTINGS.navLinks,
    footerLinks: data.footerLinks ?? FALLBACK_SETTINGS.footerLinks,
    metaKeywords: data.metaKeywords ?? FALLBACK_SETTINGS.metaKeywords,
    fancyAccent: data.fancyAccent ?? FALLBACK_SETTINGS.fancyAccent,
    simpleAccent: data.simpleAccent ?? FALLBACK_SETTINGS.simpleAccent,
    ogImageUrl: urlForImage(data.ogImage) ?? FALLBACK_SETTINGS.ogImageUrl,
  };
}

export async function getHomeContent(): Promise<HomeContent> {
  const data = await sanityFetch<HomeQueryResult>(HOME_QUERY);
  return mapHomeContent(data);
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const data = await sanityFetch<SiteSettingsQueryResult>(SETTINGS_QUERY);
  return mapSiteSettings(data);
}

