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
      <div className="mx-auto mt-6 flex max-w-6xl flex-col gap-2 text-xs uppercase tracking-[0.4em] text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span>Zach Robertson — Hardware & Software integration</span>
        <span>© {year}</span>
      </div>
    </footer>
  );
}