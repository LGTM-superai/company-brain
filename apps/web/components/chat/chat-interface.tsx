"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentEvent, ExaUseCase } from "@company-brain/shared";
import type { DashboardAgent, DashboardConversation, DashboardMessage } from "../../lib/data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Send, Mic, Bot, Wrench, Sparkles, ExternalLink, Shield,
  Package, Pause, AlertTriangle, Search, CheckCircle, XCircle,
  Newspaper, Bug, CreditCard, UtensilsCrossed, Users, DollarSign,
  Leaf, ShieldAlert,
} from "lucide-react";

type ChatItem =
  | DashboardMessage
  | {
      messageId: string;
      role: "assistant" | "tool" | "user";
      content: string;
      toolName?: string;
      exaResults?: DashboardMessage["exaResults"];
      repoMonitors?: DashboardMessage["repoMonitors"];
      exaVerdict?: DashboardMessage["exaVerdict"];
      exaCVE?: DashboardMessage["exaCVE"];
      exaNews?: DashboardMessage["exaNews"];
      budgetAllocations?: DashboardMessage["budgetAllocations"];
      foodOrder?: DashboardMessage["foodOrder"];
      _pending?: boolean;
      _runId?: string;
      _useCase?: ExaUseCase;
    };

export function ChatInterface({
  initialMessages,
  agents,
  activeConversationId,
  onConversationCreated,
}: {
  conversations?: DashboardConversation[];
  initialMessages: DashboardMessage[];
  agents: DashboardAgent[];
  activeConversationId?: string | null;
  onConversationCreated?: (conversationId: string, title: string) => void;
}) {
  const [messages, setMessages] = useState<ChatItem[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [pendingRuns, setPendingRuns] = useState<Map<string, ExaUseCase>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  const toolCount = useMemo(() => new Set(agents.flatMap((agent) => agent.tools)).size, [agents]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (pendingRuns.size === 0) return;

    const interval = setInterval(async () => {
      for (const [runId, useCase] of pendingRuns) {
        try {
          const res = await fetch(`/api/runs/${runId}/events`);
          if (!res.ok) continue;
          const data = await res.json();

          if (data.status === "completed" || data.status === "failed") {
            setMessages((prev) =>
              prev.map((msg) => {
                if (!("_runId" in msg) || msg._runId !== runId) return msg;

                if (data.status === "failed") {
                  return { ...msg, _pending: false, content: data.error ?? "Exa search failed." };
                }

                const result = data.result;
                const updated: ChatItem = { ...msg, _pending: false };

                if (useCase === "research" && result?.results) {
                  updated.exaResults = result.results.map((r: { title: string; url: string; summary: string; published_date?: string }) => ({
                    title: r.title,
                    url: r.url,
                    summary: r.summary,
                    publishedDate: r.published_date,
                  }));
                  updated.content = "Exa search results";
                } else if (useCase === "verification" && result?.verdict) {
                  updated.exaVerdict = result.verdict;
                  updated.content = "Exa verdict";
                } else if (useCase === "cve" && result?.result) {
                  updated.exaCVE = result.result;
                  updated.content = "CVE details";
                } else if (useCase === "news" && result?.articles) {
                  updated.exaNews = result.articles;
                  updated.content = "News results";
                }

                return updated;
              }),
            );

            setPendingRuns((prev) => {
              const next = new Map(prev);
              next.delete(runId);
              return next;
            });
          }
        } catch {
          // polling error — will retry next interval
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [pendingRuns]);

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
        body: JSON.stringify({ conversationId: activeConversationId ?? undefined, message: text }),
      });

      if (!response.ok) {
        throw new Error("Company Brain could not persist this run.");
      }

      const payload = (await response.json()) as { conversationId: string; events: AgentEvent[] };

      if (payload.conversationId && onConversationCreated) {
        onConversationCreated(payload.conversationId, text.length > 49 ? text.slice(0, 49) + "..." : text);
      }

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

        if (agentEvent.type === "exa_searching") {
          eventMessages.push({
            messageId: `exa-pending-${agentEvent.runId}`,
            role: "tool",
            content: `Searching (${agentEvent.useCase})...`,
            toolName: "queryExa",
            _pending: true,
            _runId: agentEvent.runId,
            _useCase: agentEvent.useCase,
          });
          setPendingRuns((prev) => new Map(prev).set(agentEvent.runId, agentEvent.useCase));
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

        if (agentEvent.type === "exa_verdict") {
          eventMessages.push({
            messageId: `exa-verdict-${Date.now()}-${index}`,
            role: "tool",
            content: "Exa verdict",
            toolName: "queryExa",
            exaVerdict: agentEvent.verdict,
          });
          return;
        }

        if (agentEvent.type === "exa_cve") {
          eventMessages.push({
            messageId: `exa-cve-${Date.now()}-${index}`,
            role: "tool",
            content: "CVE details",
            toolName: "queryExa",
            exaCVE: agentEvent.result,
          });
          return;
        }

        if (agentEvent.type === "exa_news") {
          eventMessages.push({
            messageId: `exa-news-${Date.now()}-${index}`,
            role: "tool",
            content: "News results",
            toolName: "queryExa",
            exaNews: agentEvent.articles,
          });
          return;
        }

        if (agentEvent.type === "repo_monitors") {
          eventMessages.push({
            messageId: `repos-${Date.now()}-${index}`,
            role: "tool",
            content: "Repo monitors",
            toolName: "queryRepos",
            repoMonitors: agentEvent.monitors,
          });
          return;
        }

        if (agentEvent.type === "budget_allocated") {
          eventMessages.push({
            messageId: `budget-${Date.now()}-${index}`,
            role: "tool",
            content: "Budget allocated",
            toolName: "makePayment",
            budgetAllocations: agentEvent.allocations,
          });
          return;
        }

        if (agentEvent.type === "food_order") {
          eventMessages.push({
            messageId: `food-${Date.now()}-${index}`,
            role: "tool",
            content: "Food order",
            toolName: "buySomething",
            foodOrder: agentEvent.order,
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
      <div ref={scrollRef} className="flex-grow overflow-y-auto p-6 pb-28">
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

function ExaSearchingSkeleton({ useCase }: { useCase?: ExaUseCase }) {
  const label =
    useCase === "verification" ? "Verifying claim..." :
    useCase === "cve" ? "Investigating vulnerability..." :
    useCase === "news" ? "Finding recent articles..." :
    "Searching the web...";

  return (
    <Card className="bg-card border-border animate-pulse">
      <CardContent className="p-3 flex items-center gap-3">
        <Search className="h-4 w-4 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

function ExaVerdictCard({ verdict }: { verdict: NonNullable<DashboardMessage["exaVerdict"]> }) {
  const confidenceColor =
    verdict.confidence === "high" ? "bg-green-500/10 text-green-600" :
    verdict.confidence === "medium" ? "bg-yellow-500/10 text-yellow-600" :
    "bg-red-500/10 text-red-600";

  const verdictIcon = verdict.verdict.toLowerCase().includes("confirm") || verdict.verdict.toLowerCase().includes("true")
    ? <CheckCircle className="h-4 w-4 text-green-600" />
    : <XCircle className="h-4 w-4 text-red-500" />;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {verdictIcon}
            <strong className="text-sm text-foreground">{verdict.verdict}</strong>
          </div>
          <Badge className={cn("text-[10px] h-5", confidenceColor)}>
            {verdict.confidence} confidence
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{verdict.summary}</p>
        {verdict.evidence_url && (
          <a
            href={verdict.evidence_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {verdict.evidence_title || verdict.evidence_url}
          </a>
        )}
        {verdict.recommended_next_step && (
          <p className="text-[11px] text-muted-foreground/70 italic">
            Next: {verdict.recommended_next_step}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ExaCVECard({ cve }: { cve: NonNullable<DashboardMessage["exaCVE"]> }) {
  const severityColor =
    cve.severity === "critical" ? "bg-red-500/10 text-red-600" :
    cve.severity === "high" ? "bg-orange-500/10 text-orange-600" :
    cve.severity === "medium" ? "bg-yellow-500/10 text-yellow-600" :
    "bg-blue-500/10 text-blue-600";

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-red-500" />
            <strong className="text-sm text-foreground font-mono">{cve.cve_id}</strong>
          </div>
          <Badge className={cn("text-[10px] h-5", severityColor)}>
            {cve.severity}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{cve.summary}</p>
        {cve.affected_packages.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <Package className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            {cve.affected_packages.map((pkg) => (
              <span key={pkg} className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {pkg}
              </span>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground">Mitigation:</strong> {cve.mitigation}
        </div>
        {cve.patch_url && (
          <a
            href={cve.patch_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Patch available
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function ExaNewsCards({ articles }: { articles: NonNullable<DashboardMessage["exaNews"]> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Newspaper className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground">
          News ({articles.length})
        </span>
      </div>
      {articles.map((article) => (
        <Card key={article.url} className="bg-card border-border">
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-2">
              <strong className="text-sm text-foreground leading-tight">{article.title}</strong>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{article.summary}</p>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground/60 mt-1">
              <span>{article.source}</span>
              <span>{article.published_date}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BudgetAllocationsCard({ allocations }: { allocations: NonNullable<DashboardMessage["budgetAllocations"]> }) {
  const total = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <CreditCard className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground">
          Budget Allocation ({allocations.length} project{allocations.length > 1 ? "s" : ""})
        </span>
        <Badge className="text-[10px] h-5 bg-green-500/10 text-green-600 ml-auto">
          ${(total / 100).toFixed(2)} total
        </Badge>
      </div>
      {allocations.map((allocation) => (
        <Card key={allocation.cardId} className="bg-card border-border">
          <CardContent className="p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-3.5 w-3.5 text-green-500" />
                <strong className="text-sm text-foreground">{allocation.projectId}</strong>
              </div>
              <span className="text-sm font-mono text-foreground">
                ${(allocation.amountCents / 100).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground/70">
              <span>Card: •••• {allocation.cardId.slice(-4)}</span>
              <Badge
                variant={allocation.status === "active" ? "default" : "secondary"}
                className="text-[10px] h-4"
              >
                {allocation.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FoodOrderCard({ order }: { order: NonNullable<DashboardMessage["foodOrder"]> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <UtensilsCrossed className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground">
          Team Lunch — {order.teamName}
        </span>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {order.headcount} people
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> ~${(order.budgetPerHeadCents / 100).toFixed(0)}/person
            </span>
          </div>

          {order.dietary.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Leaf className="h-3 w-3 text-green-500 flex-shrink-0" />
              {order.dietary.map((d) => (
                <span key={d} className="text-[11px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded">
                  {d}
                </span>
              ))}
            </div>
          )}

          {order.allergens.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <ShieldAlert className="h-3 w-3 text-red-400 flex-shrink-0" />
              {order.allergens.map((a) => (
                <span key={a} className="text-[11px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded">
                  {a}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {order.recommendations.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Recommendations
          </span>
          {order.recommendations.map((rec) => (
            <Card key={rec.url} className="bg-card border-border">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-sm text-foreground leading-tight">
                    {rec.restaurantName}
                  </strong>
                  <a href={rec.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5 hover:text-primary" />
                  </a>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{rec.reason}</p>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground/60 mt-1">
                  <span>{rec.estimatedCostPerHead}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {order.payment && (
        <Card className="bg-green-500/5 border-green-500/20">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm text-foreground font-medium">
                Payment {order.payment.status}
              </span>
            </div>
            <span className="text-sm font-mono text-green-600">
              ${(order.payment.totalCents / 100).toFixed(2)}
            </span>
          </CardContent>
        </Card>
      )}
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
    const isPending = "_pending" in message && message._pending;
    const useCase = "_useCase" in message ? message._useCase : undefined;

    return (
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 flex-shrink-0">
          <Wrench className="h-3.5 w-3.5 text-accent" />
        </div>
        <div className="flex-grow min-w-0 space-y-2">
          <p className="text-xs font-mono text-accent uppercase tracking-wider">
            {message.toolName ?? "tool"}
          </p>
          {isPending ? (
            <ExaSearchingSkeleton useCase={useCase} />
          ) : message.budgetAllocations?.length ? (
            <BudgetAllocationsCard allocations={message.budgetAllocations} />
          ) : message.foodOrder ? (
            <FoodOrderCard order={message.foodOrder} />
          ) : message.exaVerdict ? (
            <ExaVerdictCard verdict={message.exaVerdict} />
          ) : message.exaCVE ? (
            <ExaCVECard cve={message.exaCVE} />
          ) : message.exaNews?.length ? (
            <ExaNewsCards articles={message.exaNews} />
          ) : message.repoMonitors?.length ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-foreground">
                  CVE Monitors ({message.repoMonitors.length})
                </span>
              </div>
              {message.repoMonitors.map((monitor) => (
                <Card key={monitor.monitorId} className="bg-card border-border">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-foreground leading-tight">
                        {monitor.owner}/{monitor.repo}
                      </strong>
                      <Badge
                        variant={monitor.status === "active" ? "default" : "secondary"}
                        className="text-[10px] h-5"
                      >
                        {monitor.status === "paused" && <Pause className="h-2.5 w-2.5 mr-1" />}
                        {monitor.status === "error" && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
                        {monitor.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <Package className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      {monitor.packages.slice(0, 4).map((pkg) => (
                        <span
                          key={pkg}
                          className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
                        >
                          {pkg}
                        </span>
                      ))}
                      {monitor.packages.length > 4 && (
                        <span className="text-[11px] text-muted-foreground">
                          +{monitor.packages.length - 4} more
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground/70">
                      <span>Severity: {monitor.severityThreshold}</span>
                      <span>{new Date(monitor.createdAt).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : message.exaResults?.length ? (
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
      <div className="flex-grow min-w-0 pt-0.5 prose prose-sm prose-invert max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}
