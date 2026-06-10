"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

const USERS = [
  {
    id: "carlos",
    name: "Carlos Vincent Frasenda",
    role: "PM/Ops",
    initials: "CF",
  },
  {
    id: "edrick",
    name: "Edrick Kesuma",
    role: "Lead Developer",
    initials: "EK",
  },
  {
    id: "laksh",
    name: "Lakshya Agarwal",
    role: "Design Lead / Payments Manager",
    initials: "LA",
  },
  {
    id: "darren",
    name: "Darren Prasetya",
    role: "Coder Agent Owner",
    initials: "DP",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleLogin(userId: string) {
    setLoading(userId);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setLoading(null);
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 px-6">
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Precision AI
          </h1>
          <p className="text-sm text-muted-foreground">
            Select your identity to continue
          </p>
        </div>

        <div className="space-y-3">
          {USERS.map((user) => (
            <button
              key={user.id}
              type="button"
              disabled={loading !== null}
              onClick={() => handleLogin(user.id)}
              className="w-full flex items-center gap-4 rounded-xl border border-border bg-card p-4 text-left transition-all duration-200 hover:border-primary/50 hover:bg-card/80 disabled:opacity-50 cursor-pointer"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-semibold">
                {user.initials}
              </div>
              <div className="flex-grow min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {user.name}
                </p>
                <p className="text-xs text-muted-foreground">{user.role}</p>
              </div>
              {loading === user.id && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              )}
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Role-based access controls what tools and data you can reach.
        </p>
      </div>
    </div>
  );
}
