import { getDb } from "./client.js";
import type { CveRecord, CveStatus } from "../types.js";

const LEASE_TTL_MS = 20 * 60 * 1000; // 20 minutes

async function collection() {
  const db = await getDb();
  const coll = db.collection<CveRecord>("cves");
  // Dedup key: one CVE per repo
  await coll.createIndex(
    { repo: 1, cveId: 1 },
    { unique: true, name: "uniq_repo_cve" }
  );
  return coll;
}

/**
 * Atomically claim a CVE for processing via a re-claimable lease.
 * Returns true if THIS worker claimed it (first time, or lease expired).
 * Returns false if another worker holds a valid lease (dedup / in-flight).
 */
export async function claimCve(
  doc: Omit<CveRecord, "status" | "createdAt" | "lockedUntil">
): Promise<boolean> {
  const coll = await collection();
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LEASE_TTL_MS);

  const result = await coll.findOneAndUpdate(
    {
      repo: doc.repo,
      cveId: doc.cveId,
      $or: [
        // Does not exist yet
        { createdAt: { $exists: false } },
        // Existed but processing lease expired (Lambda timed out)
        {
          status: "processing",
          lockedUntil: { $lt: now },
        },
        // Previously errored — allow retry
        { status: "error" },
      ],
    },
    {
      $setOnInsert: { createdAt: now, ...doc },
      $set: { status: "processing" as CveStatus, lockedUntil },
    },
    { upsert: true, returnDocument: "after" }
  );

  // If findOneAndUpdate matched (result != null), this worker won the lease
  return result !== null;
}

export async function updateCveStatus(
  repo: string,
  cveId: string,
  update: Partial<
    Pick<
      CveRecord,
      | "status"
      | "prUrl"
      | "branch"
      | "slackTs"
      | "sandboxId"
      | "error"
      | "skipReason"
      | "processedAt"
      | "patchedVersion"
      | "vulnerableRange"
      | "severity"
      | "advisoryUrl"
    >
  >
): Promise<void> {
  const coll = await collection();
  await coll.updateOne(
    { repo, cveId },
    { $set: { ...update, processedAt: update.processedAt ?? new Date() } }
  );
}

export async function findCve(
  repo: string,
  cveId: string
): Promise<CveRecord | null> {
  const coll = await collection();
  return coll.findOne({ repo, cveId });
}
