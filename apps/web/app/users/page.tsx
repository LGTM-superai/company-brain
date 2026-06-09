import { users } from "@company-brain/shared";

export default function UsersPage() {
  return (
    <main>
      <h1>Users</h1>
      <ul>
        {users.map((user) => (
          <li key={user.id}>
            <strong>{user.name}</strong> - {user.role}
          </li>
        ))}
      </ul>
    </main>
  );
}
