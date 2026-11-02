import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvLocal(): void {
  const file = resolve(process.cwd(), '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length) || undefined;
}

async function main(): Promise<void> {
  loadEnvLocal();
  // Imported after the env is loaded: '@/lib/mongodb' reads MONGODB_URI at import time.
  const { getDb } = await import('../src/lib/rl/db');
  const { seedPlayers } = await import('../src/lib/rl/players');
  const { importSeasonArchive } = await import('../src/lib/rl/importSeasons');
  const data = JSON.parse(
    readFileSync(resolve(process.cwd(), 'data/christmas-league-2021-2023.json'), 'utf8'),
  );
  const db = await getDb(); // also ensures indexes
  await seedPlayers(db);
  const result = await importSeasonArchive(db, data, {
    playlistId: flag('playlist-id'),
    playlistName: flag('playlist-name'),
  });
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Skipped (already imported): ${result.skipped}`);
  console.log(`Songs linked to tracker songs: ${result.matched}`);
  console.log(
    result.playlist.id
      ? `Playlist: ${result.playlist.name ?? '(no name)'} (${result.playlist.id})`
      : 'Playlist: none found (pass --playlist-id= and --playlist-name= to set one)',
  );
  console.log(`Unmatched songs (kept as spelled in the sheet): ${result.unmatched.length}`);
  for (const u of result.unmatched) console.log(`  ${u.year}  ${u.song} - ${u.artist}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
