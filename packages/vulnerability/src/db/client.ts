import { MongoClient } from "mongodb";
import { getConfig } from "../config.js";

let _client: MongoClient | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (_client) return _client;

  const cfg = await getConfig();

  const uri =
    `mongodb://${encodeURIComponent(cfg.docdbUser)}:${encodeURIComponent(cfg.docdbPass)}` +
    `@${cfg.docdbEndpoint}:27017/cvedb` +
    `?replicaSet=rs0&readPreference=primary&retryWrites=false&directConnection=false`;

  // TLS is disabled on this DocumentDB cluster (parameter group tls=disabled)
  _client = new MongoClient(uri, {
    tls: false,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });

  await _client.connect();
  return _client;
}

export async function getDb() {
  const client = await getMongoClient();
  return client.db("cvedb");
}
