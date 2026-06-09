import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Command Center" },
  { href: "/knowledge-graph", label: "Knowledge Graph" },
  { href: "/users", label: "Users" },
];

export function AppShell({ activePath, children }: { activePath: string; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand-link" aria-label="LGTM Company Brain home">
          <span className="brand-mark">LG</span>
          <span>
            <span className="brand-kicker">LGTM</span>
            <strong>Company Brain</strong>
          </span>
        </Link>

        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={item.href === activePath ? "nav-item active" : "nav-item"}
              href={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <section className="source-panel">
          <p className="eyebrow">Sources</p>
          <div className="source-row"><span className="source-dot on" />Notion</div>
          <div className="source-row"><span className="source-dot on" />Slack</div>
          <div className="source-row"><span className="source-dot on" />GitHub</div>
          <div className="source-row"><span className="source-dot on" />MongoDB</div>
          <div className="source-row"><span className="source-dot warm" />Exa</div>
        </section>
      </aside>

      <main className="workspace">{children}</main>
    </div>
  );
}
