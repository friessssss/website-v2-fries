import { afterAll, beforeAll, beforeEach } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ensureIndexes } from '../db';

/** Starts one in-memory MongoDB per test file; resets the database before each test. */
export function useTestDb(): () => Db {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
    db = client.db('rl-tracker-test');
  });

  beforeEach(async () => {
    await db.dropDatabase();
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  return () => db;
}
