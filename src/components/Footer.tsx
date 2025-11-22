import Link from 'next/link';
import { FaGithub, FaLinkedin } from 'react-icons/fa6';

const socials = [
  {
    icon: <FaGithub />,
    href: 'https://github.com/zrobertson',
    label: 'Github',
  },
  {
    icon: <FaLinkedin />,
    href: 'https://www.linkedin.com/in/zrobertson',
    label: 'LinkedIn',
  },
];

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer id="contact" className="relative z-10 px-6 pb-16 pt-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 rounded-3xl border border-slate-800/70 bg-slate-950/70 p-8 text-slate-300 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.55em] text-slate-500">
            Contact
          </p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-100 md:text-4xl">
            Ready to connect hardware, firmware, and software into one signal.
          </h2>
          <p className="mt-4 max-w-xl text-base text-slate-400">
            I’m based in Nashville and work across embedded systems, robotics,
            and cloud orchestration. The inbox is always open for new builds and
            gnarly integrations.
          </p>
        </div>
        <div className="flex flex-col gap-4 text-sm font-semibold uppercase tracking-[0.2em]">
          <Link
            href="mailto:hey@zachrobertson.co"
            className="rounded-full border border-slate-500/40 bg-slate-900/80 px-6 py-3 text-center text-slate-100 transition hover:border-white/60 hover:text-white"
          >
            Email Zach
          </Link>
          <div className="flex items-center justify-center gap-4 text-2xl text-slate-400">
            {socials.map((social) => (
              <Link
                key={social.href}
                href={social.href}
                target="_blank"
                rel="noreferrer"
                aria-label={social.label}
                className="rounded-full border border-transparent p-3 transition hover:border-slate-700 hover:text-white"
              >
                {social.icon}
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto mt-6 flex max-w-6xl flex-col gap-2 text-xs uppercase tracking-[0.4em] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span>Zach Robertson — Hardware & Software integration</span>
        <span>© {year}</span>
      </div>
    </footer>
  );
}