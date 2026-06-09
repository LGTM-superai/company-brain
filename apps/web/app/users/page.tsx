import { AppShell } from "../../components/shell";
import { getDashboardData } from "../../lib/data";

export default async function UsersPage() {
  const data = await getDashboardData();

  return (
    <AppShell activePath="/users">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Users</p>
          <h1>Team Directory</h1>
        </div>
        <p className="audit-note">Used for agent ownership and routing</p>
      </section>

      {data.error ? <div className="setup-banner">{data.error} Run `bun run seed` after setting MONGODB_URL.</div> : null}

      <section className="user-grid">
        {data.users.map((user) => (
          <article className="user-card panel" key={user.userId}>
            <div className="avatar">{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
            <div>
              <h2>{user.name}</h2>
              <p>{user.role}</p>
              <span>{user.email}</span>
              <ul>
                {user.responsibilities.map((responsibility) => (
                  <li key={responsibility}>{responsibility}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
