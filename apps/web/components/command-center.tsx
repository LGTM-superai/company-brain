"use client";

import { useState, useCallback } from "react";
import type { DashboardConversation, DashboardMessage, DashboardAgent } from "../lib/data";
import { AppShell } from "./shell";
import { ChatInterface } from "./chat/chat-interface";

export function CommandCenter({
  conversations: initialConversations,
  initialMessages,
  agents,
  error,
}: {
  conversations: DashboardConversation[];
  initialMessages: DashboardMessage[];
  agents: DashboardAgent[];
  error?: string;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialConversations[0]?.conversationId ?? null
  );
  const [messages, setMessages] = useState<DashboardMessage[]>(initialMessages);

  const handleSelectConversation = useCallback(async (conversationId: string) => {
    setActiveConversationId(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
      }
    } catch {
      setMessages([]);
    }
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
  }, []);

  const handleConversationCreated = useCallback(
    (conversationId: string, title: string) => {
      setActiveConversationId(conversationId);
      setConversations((prev) => {
        if (prev.some((c) => c.conversationId === conversationId)) return prev;
        return [
          { conversationId, title, summary: "", updatedLabel: "Just now" },
          ...prev,
        ];
      });
    },
    []
  );

  return (
    <AppShell
      activePath="/"
      conversations={conversations.map((c) => ({
        conversationId: c.conversationId,
        title: c.title,
        updatedLabel: c.updatedLabel,
      }))}
      activeConversationId={activeConversationId}
      onSelectConversation={handleSelectConversation}
      onNewChat={handleNewChat}
    >
      {error ? (
        <div className="m-4 border border-error/30 rounded-lg bg-error/5 p-3 text-error text-sm">
          {error} Run `bun run seed` after setting MONGODB_URL.
        </div>
      ) : null}

      <ChatInterface
        conversations={conversations}
        initialMessages={messages}
        agents={agents}
        activeConversationId={activeConversationId}
        onConversationCreated={handleConversationCreated}
      />
    </AppShell>
  );
}
