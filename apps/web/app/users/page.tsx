import { AppShell } from "../../components/shell";
import { getDashboardData } from "../../lib/data";
import { getSessionUser } from "../../lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default async function UsersPage() {
  const [data, sessionUser] = await Promise.all([getDashboardData(), getSessionUser()]);

  return (
    <AppShell activePath="/users" currentUser={sessionUser ? { id: sessionUser.id, name: sessionUser.name, role: sessionUser.role } : null}>
      {data.error ? (
        <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
          {data.error} Run `bun run seed` after setting MONGODB_URL.
        </div>
      ) : null}

      <div className="p-6 overflow-y-auto flex-grow">
        <div className="mb-6">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Users
          </p>
          <h2 className="text-2xl font-bold text-foreground">Team Directory</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.users.map((user) => (
            <Card key={user.userId} className="bg-card border-border">
              <CardContent className="p-5 flex gap-4">
                <Avatar className="h-11 w-11 border border-border flex-shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                    {user.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{user.name}</h3>
                  <p className="text-sm text-muted-foreground">{user.role}</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">{user.email}</p>
                  <ul className="mt-2 space-y-0.5">
                    {user.responsibilities.map((r) => (
                      <li key={r} className="text-xs text-muted-foreground">
                        &bull; {r}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
