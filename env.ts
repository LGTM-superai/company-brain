import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function getEnv(key: string): string | undefined {
  return process.env[key] ?? readRootEnvValue(key);
}

export function requireEnv(key: string): string {
  const value = getEnv(key);
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function readRootEnvValue(key: string) {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];

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
