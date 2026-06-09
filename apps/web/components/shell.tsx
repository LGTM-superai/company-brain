import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Nebula API Health", meta: "Active now", icon: "history" },
  { href: "/knowledge-graph", label: "Source Graph", meta: "Knowledge", icon: "hub" },
  { href: "/users", label: "Team Routing", meta: "People ops", icon: "group" },
];

export function AppShell({ activePath, children }: { activePath: string; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand-link" aria-label="LGTM Company Brain home">
          <span className="brand-mark">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>precision_manufacturing</span>
          </span>
          <span>
            <strong>Precision</strong>
            <span className="brand-kicker">LGTM V3.4.0</span>
          </span>
        </Link>

        <button className="new-chat-btn" type="button">
          <span className="material-symbols-outlined">add</span>
          New Chat
        </button>

        <nav className="nav-list" aria-label="Recent activity">
          <p className="nav-kicker">Recent Activity</p>
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={item.href === activePath ? "nav-item active" : "nav-item"}
              href={item.href}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{item.icon}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.meta}</small>
              </span>
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
        <div className="sidebar-footer">
          <button className="sidebar-action" type="button">
            <span className="material-symbols-outlined">help</span>
            Help Center
          </button>
          <button className="sidebar-action" type="button">
            <span className="material-symbols-outlined">logout</span>
            Log Out
          </button>
        </div>
      </aside>

      <main className="workspace">{children}</main>
    </div>
  );
}
