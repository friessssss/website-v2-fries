export const heroStats = [
  { label: 'Systems shipped', value: '24', meta: 'production launches' },
  { label: 'Signals observed', value: '6.5B', meta: 'telemetry points' },
  { label: 'Labs orchestrated', value: '12', meta: 'HIL environments' },
];

export const bioParagraphs = [
  "I'm Zach Robertson, a hardware + software integration engineer who treats every build like a signal chain. I sit between physical product, embedded firmware, and the cloud layers that let teams understand what the hardware is saying.",
  'Over the last decade I’ve shipped immersive exhibits, motorsport telemetry stacks, connected retail concepts, and rapid prototypes for companies that needed to align mechanical ambition with reliable software. I care about latency, tactile feedback, and making complex systems feel effortless for operators.',
  'I split my time between Nashville and whatever lab will hand me a badge. My sweet spot is building the thin layer where firmware, data viz, and operations tooling meet.',
];

export const bioSignals = [
  { label: 'Now', value: 'Hardware-in-the-loop lab orchestration for nascent robotics teams.' },
  { label: 'Previous', value: 'Immersive retail displays + motorsport telemetry viewers.' },
  { label: 'Focus', value: 'Bridging electrical, firmware, cloud, and operator experience.' },
  { label: 'Stack', value: 'Rust, TypeScript, Next.js, embedded C, Edge KV, Unreal, Mongo.' },
];



export const projectDeck = [
  {
    title: 'QCAN Explorer',
    timeframe: '2025',
    summary:
      'Wrote a bootleg version of PCAN Explorer that works on Windows, macOS, and Linux. Worked to make the SW backwards compatible with PCAN Explorer, but with some small improvements in areas, and open sourced for the community.',
    result: 'Free open sourced CAN bus analyzer for the community.',
    stack: ['Python', 'PyQt6','CAN',],
    github: 'https://github.com/friessssss/QCAN-Explorer',
  },
  {
    title: 'Rocket League Song Analytics',
    timeframe: '2025',
    summary:
      'Every year, my friends and I track what Christmas songs bring the most goals scored while listening to music on Spotify. Up until now, this was done via hunting thru an excel spreadsheet and manually entering the data. I decided to automate the process, and now we can see the data in a more visual way.',
    result: 'Semi-automated song analytics for best Rocket League songs.',
    stack: ['MongoDB', 'Spotify API', 'Automation'],
    github: 'https://zachrobertson.co/analytics',
  },
];

export const workHistory = [
  {
    year: '2024 - Present',
    title: 'Hardware and Software Integration Engineer',
    company: 'Lightship',
    description: 'Developed complete diagnostic tooling for Lightship\'s fleet of vehicles. Included a custom Linux kernel, CAN bus drivers, and a web-based diagnostic interface. Learned Ins and Outs of the complete vehicle stack in order to effective troubleshoot and repair vehicles.',
    technologies: ['Python', 'Linux Development', 'CAN', 'Diagnostics', 'Jack of all trades'],
  },
  {
    year: '2022 - 2024',
    title: 'Group Engineer',
    company: 'Schaeffler Group',
    description: 'Developed control algorithims for steer by wire and force feedback systems. Wrote system requirements and specifications for Battery Management System to expand into new markets.',
    technologies: ['MATLab', 'Swift', 'CAN', 'On-Road Testing', 'System Requirements'],
  },
];

export const contactLinks = [
  {
    label: 'Email',
    href: 'mailto:zach@zachrobertson.co',
    description: 'For quick intros!',
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/in/zach-robertson',
    description: 'Connect with me!',
  },
  {
    label: 'GitHub',
    href: 'https://github.com/friessssss',
    description: 'Some assorted projects.',
  },
];

