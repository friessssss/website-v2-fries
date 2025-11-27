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

export const systemPillars = [
  {
    title: 'Edge-to-cloud command planes',
    description:
      'Bidirectional control layers that keep firmware, field devices, and operator dashboards synchronized with full observability.',
    artifacts: ['Rust services', 'WebRTC streams', 'Design tokens'],
  },
  {
    title: 'Immersive telemetry surfaces',
    description:
      'High-contrast, cinematic UIs that help teams read biometrics, timing, and hardware health in milliseconds.',
    artifacts: ['Three.js visualizers', 'Realtime widgets', 'Canvas pipelines'],
  },
  {
    title: 'Field-ready prototyping loops',
    description:
      'Hardware test rigs, fixtures, and rapid firmware updates tightly integrated with product analytics.',
    artifacts: ['HIL Labs', 'Fixture control', 'Autonomous QA'],
  },
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
  {
    title: 'Field Sensor Kit',
    timeframe: '2022',
    summary:
      'Engineered modular sensor packs plus the firmware + cloud bridge so crews could stand up new experiences in minutes.',
    result: 'Deployed to 40+ interactive retail sites worldwide.',
    stack: ['Embedded C', 'TypeScript', 'AWS IoT', 'Figma tokens'],
  },
];

export const contactLinks = [
  {
    label: 'Email',
    href: 'mailto:hey@zachrobertson.co',
    description: 'Preferred for new collaborations and quick intros.',
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/in/zrobertson',
    description: 'Longer form history and role breakdowns.',
  },
  {
    label: 'GitHub',
    href: 'https://github.com/zrobertson',
    description: 'Selected experiments and supporting libraries.',
  },
];

