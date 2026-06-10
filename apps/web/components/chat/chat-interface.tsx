"use client";

import { useMemo, useState } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import type { DashboardAgent, DashboardConversation, DashboardMessage } from "../../lib/data";

type DisplayItem =
  | {
      id: string;
      role: "user" | "assistant" | "tool";
      content?: string;
      toolName?: string;
      toolData?: unknown;
      exaResults?: DashboardMessage["exaResults"];
    }
  | {
      id: string;
      role: "ui";
      message: UIMessage;
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
  const seededConversation = conversations[0] ?? fallbackConversations[0];
  const [conversationId, setConversationId] = useState(seededConversation.conversationId);
  const [threadTitle, setThreadTitle] = useState(seededConversation.title);
  const [showSeededHistory, setShowSeededHistory] = useState(true);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, setMessages, clearError } = useChat({ id: conversationId });
  const isRunning = status === "submitted" || status === "streaming";

  const toolCount = useMemo(() => new Set(agents.flatMap((agent) => agent.tools)).size, [agents]);
  const displayItems: DisplayItem[] = [
    ...(showSeededHistory
      ? initialMessages.map((message) => ({
          id: message.messageId,
          role: message.role,
          content: message.content,
          toolName: message.toolName,
          toolData: message.toolData,
          exaResults: message.exaResults,
        }))
      : []),
    ...messages.map((message) => ({
      id: message.id,
      role: "ui" as const,
      message,
    })),
  ];

  async function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isRunning) return;

    setInput("");
    await sendMessage({ text });
  }

  function startNewChat() {
    if (isRunning) return;

    setInput("");
    setMessages([]);
    clearError();
    setShowSeededHistory(false);
    setThreadTitle("Notion MCP test");
    setConversationId(`notion-mcp-chat-${Date.now()}`);
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
          {(conversations.length ? conversations : fallbackConversations).map((conversation, index) => (
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
            <h2>{threadTitle}</h2>
          </div>
          <div className="panel-actions">
            <button className="secondary-button" type="button" onClick={startNewChat} disabled={isRunning}>
              New chat
            </button>
            <span className="quiet-pill">
              {agents.length} agents / {toolCount} tools
            </span>
          </div>
        </div>

        <div className="message-list">
          {displayItems.map((item) => (
            <MessageItem key={item.id} item={item} />
          ))}
          {isRunning ? <div className="tool-line">Company Brain is running...</div> : null}
          {error ? <article className="message assistant-message error-message">{error.message}</article> : null}
        </div>

        <form className="chat-form" onSubmit={submitMessage}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask: What is overdue or potentially blocked for Harbor Bean?"
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

function MessageItem({ item }: { item: DisplayItem }) {
  if (item.role === "ui") {
    return <UiMessageBubble message={item.message} />;
  }

  if (item.role === "tool") {
    return <ToolBlock toolName={item.toolName} toolData={item.toolData} exaResults={item.exaResults} />;
  }

  return (
    <article className={item.role === "user" ? "message user-message" : "message assistant-message"}>
      <strong>{item.role === "user" ? "You" : "Company Brain"}</strong>
      <p>{item.content}</p>
    </article>
  );
}

function UiMessageBubble({ message }: { message: UIMessage }) {
  return (
    <>
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <article
              className={message.role === "user" ? "message user-message" : "message assistant-message"}
              key={`${message.id}-${index}`}
            >
              <strong>{message.role === "user" ? "You" : "Company Brain"}</strong>
              <p>{part.text}</p>
            </article>
          );
        }

        if (part.type.startsWith("tool-")) {
          return <StreamedToolPart key={`${message.id}-${index}`} part={part} />;
        }

        return null;
      })}
    </>
  );
}

function StreamedToolPart({ part }: { part: Record<string, unknown> & { type: string } }) {
  const toolName = part.type.replace(/^tool-/, "");
  const output = part.output as Record<string, unknown> | undefined;
  const state = typeof part.state === "string" ? part.state : "running";

  return (
    <div className="tool-block">
      <div className="tool-line">
        Tool called: {toolName}
        {state === "input-streaming" ? " ..." : ""}
      </div>
      {state === "output-available" && output ? <ToolOutput toolName={toolName} output={output} /> : null}
      {state === "output-error" || part.errorText ? (
        <div className="tool-error">{String(part.errorText ?? `Tool failed: ${toolName}`)}</div>
      ) : null}
    </div>
  );
}

function ToolBlock({
  toolName,
  toolData,
  exaResults,
}: {
  toolName?: string;
  toolData?: unknown;
  exaResults?: DashboardMessage["exaResults"];
}) {
  const output =
    typeof toolData === "object" && toolData && "output" in toolData
      ? ((toolData as { output?: Record<string, unknown> }).output ?? undefined)
      : undefined;

  return (
    <div className="tool-block">
      <div className="tool-line">Tool called: {toolName}</div>
      {output ? <ToolOutput toolName={toolName} output={output} /> : null}
      {exaResults?.length ? <LegacyExaResults results={exaResults} /> : null}
    </div>
  );
}

function ToolOutput({ toolName, output }: { toolName?: string; output: Record<string, unknown> }) {
  if (output.requiresApproval) {
    return <div className="tool-summary">{String(output.message ?? "Approval required.")}</div>;
  }

  if (output.ok === false) {
    return <div className="tool-error">{String(output.message ?? `Tool failed: ${toolName}`)}</div>;
  }

  if (toolName === "queryExa" && output.verdict && typeof output.verdict === "object") {
    const verdict = output.verdict as Record<string, string>;
    return (
      <section className="exa-results">
        <div className="exa-results-header">
          <strong>{verdict.verdict ?? "Exa verdict"}</strong>
          <span>{verdict.blocker_validity ?? verdict.confidence ?? "confidence unknown"}</span>
        </div>
        <article className="exa-result">
          <strong>{verdict.evidence_title}</strong>
          <p>{verdict.summary}</p>
          {verdict.recommended_next_step ? <p>{verdict.recommended_next_step}</p> : null}
          {verdict.notion_note_suggestion ? <small>Notion: {verdict.notion_note_suggestion}</small> : null}
          {verdict.slack_message_suggestion ? <small>Slack: {verdict.slack_message_suggestion}</small> : null}
          <small>{verdict.evidence_url}</small>
        </article>
      </section>
    );
  }

  if (toolName === "queryNotion" && Array.isArray(output.tickets)) {
    return <div className="tool-summary">{output.tickets.length} Notion ticket(s) returned from live board.</div>;
  }

  if (toolName === "querySlack") {
    const channels = Array.isArray(output.routedChannels) ? output.routedChannels.join(", ") : "Slack";
    return <div className="tool-summary">{String(output.count ?? 0)} Slack message(s) returned from {channels}.</div>;
  }

  if (toolName === "updateNotion") {
    return <div className="tool-summary">{String(output.message ?? output.action ?? "Notion update complete")}</div>;
  }

  if (toolName === "updateSlack") {
    const channel = String(output.channel ?? "#company-brain-actions");
    const audit = output.audit ? " Audit logged to #company-brain-actions." : "";
    return <div className="tool-summary">Posted to {channel}.{audit}</div>;
  }

  return null;
}

function LegacyExaResults({ results }: { results: NonNullable<DashboardMessage["exaResults"]> }) {
  return (
    <section className="exa-results">
      <div className="exa-results-header">
        <strong>Exa search results</strong>
        <span>{results.length} results</span>
      </div>
      {results.map((result) => (
        <article className="exa-result" key={result.url}>
          <strong>{result.title}</strong>
          <p>{result.summary}</p>
          <small>
            {result.publishedDate} / {result.url}
          </small>
        </article>
      ))}
    </section>
  );
}

const fallbackConversations = [
  {
    conversationId: "harbor-bean-demo",
    title: "Harbor Bean demo",
    summary: "Ask the five-step Harbor Bean sprint-board sequence.",
    updatedLabel: "Ready",
  },
];
