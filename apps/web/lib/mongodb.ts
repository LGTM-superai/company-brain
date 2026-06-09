import mongoose from "mongoose";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type MongooseCache = {
  connection: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = globalThis.mongooseCache ?? {
  connection: null,
  promise: null,
};

globalThis.mongooseCache = cache;

export async function connectMongo() {
  if (cache.connection) {
    return cache.connection;
  }

  const uri = process.env.MONGODB_URL ?? readRootEnvValue("MONGODB_URL");

  if (!uri) {
    throw new Error("MONGODB_URL is not set.");
  }

  const dbName =
    process.env.MONGODB_DB_NAME ?? readRootEnvValue("MONGODB_DB_NAME") ?? defaultDbNameFor(uri);

  cache.promise ??= mongoose.connect(uri, {
    bufferCommands: false,
    ...(dbName ? { dbName } : {}),
    serverSelectionTimeoutMS: 8000,
  });

  cache.connection = await cache.promise;
  return cache.connection;
}

export async function disconnectMongo() {
  if (cache.connection) {
    await mongoose.disconnect();
    cache.connection = null;
    cache.promise = null;
  }
}

function readRootEnvValue(key: string) {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;

    const line = readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${key}=`));

    if (!line) continue;

    const rawValue = line.slice(key.length + 1).trim();
    return rawValue.replace(/^["']|["']$/g, "");
  }

  return undefined;
}

function defaultDbNameFor(uri: string) {
  try {
    const pathDbName = new URL(uri).pathname.replace(/^\/+/, "");
    return pathDbName ? undefined : "company_brain";
  } catch {
    return "company_brain";
  }
}
