import { Client } from "@notionhq/client";
import { requireEnv, getEnv } from "../env";

const NOTION_DATABASE_ID_FALLBACK = "37a8701d81fb80f6bdf1fc4188be5e10";
export const HARBOR_BEAN_PROJECT = "Harbor Bean Cafe";

let notionClient: Client | undefined;

export function getNotionClient() {
  notionClient ??= new Client({ auth: requireEnv("NOTION_TOKEN") });
  return notionClient;
}

export function getNotionDatabaseId() {
  return getEnv("NOTION_DATABASE_ID") ?? NOTION_DATABASE_ID_FALLBACK;
}
