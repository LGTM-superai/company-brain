"use client";

import { useMemo, useState } from "react";
import type { AgentEvent } from "@company-brain/shared";
import type { DashboardAgent, DashboardConversation, DashboardMessage } from "../../lib/data";

type ChatItem =
  | DashboardMessage
  | {
      messageId: string;
      role: "assistant" | "tool" | "user";
      content: string;
      toolName?: string;
      exaResults?: DashboardMessage["exaResults"];
    };

export function ChatInterface({
  conversations,
  initialMessages,
  agents,
}: {
  conversations: DashboardConversation[];
  initialMessages: DashboardMessage[];
  agents: DashboardAgent[];
}) {
  const [messages, setMessages] = useState<ChatItem[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const activeConversation = conversations[0];
  const toolCount = useMemo(() => new Set(agents.flatMap((agent) => agent.tools)).size, [agents]);

  async function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isRunning) return;

    setInput("");
    setIsRunning(true);

    const userMessage: ChatItem = {
      messageId: `local-user-${Date.now()}`,
      role: "user",
      content: text,
    };

    setMessages((current) => [...current, userMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConversation?.conversationId, message: text }),
      });

      if (!response.ok) {
        throw new Error("Company Brain could not persist this run.");
      }

      const payload = (await response.json()) as { events: AgentEvent[] };
      const eventMessages: ChatItem[] = [];

      payload.events.forEach((agentEvent, index) => {
        if (agentEvent.type === "tool_call") {
          eventMessages.push({
            messageId: `tool-${Date.now()}-${index}`,
            role: "tool",
            content: `Tool called: ${agentEvent.tool}`,
            toolName: agentEvent.tool,
          });
          return;
        }

        if (agentEvent.type === "exa_results") {
          eventMessages.push({
            messageId: `exa-${Date.now()}-${index}`,
            role: "tool",
            content: "Exa search results",
            toolName: "queryExa",
            exaResults: agentEvent.results,
          });
          return;
        }

        if (agentEvent.type === "assistant_message") {
          eventMessages.push({
            messageId: `assistant-${Date.now()}-${index}`,
            role: "assistant",
            content: agentEvent.content,
          });
        }
      });

      setMessages((current) => [...current, ...eventMessages]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          messageId: `assistant-error-${Date.now()}`,
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Company Brain could not persist this run.",
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="command-grid">
      <section className="conversation-sidebar panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">History</p>
            <h2>Conversations</h2>
          </div>
        </div>

        <div className="conversation-list">
          {conversations.map((conversation, index) => (
            <button
              className={index === 0 ? "conversation-item active" : "conversation-item"}
              key={conversation.conversationId}
              type="button"
            >
              <strong>{conversation.title}</strong>
              <span>{conversation.summary}</span>
              <small>{conversation.updatedLabel}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="chat-panel panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Active Thread</p>
            <h2>{activeConversation?.title ?? "No conversations yet"}</h2>
          </div>
          <span className="quiet-pill">{agents.length} agents / {toolCount} tools</span>
        </div>

        <div className="message-list">
          {messages.map((message) => (
            <MessageBubble key={message.messageId} message={message} />
          ))}
        </div>

        <form className="chat-form" onSubmit={submitMessage}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about tickets, docs, blockers, users, or external evidence..."
          />
          <button type="submit" disabled={isRunning}>
            {isRunning ? "Running" : "Send"}
          </button>
        </form>
      </section>

      <section className="agent-sidebar panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Agents</p>
            <h2>Roster</h2>
          </div>
        </div>

        <div className="agent-list">
          {agents.map((agent) => (
            <article className="agent-card" key={agent.agentId}>
              <strong>{agent.name}</strong>
              <span>{agent.owner}</span>
              <p>{agent.purpose}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatItem }) {
  if (message.role === "tool") {
    return (
      <div className="tool-block">
        <div className="tool-line">{message.content}</div>
        {message.exaResults?.length ? (
          <section className="exa-results">
            <div className="exa-results-header">
              <strong>Exa search results</strong>
              <span>{message.exaResults.length} results</span>
            </div>
            {message.exaResults.map((result) => (
              <article className="exa-result" key={result.url}>
                <strong>{result.title}</strong>
                <p>{result.summary}</p>
                <small>{result.publishedDate} / {result.url}</small>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <article className={message.role === "user" ? "message user-message" : "message assistant-message"}>
      <strong>{message.role === "user" ? "You" : "Company Brain"}</strong>
      <p>{message.content}</p>
    </article>
  );
}
