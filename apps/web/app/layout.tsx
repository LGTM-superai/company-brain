import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Precision AI | Command Center",
  description: "AI-powered command center for your company brain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="overflow-hidden flex h-screen antialiased">{children}</body>
    </html>
  );
}
