import { getDb } from "./client.js";
import type { RepoMonitor } from "../types.js";

async function collection() {
  const db = await getDb();
  const coll = db.collection<RepoMonitor>("repo_monitors");
  await coll.createIndex(
    { owner: 1, repo: 1 },
    { unique: true, name: "uniq_owner_repo" }
  );
  return coll;
}

export async function upsertRepoMonitor(doc: RepoMonitor): Promise<void> {
  const coll = await collection();
  await coll.replaceOne({ owner: doc.owner, repo: doc.repo }, doc, {
    upsert: true,
  });
}

export async function findByMonitorId(
  monitorId: string
): Promise<RepoMonitor | null> {
  const coll = await collection();
  return coll.findOne({ monitorId });
}

export async function findByRepo(
  owner: string,
  repo: string
): Promise<RepoMonitor | null> {
  const coll = await collection();
  return coll.findOne({ owner, repo });
}

export async function listAll(): Promise<RepoMonitor[]> {
  const coll = await collection();
  return coll.find({}).toArray();
}
