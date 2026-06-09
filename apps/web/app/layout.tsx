import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "LGTM Company Brain",
  description: "Agentic company brain for project, knowledge, and action workflows.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
