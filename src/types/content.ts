import type { PortableTextBlock } from "sanity";

export type NavLink = {
  label: string;
  href: string;
  variant?: "default" | "primary";
};

export type CTA = {
  label: string;
  href: string;
  style?: "solid" | "outline" | "ghost";
};

export type Stat = {
  label: string;
  value: string;
  detail?: string;
};

export type ExperienceEntry = {
  role: string;
  company: string;
  range?: string;
  summary?: string;
  highlights?: string[];
};

export type ProjectCard = {
  name: string;
  slug?: string;
  summary?: string;
  tech?: string[];
  cta?: CTA | null;
  secondaryLink?: CTA | null;
  status?: "live" | "wip" | "experiment" | string;
};

export type PlaylistPick = {
  title: string;
  description?: string;
  spotifyUrl?: string;
};

export type HeroContent = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  ctas?: CTA[];
  stats?: Stat[];
};

export type AboutContent = {
  title: string;
  body?: PortableTextBlock[];
  highlights?: string[];
};

export type HomeExperienceContent = {
  heading: string;
  entries: ExperienceEntry[];
};

export type HomeProjectContent = {
  heading: string;
  items: ProjectCard[];
};

export type RLContent = {
  heading: string;
  description?: string;
  stats?: string[];
  cta?: CTA | null;
};

export type NowPlayingContent = {
  heading: string;
  body?: string;
  spotifyHandle?: string;
  playlistEmbed?: string;
  featuredTracks?: PlaylistPick[];
};

export type HomeContent = {
  hero: HeroContent;
  about: AboutContent;
  experience: HomeExperienceContent;
  projects: HomeProjectContent;
  rl: RLContent;
  nowPlaying: NowPlayingContent;
};

export type SiteSettings = {
  siteTitle: string;
  siteDescription?: string;
  contactEmail?: string;
  navLinks?: NavLink[];
  footerLinks?: NavLink[];
  metaKeywords?: string[];
  fancyAccent?: string;
  simpleAccent?: string;
  ogImageUrl?: string;
};

