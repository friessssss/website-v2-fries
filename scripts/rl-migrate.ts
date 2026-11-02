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

async function main(): Promise<void> {
  loadEnvLocal();
  // Imported after the env is loaded: '@/lib/mongodb' reads MONGODB_URI at import time.
  const { getDb } = await import('../src/lib/rl/db');
  const { migrateLegacy } = await import('../src/lib/rl/migrate');
  const result = await migrateLegacy(await getDb());
  console.log(`Copied: ${result.copied}`);
  console.log(`Skipped (already migrated): ${result.skipped}`);
  console.log(`Invalid (not copied): ${result.invalid.length}`);
  for (const id of result.invalid) console.log(`  ${id}`);
  console.log(`Unmapped player names (saved as opponent): ${result.unmappedNames.length}`);
  for (const u of result.unmappedNames) console.log(`  ${u.name}: ${u.count}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
