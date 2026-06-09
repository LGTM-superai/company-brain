"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import type { AgentEvent } from "@company-brain/shared";
import type { DashboardAgent, DashboardConversation, DashboardMessage } from "../../lib/data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Mic, Bot, Wrench, Sparkles, ExternalLink } from "lucide-react";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversation = conversations[0];
  const toolCount = useMemo(() => new Set(agents.flatMap((agent) => agent.tools)).size, [agents]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
    <section className="flex-grow flex flex-col overflow-hidden relative">
      {/* Chat messages */}
      <div ref={scrollRef} className="flex-grow overflow-y-auto p-6">
        <div className="max-w-2xl w-full mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center pt-32 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Company Brain</h2>
              <p className="text-muted-foreground text-sm">
                {agents.length} agents &middot; {toolCount} tools ready
              </p>
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble key={message.messageId} message={message} />
          ))}
          {isRunning && <TypingIndicator />}
        </div>
      </div>

      {/* Input area */}
      <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-background via-background/95 to-transparent">
        <form onSubmit={submitMessage} className="max-w-2xl mx-auto relative">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="h-12 pl-4 pr-24 rounded-xl border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-primary"
            placeholder="Ask anything..."
            type="text"
          />
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-accent cursor-pointer"
            >
              <Mic className="h-4 w-4" />
            </Button>
            <Button
              type="submit"
              disabled={isRunning}
              size="sm"
              className="h-8 gap-1 rounded-lg cursor-pointer"
            >
              <span className="text-xs font-semibold">{isRunning ? "..." : "Send"}</span>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="typing-indicator flex items-center gap-1 pt-2">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatItem }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground">
          <p className="text-sm">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.role === "tool") {
    return (
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 flex-shrink-0">
          <Wrench className="h-3.5 w-3.5 text-accent" />
        </div>
        <div className="flex-grow min-w-0 space-y-2">
          <p className="text-xs font-mono text-accent uppercase tracking-wider">
            {message.toolName ?? "tool"}
          </p>
          {message.exaResults?.length ? (
            <div className="space-y-2">
              {message.exaResults.map((result) => (
                <Card key={result.url} className="bg-card border-border">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <strong className="text-sm text-foreground leading-tight">
                        {result.title}
                      </strong>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {result.summary}
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1 truncate">
                      {result.url}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{message.content}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-grow min-w-0 pt-0.5">
        <p className="text-sm text-foreground leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}
