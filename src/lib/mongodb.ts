import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Please add your Mongo URI to .env.local');
}

const uri = process.env.MONGODB_URI;
const options = {};

// In development the cache lives on `global` so HMR module reloads reuse the connection.
const cache: { _mongoClientPromise?: Promise<MongoClient> } =
  process.env.NODE_ENV === 'development' ? (global as typeof globalThis & { _mongoClientPromise?: Promise<MongoClient> }) : {};

/**
 * The shared, connected MongoClient. A failed connect is not cached: the next call retries,
 * so a cold-start blip does not poison the instance.
 */
export function getMongoClient(): Promise<MongoClient> {
  if (!cache._mongoClientPromise) {
    const client = new MongoClient(uri, options);
    const connecting = client.connect();
    cache._mongoClientPromise = connecting;
    connecting.catch(() => {
      if (cache._mongoClientPromise === connecting) delete cache._mongoClientPromise;
      client.close().catch(() => {});
    });
  }
  return cache._mongoClientPromise;
}
