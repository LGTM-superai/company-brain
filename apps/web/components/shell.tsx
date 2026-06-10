"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Terminal, GitGraph, Users, Settings, Sparkles, Shield, Trash2, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";

const navItems = [
  { href: "/", label: "Command Center", icon: Terminal },
  { href: "/knowledge-graph", label: "Knowledge Graph", icon: GitGraph },
  { href: "/users", label: "Users", icon: Users },
  { href: "/vulnerability", label: "Vulnerability", icon: Shield },
];

export function AppShell({
  activePath,
  children,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  currentUser,
}: {
  activePath: string;
  children: ReactNode;
  conversations?: { conversationId: string; title: string; updatedLabel: string }[];
  activeConversationId?: string | null;
  onSelectConversation?: (conversationId: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (conversationId: string) => void;
  currentUser?: { id: string; name: string; role: string } | null;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "h-screen flex-shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
          collapsed ? "w-14 p-4" : "w-72 p-4"
        )}
      >
        {/* Header */}
        <div className={cn("mb-6 flex items-center gap-3", collapsed ? "px-1 justify-center" : "px-2")}>
          {!collapsed && (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary flex-shrink-0">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-sidebar-foreground flex-1">
              Insider AI
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-sidebar-foreground transition-colors cursor-pointer rounded p-1 hover:bg-sidebar-accent"
                onClick={() => setCollapsed((c) => !c)}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent>
          </Tooltip>
        </div>

        {/* New Chat */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className={cn("mb-4 gap-2 cursor-pointer shrink-0", collapsed ? "w-full px-0 justify-center" : "w-full")}
              onClick={onNewChat}
            >
              <Plus className="h-4 w-4 flex-shrink-0" />
              {!collapsed && "New Chat"}
            </Button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">New Chat</TooltipContent>}
        </Tooltip>

        {/* Nav */}
        <nav className="flex flex-col gap-1 mb-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center rounded-lg py-2 text-sm transition-colors duration-200 cursor-pointer",
                      collapsed ? "justify-center px-2" : "gap-3 px-3",
                      item.href === activePath
                        ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {!collapsed && item.label}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <Separator className="mb-4 bg-sidebar-border" />

        {/* Recent conversations */}
        {!collapsed && conversations && conversations.length > 0 && (
          <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2 px-2">
              Recent
            </p>
            <ScrollArea className="flex-grow">
              <div className="flex flex-col gap-1">
                {conversations.map((conv) => (
                  <div
                    key={conv.conversationId}
                    className={cn(
                      "group grid grid-cols-[1fr_24px] items-center gap-1 px-3 py-2.5 rounded-lg transition-colors duration-200",
                      conv.conversationId === activeConversationId
                        ? "bg-sidebar-accent"
                        : "hover:bg-sidebar-accent"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectConversation?.(conv.conversationId)}
                      className="min-w-0 text-left cursor-pointer"
                    >
                      <p className="text-sm text-sidebar-foreground truncate">{conv.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {conv.updatedLabel}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteConversation?.(conv.conversationId);
                      }}
                      className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors duration-200 cursor-pointer rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <Separator className="mt-auto mb-3 bg-sidebar-border" />

        {/* User footer */}
        <div className={cn("flex items-center gap-3", collapsed ? "justify-center px-1" : "px-2")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-8 w-8 border border-sidebar-border flex-shrink-0">
                <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-xs font-medium">
                  {currentUser
                    ? currentUser.name
                        .split(" ")
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)
                    : "?"}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                {currentUser?.name ?? "Unknown"} · {currentUser?.role}
              </TooltipContent>
            )}
          </Tooltip>

          {!collapsed && (
            <>
              <div className="flex-grow overflow-hidden">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {currentUser?.name ?? "Unknown"}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {currentUser?.role}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-red-400 transition-colors duration-200 cursor-pointer"
                    onClick={async () => {
                      await fetch("/api/auth/logout", { method: "POST" });
                      router.push("/login");
                      router.refresh();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Log out</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </aside>

      <div className="flex-grow flex flex-col relative overflow-hidden">
        <header className="w-full h-14 border-b border-border bg-background flex items-center px-6">
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Insider AI
          </h1>
        </header>
        <main className="flex-grow flex flex-col overflow-hidden">{children}</main>
      </div>
    </TooltipProvider>
  );
}
