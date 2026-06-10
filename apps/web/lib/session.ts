import { cookies } from "next/headers";
import { users, type CompanyUser, type PersonId } from "@company-brain/shared";

const SESSION_COOKIE = "precision_user";

export async function getSessionUser(): Promise<CompanyUser | null> {
  const store = await cookies();
  const userId = store.get(SESSION_COOKIE)?.value;
  if (!userId) return null;
  return users.find((u) => u.id === userId) ?? null;
}

export function getSessionUserId(cookieHeader: string | null): PersonId | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)precision_user=([^;]+)/);
  if (!match) return null;
  const id = match[1] as PersonId;
  return users.some((u) => u.id === id) ? id : null;
}

export { SESSION_COOKIE };
