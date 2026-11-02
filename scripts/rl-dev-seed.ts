import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { RL_DB_NAME, ensureIndexes } from '../src/lib/rl/db';
import { seedMatches, seedNight } from '../src/lib/rl/__tests__/fixtures';

async function main(): Promise<void> {
  const server = await MongoMemoryServer.create({ instance: { port: 27018 } });
  const client = await MongoClient.connect(server.getUri());
  const db = client.db(RL_DB_NAME);
  await ensureIndexes(db);
  await seedNight(db); // inserts the roster too
  await seedMatches(db);
  await client.close();

  const uri = 'mongodb://127.0.0.1:27018/';
  console.log(`MONGODB_URI=${uri}`);
  console.log(
    `Run: MONGODB_URI=${uri} RL_GROUP_PASSCODE=test-passcode RL_COOKIE_SECRET=dev RL_TOKEN_KEY=${randomBytes(32).toString('base64')} npm run dev`,
  );
  console.log('Seed server running. Press Ctrl+C to stop.');
  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
