import { NextResponse } from "next/server";
import {
  generateText,
  streamText,
  stepCountIs,
  tool,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import type {
  AgentEvent,
  AgentId,
  AgentPlan,
  BudgetAllocationEvent,
  FoodOrderEvent,
  PlanStep,
  RepoMonitor,
  ToolName,
} from "@company-brain/shared";
import { users, resolveAssignee, type PersonId } from "@company-brain/shared";
import { toolRegistry } from "@company-brain/tools";
import {
  ROUTER_PROMPT,
  SEARCHER_PROMPT,
  UPDATER_PROMPT,
  CODER_PROMPT,
  PAYMENTS_PROMPT,
} from "@company-brain/agents";
import { getRuntimeModel } from "../../../lib/ai-model";
import { connectMongo } from "../../../lib/mongodb";
import { MessageModel } from "../../../lib/models";
import {
  queryExaVerdict as queryHarborBeanExaVerdict,
  queryExaCVE,
  queryExaCVEFast,
  queryExaNews,
  queryExaNewsFast,
  queryExaSearch,
  queryExaSearchFast,
} from "../../../lib/exa-runtime";
import { HARBOR_BEAN_PROJECT } from "../../../lib/notion-runtime";
import {
  queryMcpNotionTickets,
  updateMcpLatestAgentNote,
  updateMcpTicketFields,
} from "../../../lib/notion-mcp-runtime";
import {
  clearPendingAction,
  ensureConversation,
  getNextOrder,
  getPendingAction,
  isApprovalMessage,
  persistAssistantMessage,
  persistSlackAudit,
  persistToolCall,
  persistToolFailure,
  persistToolResult,
  persistUserMessage,
  setPendingAction,
  titleFromMessage,
  updateConversationSummary,
  type PendingAction,
  type TicketFieldChanges,
} from "../../../lib/run-history";
import { gmt8TodayFromNow } from "../../../lib/time";
import { runSpecialist } from "../../../lib/agent-delegation";
import { queryKnowledgeBase } from "../../../lib/knowledge-base";
import { searchDocuments, fetchDocumentContent, listBucketDocuments } from "../../../lib/s3-retrieval";

export const runtime = "nodejs";

type ChatRequestBody = {
  conversationId?: string;
  message?: string;
  deepSearch?: boolean;
};

type SlackChannelPurpose =
  | "announcements"
  | "engineering"
  | "vulnerability-monitoring"
  | "company-brain-actions";

// ── Zod schemas ────────────────────────────────────────────────────────────

const ticketFieldChangesSchema = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  project: z.string().optional(),
  assignee: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.string().optional(),
});

const updateNotionInputSchema = z.object({
  action: z.enum(["record_latest_agent_note", "update_ticket_fields", "move_status"]),
  ticket: z.string(),
  note: z.string().optional(),
  changes: ticketFieldChangesSchema.optional(),
  current: ticketFieldChangesSchema.optional(),
  currentStatus: z.string().optional(),
  newStatus: z.string().optional(),
  approved: z.boolean().optional(),
  reason: z.string().optional(),
});

type UpdateNotionInput = z.infer<typeof updateNotionInputSchema>;

const querySlackInputSchema = z.object({
  query: z.string().optional(),
  channel: z.string().optional(),
  channelPurpose: z
    .enum(["announcements", "engineering", "vulnerability-monitoring", "company-brain-actions"])
    .optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const updateSlackInputSchema = z.object({
  channel: z.string().optional(),
  channelPurpose: z
    .enum(["announcements", "engineering", "vulnerability-monitoring", "company-brain-actions"])
    .optional(),
  text: z.string().optional(),
  message: z.string().optional(),
  system: z.string().optional(),
  target: z.string().optional(),
  action: z.string().optional(),
  mentionPeople: z.array(z.string()).optional(),
  audit: z.boolean().optional(),
  approved: z.boolean().optional(),
  reason: z.string().optional(),
});

type UpdateSlackToolInput = z.infer<typeof updateSlackInputSchema>;

// ── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const rawMessage = body.message?.trim() ?? "";

  if (!rawMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  await connectMongo();

  const conversationId = body.conversationId ?? `conversation-${Date.now()}`;
  await ensureConversation(conversationId, titleFromMessage(rawMessage));

  let nextOrder = await getNextOrder(conversationId);
  await persistUserMessage(conversationId, rawMessage, nextOrder++);

  let pendingAction = await getPendingAction(conversationId);
  let approvalGranted = pendingAction ? isApprovalMessage(rawMessage) : false;

  if (!pendingAction && isSlackSendConfirmation(rawMessage)) {
    const recoveredAction = await recoverPendingSlackActionFromDraft(conversationId);

    if (recoveredAction) {
      await setPendingAction(conversationId, recoveredAction);
      pendingAction = recoveredAction;
      approvalGranted = true;
    }
  }

  const events: AgentEvent[] = [];
  const toolMessageIds = new Map<string, string>();
  const modelMessages = await buildModelMessages(conversationId);
  const toolChoice = forcedToolChoiceForLatestMessage(rawMessage, pendingAction, approvalGranted);

  const encoder = new TextEncoder();
  let fullAnswer = "";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("meta", { conversationId });

      try {
        const sharedContext = {
          conversationId,
          approvalGranted,
          pendingAction,
          events,
          deepSearch: body.deepSearch ?? false,
          send,
          nextOrderRef: {
            get: () => nextOrder,
            set: (value: number) => {
              nextOrder = value;
            },
          },
        };

        const result = streamText({
          model: getRuntimeModel(),
          system: routerSystemPrompt({ pendingAction, approvalGranted }),
          messages: modelMessages,
          tools: buildDelegationTools(sharedContext),
          toolChoice,
          stopWhen: stepCountIs(6),
          maxOutputTokens: 600,
          experimental_onToolCallStart: async (event) => {
            const toolName = event.toolCall.toolName as ToolName;
            const args = event.toolCall.input as Record<string, unknown> | undefined;
            const query = args?.query ?? args?.task ?? args?.ticket ?? args?.action ?? "";
            send("tool_call", { tool: toolName, query });
            events.push({ type: "tool_call", tool: toolName, args });
            const messageId = await persistToolCall(
              conversationId,
              toolName,
              event.toolCall.input,
              nextOrder++,
            );
            toolMessageIds.set(event.toolCall.toolCallId, messageId);
          },
          experimental_onToolCallFinish: async (event) => {
            const messageId = toolMessageIds.get(event.toolCall.toolCallId);
            const toolName = event.toolCall.toolName as string;
            const isDelegation = toolName.startsWith("delegateTo") || toolName === "proposePlan";
            if (event.success) {
              await persistToolResult(messageId, event.output, event.durationMs);
              if (!isDelegation) {
                const output = event.output as Record<string, unknown> | undefined;
                const summary = output?.summary ?? output?.message ?? output?.text ?? "";
                if (summary) {
                  send("tool_done", { tool: toolName, summary: String(summary).slice(0, 200) });
                }
              }
            } else {
              await persistToolFailure(messageId, event.error, event.durationMs);
              if (!isDelegation) {
                const errMsg = typeof event.error === "string" ? event.error : "Tool failed";
                send("tool_done", { tool: toolName, summary: errMsg, error: true });
              }
            }
          },
        });

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            fullAnswer += part.text;
            send("text_delta", { delta: part.text });
          } else if (part.type === "tool-result") {
            const ev = events.find(
              (e) =>
                (e.type === "exa_results" ||
                  e.type === "exa_verdict" ||
                  e.type === "exa_cve" ||
                  e.type === "exa_news" ||
                  e.type === "repo_monitors" ||
                  e.type === "budget_allocated" ||
                  e.type === "food_order") &&
                !("_sent" in e),
            ) as (AgentEvent & { _sent?: boolean }) | undefined;
            if (ev) {
              (ev as AgentEvent & { _sent?: boolean })._sent = true;
              send("agent_event", ev);
            }
          }
        }

        const answer = fullAnswer.trim() || "Done.";
        send("done", { content: answer });

        await persistAssistantMessage(conversationId, answer, nextOrder++);
        await updateConversationSummary(conversationId, summaryFromAnswer(rawMessage, answer));
      } catch (error) {
        const message = friendlyError(error);
        send("error", { content: message });
        await persistAssistantMessage(conversationId, message, nextOrder++);
        await updateConversationSummary(conversationId, message);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── Delegation tools (router level) ───────────────────────────────────────

type SharedContext = {
  conversationId: string;
  approvalGranted: boolean;
  pendingAction: PendingAction | null;
  events: AgentEvent[];
  deepSearch: boolean;
  send: (event: string, data: unknown) => void;
  nextOrderRef: { get: () => number; set: (value: number) => void };
  currentPlanId?: string;
  planSteps?: PlanStep[];
};

function emitStepStart(ctx: SharedContext, agentId: AgentId) {
  if (!ctx.currentPlanId || !ctx.planSteps) return;
  const step = ctx.planSteps.find((s) => s.agent === agentId && s.status === "pending");
  if (step) {
    step.status = "running";
    ctx.send("agent_event", { type: "plan_step_start", planId: ctx.currentPlanId, stepId: step.id });
  }
}

function emitStepDone(ctx: SharedContext, agentId: AgentId, success: boolean) {
  if (!ctx.currentPlanId || !ctx.planSteps) return;
  const step = ctx.planSteps.find((s) => s.agent === agentId && s.status === "running");
  if (step) {
    step.status = success ? "done" : "failed";
    ctx.send("agent_event", { type: "plan_step_done", planId: ctx.currentPlanId, stepId: step.id, success });
  }
}

function buildDelegationTools(ctx: SharedContext) {
  return {
    proposePlan: tool({
      description:
        "ALWAYS call this FIRST before any delegation. Propose a structured execution plan showing which agents and tools will be used. This lets the user see the plan before execution begins.",
      inputSchema: z.object({
        reasoning: z.string().describe("1-2 sentence explanation of your approach"),
        steps: z.array(z.object({
          agent: z.enum(["searcher", "updater", "coder", "paymentsManager"]).describe("Which agent handles this step"),
          tool: z.enum([
            "queryNotion", "updateNotion", "createNotionTicket", "querySlack", "updateSlack",
            "queryGithub", "updateGithub", "queryExa", "queryRepos",
            "queryKnowledgeBase", "makePayment", "buySomething",
          ]).describe("Primary tool for this step"),
          description: z.string().describe("What this step does (user-facing, concise)"),
        })).min(1).max(6).describe("Ordered steps in the plan"),
      }),
      execute: async (input) => {
        const planId = `plan-${Date.now()}`;
        const steps: PlanStep[] = input.steps.map((s, i) => ({
          id: `${planId}-step-${i}`,
          agent: s.agent as AgentId,
          tool: s.tool as ToolName,
          description: s.description,
          status: "pending" as const,
        }));

        const plan: AgentPlan = {
          planId,
          reasoning: input.reasoning,
          steps,
          status: "executing",
        };

        ctx.currentPlanId = planId;
        ctx.planSteps = steps;
        ctx.send("agent_event", { type: "plan_proposed", plan });

        return {
          ok: true,
          planId,
          message: "Plan displayed to user. Now execute ONLY the delegation tools listed in your plan, then write a final text summary. Do NOT call proposePlan again.",
        };
      },
    }),
    delegateToSearcher: tool({
      description:
        "Delegate to the Searcher agent for read-only data retrieval from Notion sprint board, Slack channels, GitHub repos, Exa web search, and repo monitors. Use when gathering information or answering questions about current state.",
      inputSchema: z.object({
        query: z.string().describe("The search query or question to answer"),
        sources: z
          .array(z.enum(["notion", "slack", "github", "exa", "repos"]))
          .optional()
          .describe("Preferred data sources to query"),
      }),
      execute: async (input) => {
        emitStepStart(ctx, "searcher");
        ctx.send("agent_event", { type: "agent_delegation", agent: "searcher", query: input.query });
        const result = await runSpecialist({
          agentId: "searcher",
          systemPrompt: buildSearcherSystemPrompt(ctx),
          tools: buildSearcherTools(ctx),
          query: input.query,
          conversationId: ctx.conversationId,
          events: ctx.events,
          send: ctx.send,
          approvalGranted: false,
          pendingAction: null,
        });
        emitStepDone(ctx, "searcher", result.ok);
        return result;
      },
    }),
    delegateToUpdater: tool({
      description:
        "Delegate to the Updater agent for mutations: updating Notion tickets, posting Slack messages, or GitHub changes. All mutations require user approval.",
      inputSchema: z.object({
        task: z.string().describe("What to update and why"),
        context: z.string().optional().describe("Relevant context from prior search results"),
      }),
      execute: async (input) => {
        emitStepStart(ctx, "updater");
        ctx.send("agent_event", { type: "agent_delegation", agent: "updater", task: input.task });
        const result = await runSpecialist({
          agentId: "updater",
          systemPrompt: buildUpdaterSystemPrompt(ctx),
          tools: buildUpdaterTools(ctx),
          query: `${input.task}${input.context ? `\n\nContext: ${input.context}` : ""}`,
          conversationId: ctx.conversationId,
          events: ctx.events,
          send: ctx.send,
          approvalGranted: ctx.approvalGranted,
          pendingAction: ctx.pendingAction,
        });
        emitStepDone(ctx, "updater", result.ok || !!result.requiresApproval);
        return result;
      },
    }),
    delegateToCoder: tool({
      description:
        "Delegate to the Coder agent for GitHub, code, PR, implementation, and debugging tasks.",
      inputSchema: z.object({
        task: z.string().describe("The coding or GitHub task"),
      }),
      execute: async (input) => {
        emitStepStart(ctx, "coder");
        ctx.send("agent_event", { type: "agent_delegation", agent: "coder", task: input.task });
        const result = await runSpecialist({
          agentId: "coder",
          systemPrompt: CODER_PROMPT,
          tools: buildCoderTools(ctx),
          query: input.task,
          conversationId: ctx.conversationId,
          events: ctx.events,
          send: ctx.send,
          approvalGranted: ctx.approvalGranted,
          pendingAction: ctx.pendingAction,
        });
        emitStepDone(ctx, "coder", result.ok);
        return result;
      },
    }),
    delegateToPayments: tool({
      description:
        "Delegate to the Payments Manager for budget allocation, food ordering, and purchasing workflows.",
      inputSchema: z.object({
        task: z.string().describe("The payment or purchasing request"),
      }),
      execute: async (input) => {
        emitStepStart(ctx, "paymentsManager");
        ctx.send("agent_event", {
          type: "agent_delegation",
          agent: "paymentsManager",
          task: input.task,
        });
        const result = await runSpecialist({
          agentId: "paymentsManager",
          systemPrompt: PAYMENTS_PROMPT,
          tools: buildPaymentsTools(ctx),
          query: input.task,
          conversationId: ctx.conversationId,
          events: ctx.events,
          send: ctx.send,
          approvalGranted: ctx.approvalGranted,
          pendingAction: ctx.pendingAction,
        });
        emitStepDone(ctx, "paymentsManager", result.ok);
        return result;
      },
    }),
  };
}

// ── Searcher tools ─────────────────────────────────────────────────────────

function buildSearcherSystemPrompt(ctx: SharedContext) {
  return `${SEARCHER_PROMPT}\n\nToday is ${gmt8TodayFromNow(Date.now())} GMT+8.`;
}

function buildSearcherTools(ctx: SharedContext) {
  return {
    queryNotion: tool({
      description:
        "Query the live Notion sprint board for Harbor Bean ticket properties and body sections.",
      inputSchema: z.object({
        project: z.string().default(HARBOR_BEAN_PROJECT),
        ticket: z.string().optional(),
        includeBody: z.boolean().default(true),
        fields: z.array(z.string()).optional(),
      }),
      execute: async (input) => {
        const result = await queryMcpNotionTickets(input);
        return {
          ...result,
          tickets: result.tickets.map((ticket) => ({
            pageId: ticket.pageId,
            url: ticket.url,
            code: ticket.code,
            name: ticket.name,
            status: ticket.status,
            project: ticket.project,
            assignee: ticket.assignee,
            dueDate: ticket.dueDate,
            priority: ticket.priority,
            overdue: ticket.overdue,
            body: ticket.body,
            sections: ticket.sections.map((section) => ({
              title: section.title,
              text: section.text,
            })),
          })),
        };
      },
    }),
    querySlack: tool({
      description:
        "Read Slack messages. Route: #announcements (events/all-hands), #engineering (tickets/blockers), #vulnerability-monitoring (security), #company-brain-actions (audits).",
      inputSchema: querySlackInputSchema,
      execute: async (input) => {
        const channel = input.channel ?? slackChannelIdForPurpose(input.channelPurpose);
        return toolRegistry.querySlack.run(
          { query: channel ? undefined : input.query, channel, limit: input.limit },
          {},
        );
      },
    }),
    queryExa: tool({
      description:
        "Use Exa for external documentation, blocker validation, CVE details, recent news, or web research.",
      inputSchema: z.object({
        query: z.string(),
        source_preference: z.string().optional(),
        useCase: z.enum(["verification", "research", "cve", "news"]).optional(),
      }),
      execute: async (input) => {
        const useCase = input.useCase ?? inferExaUseCase(input.query);
        const runId = `exa-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (useCase === "research") {
          const result = ctx.deepSearch
            ? await queryExaSearch(input.query)
            : await queryExaSearchFast(input.query);
          if (result.ok) {
            const event = {
              type: "exa_results" as const,
              results: result.results.map((item) => ({
                title: item.title,
                url: item.url,
                summary: item.summary,
                publishedDate: item.published_date,
              })),
            };
            ctx.events.push(event);
            await persistToolCard(ctx.conversationId, "queryExa", "Exa search results", ctx.nextOrderRef, {
              exaResults: event.results,
            });
          }
          return result;
        }

        if (useCase === "cve") {
          const result = ctx.deepSearch
            ? await queryExaCVE(input.query)
            : await queryExaCVEFast(input.query);
          if (result.ok) {
            const event = { type: "exa_cve" as const, runId, result: result.result };
            ctx.events.push(event);
            await persistToolCard(ctx.conversationId, "queryExa", "CVE details", ctx.nextOrderRef, {
              exaCVE: result.result,
            });
          }
          return result;
        }

        if (useCase === "news") {
          const result = ctx.deepSearch
            ? await queryExaNews(input.query)
            : await queryExaNewsFast(input.query);
          if (result.ok) {
            const event = { type: "exa_news" as const, runId, articles: result.articles };
            ctx.events.push(event);
            await persistToolCard(ctx.conversationId, "queryExa", "News results", ctx.nextOrderRef, {
              exaNews: result.articles,
            });
          }
          return result;
        }

        const result = await queryHarborBeanExaVerdict(input.query);
        if (result.ok) {
          const event = { type: "exa_verdict" as const, runId, verdict: result.verdict };
          ctx.events.push(event);
          await persistToolCard(ctx.conversationId, "queryExa", "Exa verdict", ctx.nextOrderRef, {
            exaVerdict: result.verdict,
          });
        }
        return result;
      },
    }),
    queryRepos: tool({
      description:
        "Query CVE monitoring service for registered repos, tracked packages, and alert configuration.",
      inputSchema: z.object({
        monitorId: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      execute: async (input) => {
        const result = await toolRegistry.queryRepos.run(input, {});
        if (result.ok && result.data) {
          const monitors = (result.data as { monitors?: RepoMonitor[] }).monitors ?? [];
          const event = { type: "repo_monitors" as const, monitors };
          ctx.events.push(event);
          await persistToolCard(ctx.conversationId, "queryRepos", "Repo monitors", ctx.nextOrderRef, {
            repoMonitors: monitors,
          });
        }
        return result;
      },
    }),
    queryGithub: tool({
      description:
        "Query GitHub repositories, pull requests, and issues. Use to find stalled PRs, check CI status, or cross-reference PR branches with Notion ticket codes.",
      inputSchema: z.object({
        owner: z.string().default("LGTM-superai"),
        repo: z.string().default("company-brain"),
        type: z.enum(["repo", "issues", "pulls"]).default("pulls"),
        state: z.enum(["open", "closed", "all"]).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async (input) => {
        return toolRegistry.queryGithub.run(input, {});
      },
    }),
    queryKnowledgeBase: tool({
      description:
        "Query the company knowledge base (S3 + DocumentDB). Three modes: 'search' returns document metadata with download cards — use when user says 'give me the file', 'find the doc', or asks for a list. 'read' retrieves full content — use when user says 'summarize', 'explain', 'what does it say', or asks about content. 'both' (DEFAULT) returns download cards AND fetches content for summarization — use when the user's intent is ambiguous or they just ask a general question about a topic.",
      inputSchema: z.object({
        query: z.string().describe("Search query or document topic"),
        mode: z.enum(["search", "read", "both"]).default("both").describe("'search' = file cards only, 'read' = content only for summarization, 'both' = file cards + content (DEFAULT)"),
        domain: z.enum(["engineering", "product", "people", "business", "general"]).optional(),
        tags: z.array(z.string()).optional().describe("Filter by document tags"),
        documentKey: z.string().optional().describe("Fetch a specific document by key"),
        username: z.string().optional().describe("Requesting user for access control"),
      }),
      execute: async (input) => {
        if (input.documentKey) {
          return fetchDocumentContent(input.documentKey, input.username);
        }

        const s3Result = await searchDocuments({
          query: input.query,
          domain: input.domain,
          tags: input.tags,
          username: input.username,
        });

        const hasS3Docs = s3Result.data.documents.length > 0;

        if (input.mode === "read") {
          if (hasS3Docs) {
            const topDoc = s3Result.data.documents[0];
            return fetchDocumentContent(topDoc.key, input.username);
          }
          return queryKnowledgeBase(input.query, input.domain, input.username);
        }

        // For "search" and "both": emit document cards
        let result;
        if (hasS3Docs) {
          result = s3Result;
        } else {
          result = queryKnowledgeBase(input.query, input.domain, input.username);
        }

        const docs = hasS3Docs
          ? s3Result.data.documents
          : (result as { results?: unknown[] }).results ?? [];

        if (Array.isArray(docs) && docs.length > 0) {
          ctx.events.push({ type: "kb_documents", documents: docs as any });
        }

        if (input.mode === "search") {
          return result;
        }

        // mode === "both": also fetch content of the top document for summarization
        if (hasS3Docs) {
          const topDoc = s3Result.data.documents[0];
          const contentResult = await fetchDocumentContent(topDoc.key, input.username);
          return {
            ...result,
            topDocument: contentResult.ok ? contentResult.data : undefined,
            message: `Found ${docs.length} document(s). Top result content included for summarization.`,
          };
        }

        // Fallback: return sample KB content if available
        const kbResult = queryKnowledgeBase(input.query, input.domain, input.username);
        const accessible = (kbResult as { results?: Array<{ id: string; title: string; summary: string }> }).results;
        if (accessible?.length) {
          return {
            ...result,
            topDocument: { title: accessible[0].title, summary: accessible[0].summary },
            message: `Found ${docs.length} document(s). Summary included.`,
          };
        }

        return result;
      },
    }),
  };
}

// ── Updater tools ──────────────────────────────────────────────────────────

function buildUpdaterSystemPrompt(ctx: SharedContext) {
  const approvalContext = ctx.pendingAction
    ? `\n\nPending action: ${JSON.stringify(ctx.pendingAction)}\nApproval granted: ${ctx.approvalGranted ? "yes" : "no"}`
    : "";
  return `${UPDATER_PROMPT}\n\nToday is ${gmt8TodayFromNow(Date.now())} GMT+8.${approvalContext}`;
}

function buildUpdaterTools(ctx: SharedContext) {
  return {
    updateNotion: tool({
      description:
        "Update the live Notion sprint board. Can write Latest agent note or update Name, Status, Project, Assignee, Due Date, and Priority.",
      inputSchema: updateNotionInputSchema,
      execute: async (input) => {
        const notionApprovalGranted =
          ctx.approvalGranted &&
          (ctx.pendingAction?.type === "update_ticket_fields" || ctx.pendingAction?.type === "move_status");

        if (input.action === "record_latest_agent_note") {
          if (!input.note) {
            return { ok: false, message: "Tool failed: updateNotion (note is required)." };
          }

          const result = await updateMcpLatestAgentNote({ ticket: input.ticket, note: input.note });

          if (result.ok) {
            await auditExternalMutation(ctx.conversationId, {
              system: "Notion",
              target: input.ticket,
              action: "Recorded Latest agent note",
            });
            return { ok: true, message: `Done. Recorded agent note on ${input.ticket}.` };
          }

          return { ok: false, message: result.message ?? `Failed to write agent note on ${input.ticket}.` };
        }

        const request = await buildTicketFieldUpdateRequest(input, ctx.pendingAction, notionApprovalGranted);

        if (!request.ok) {
          return { ok: false, message: request.message };
        }

        if (!notionApprovalGranted) {
          const action: PendingAction = {
            actionId: `${ctx.conversationId}-pending-${Date.now()}`,
            type: "update_ticket_fields",
            ticket: request.ticket,
            current: request.current,
            changes: request.changes,
            reason: input.reason ?? "User requested a sprint-board update that requires approval.",
            createdAt: new Date().toISOString(),
          };

          await setPendingAction(ctx.conversationId, action);

          return {
            ok: false,
            requiresApproval: true,
            message: approvalMessage(request.ticketName, request.current, request.changes),
            pendingAction: action,
          };
        }

        const result = await updateMcpTicketFields({
          ticket: request.ticket,
          current: request.current,
          changes: request.changes,
        });

        if (result.ok) {
          await clearPendingAction(ctx.conversationId);
          await auditExternalMutation(ctx.conversationId, {
            system: "Notion",
            target: request.ticketName,
            action: `Applied sprint-board changes: ${formatChanges(request.current, request.changes)}`,
          });

          return {
            ok: true,
            message: `Done. ${request.ticketName}: ${formatChanges(request.current, request.changes)}. Verified in Notion.`,
          };
        }

        return {
          ok: false,
          message: result.message ?? `Notion write failed for ${request.ticket}: ${result.reason ?? "unknown error"}.`,
        };
      },
    }),
    createNotionTicket: tool({
      description:
        "Create a new ticket on the Notion sprint board with standard fields and optional body sections.",
      inputSchema: z.object({
        name: z.string().describe("Ticket title (include code like HB-XXX)"),
        project: z.string().default(HARBOR_BEAN_PROJECT),
        status: z.enum(["Not started", "In progress", "In review", "Done"]).default("Not started"),
        assignee: z.string().optional().describe("Full name of assignee"),
        priority: z.enum(["P0", "P1", "P2", "P3"]).default("P1"),
        dueDate: z.string().optional().describe("ISO date like 2026-06-15"),
        body: z.array(z.object({
          title: z.string(),
          lines: z.array(z.string()),
        })).optional().describe("Body sections with heading and content lines"),
        approved: z.boolean().optional(),
        reason: z.string().optional(),
      }),
      execute: async (input) => {
        const createApprovalGranted =
          ctx.approvalGranted && ctx.pendingAction?.type === "create_ticket";

        if (!createApprovalGranted) {
          const action: PendingAction = {
            actionId: `${ctx.conversationId}-pending-${Date.now()}`,
            type: "create_ticket",
            ticket: input.name,
            changes: {
              name: input.name,
              status: input.status,
              project: input.project,
              assignee: input.assignee,
              priority: input.priority,
            },
            reason: input.reason ?? "Creating a new sprint-board ticket requires approval.",
            createdAt: new Date().toISOString(),
          };

          await setPendingAction(ctx.conversationId, action);

          const details = [
            `Name: ${input.name}`,
            `Project: ${input.project}`,
            `Status: ${input.status}`,
            `Priority: ${input.priority}`,
            input.assignee ? `Assignee: ${input.assignee}` : null,
            input.dueDate ? `Due: ${input.dueDate}` : null,
          ].filter(Boolean).join(", ");

          return {
            ok: false,
            requiresApproval: true,
            message: `Create new ticket? ${details}`,
            pendingAction: action,
          };
        }

        const result = await toolRegistry.createNotionTicket.run(input, {});

        if (result.ok) {
          await clearPendingAction(ctx.conversationId);
          await auditExternalMutation(ctx.conversationId, {
            system: "Notion",
            target: input.name,
            action: `Created ticket in ${input.project}`,
          });

          return {
            ok: true,
            message: `Done. Created ticket "${input.name}" in ${input.project}.`,
            data: result.data,
          };
        }

        return { ok: false, message: result.summary };
      },
    }),
    updateSlack: tool({
      description:
        "Post real Slack messages. Non-audit channel posts require approval. Audits go to #company-brain-actions.",
      inputSchema: updateSlackInputSchema,
      execute: async (input) => {
        const slackApprovalGranted = ctx.approvalGranted && ctx.pendingAction?.type === "slack_message";
        const request = buildSlackUpdateRequest(input, ctx.pendingAction, slackApprovalGranted);

        if (!request.ok) {
          return { ok: false, message: request.message };
        }

        if (shouldAskSlackApproval(request.value, slackApprovalGranted)) {
          const pendingSlackAction: PendingAction = {
            actionId: `${ctx.conversationId}-pending-slack-${Date.now()}`,
            type: "slack_message",
            channel: request.value.channel,
            channelPurpose: request.value.channelPurpose,
            text: request.value.text,
            mentionPeople: request.value.mentionPeople,
            reason: input.reason ?? "User requested a Slack write that requires approval.",
            createdAt: new Date().toISOString(),
          };

          await setPendingAction(ctx.conversationId, pendingSlackAction);

          return {
            ok: false,
            requiresApproval: true,
            message: slackApprovalMessage(request.value),
            pendingAction: pendingSlackAction,
          };
        }

        const channel = slackToolChannelForPurpose(request.value.channelPurpose);
        const text = withSlackMentions(request.value.text, request.value.mentionPeople);
        const result = await toolRegistry.updateSlack.run({ action: "send_message", channel, text }, {});

        if (!result.ok) {
          return result;
        }

        const sent = result.data as { ok?: boolean; channel?: string; ts?: string } | undefined;
        await persistSlackAudit(ctx.conversationId, text, {
          channel: sent?.channel ?? channel,
          ts: sent?.ts,
          audit: request.value.channelPurpose === "company-brain-actions",
        });

        if (request.value.channelPurpose !== "company-brain-actions") {
          await auditExternalMutation(ctx.conversationId, {
            system: "Slack",
            target: `#${request.value.channelPurpose}`,
            action: `Posted message${request.value.mentionPeople?.length ? ` tagging ${request.value.mentionPeople.join(", ")}` : ""}`,
          });
        }

        if (ctx.pendingAction?.type === "slack_message") {
          await clearPendingAction(ctx.conversationId);
        }

        return { ...result, audit: request.value.channelPurpose !== "company-brain-actions" };
      },
    }),
  };
}

// ── Coder tools ────────────────────────────────────────────────────────────

function buildCoderTools(ctx: SharedContext) {
  return {
    queryGithub: tool({
      description: "Query repositories, open PRs, issues, and code context from GitHub.",
      inputSchema: z.object({
        owner: z.string().default("LGTM-superai"),
        repo: z.string().default("company-brain"),
        type: z.enum(["repo", "issues", "pulls"]).default("pulls"),
        state: z.enum(["open", "closed", "all"]).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async (input) => {
        return toolRegistry.queryGithub.run(input, {});
      },
    }),
    updateGithub: tool({
      description:
        "Create GitHub issues (for CVE alerts, bugs, tasks), comment on PRs, or add labels. Use for CVE remediation tickets.",
      inputSchema: z.object({
        action: z.enum(["create_issue", "add_comment", "add_labels"]),
        owner: z.string().default("LGTM-superai"),
        repo: z.string().default("company-brain"),
        title: z.string().optional().describe("Issue title (for create_issue)"),
        body: z.string().optional().describe("Issue/comment body in markdown"),
        labels: z.array(z.string()).optional(),
        issue: z.number().optional().describe("Issue/PR number (for add_comment, add_labels)"),
      }),
      execute: async (input) => {
        return toolRegistry.updateGithub.run(input, {});
      },
    }),
  };
}

// ── Payments tools ─────────────────────────────────────────────────────────

function buildPaymentsTools(ctx: SharedContext) {
  return {
    makePayment: tool({
      description:
        "Allocate project budget via Stripe virtual card, or distribute a total budget across projects.",
      inputSchema: z.object({
        action: z.enum(["setBudget", "distributeBudget"]),
        projectName: z.string().optional(),
        amountCents: z.number().int().positive(),
        currency: z.string().optional(),
        projects: z
          .array(z.object({ name: z.string(), percentage: z.number().min(0).max(100) }))
          .optional(),
      }),
      execute: async (input) => {
        const result = await toolRegistry.makePayment.run(input, {});
        if (result.ok && result.data) {
          const data = result.data as {
            action: string;
            allocations?: BudgetAllocationEvent[];
            allocation?: BudgetAllocationEvent;
          };
          const allocations = data.allocations ?? (data.allocation ? [data.allocation] : []);
          const totalCents = allocations.reduce((sum, a) => sum + a.amountCents, 0);
          const event = { type: "budget_allocated" as const, allocations, totalCents };
          ctx.events.push(event);
          await persistToolCard(ctx.conversationId, "makePayment", "Budget allocated", ctx.nextOrderRef, {
            budgetAllocations: allocations,
          });
          await auditExternalMutation(ctx.conversationId, {
            system: "Stripe",
            target: allocations.map((a) => a.projectId).join(", "),
            action: `Allocated $${(totalCents / 100).toFixed(2)}`,
          });
        }
        return result;
      },
    }),
    buySomething: tool({
      description:
        "Order food for a team. Reads team dietary profiles, searches Exa for restaurant matches, and charges through Stripe when confirmed.",
      inputSchema: z.object({
        teamName: z.string(),
        budgetPerHeadCents: z.number().int().positive().optional(),
        confirm: z.boolean().optional(),
      }),
      execute: async (input) => {
        const result = await toolRegistry.buySomething.run(input, {});
        if (result.ok && result.data) {
          const data = result.data as {
            team: {
              teamName: string;
              headcount: number;
              combinedDietary: string[];
              combinedAllergens: string[];
            };
            recommendations: FoodOrderEvent["recommendations"];
            budgetPerHeadCents: number;
            payment?: FoodOrderEvent["payment"];
          };
          const order: FoodOrderEvent = {
            teamName: data.team.teamName,
            headcount: data.team.headcount,
            dietary: data.team.combinedDietary,
            allergens: data.team.combinedAllergens,
            recommendations: data.recommendations,
            budgetPerHeadCents: data.budgetPerHeadCents,
            payment: data.payment,
          };
          const event = { type: "food_order" as const, order };
          ctx.events.push(event);
          await persistToolCard(ctx.conversationId, "buySomething", "Food order", ctx.nextOrderRef, {
            foodOrder: order,
          });
        }
        return result;
      },
    }),
  };
}

// ── Persistence helpers ────────────────────────────────────────────────────

async function persistToolCard(
  conversationId: string,
  toolName: ToolName,
  content: string,
  nextOrderRef: { get: () => number; set: (value: number) => void },
  fields: Record<string, unknown>,
) {
  const order = nextOrderRef.get();
  nextOrderRef.set(order + 1);

  await MessageModel.create({
    messageId: `${conversationId}-${toolName}-card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    role: "tool",
    content,
    toolName,
    order,
    ...fields,
  });
}

async function auditExternalMutation(
  conversationId: string,
  input: { system: string; target: string; action: string },
) {
  const text = `${input.system}: ${input.action} on ${input.target}`;

  try {
    const result = await toolRegistry.updateSlack.run(
      { action: "send_message", channel: "actions", text },
      {},
    );

    await persistSlackAudit(conversationId, text, { ...input, result });
    return result;
  } catch (error) {
    await persistSlackAudit(conversationId, text, {
      ...input,
      error: error instanceof Error ? error.message : "Unknown Slack audit error.",
    });

    return {
      ok: false,
      tool: "updateSlack",
      summary: error instanceof Error ? error.message : "Unknown Slack audit error.",
    };
  }
}

// ── Slack helpers ──────────────────────────────────────────────────────────

function buildSlackUpdateRequest(
  input: UpdateSlackToolInput,
  pendingAction: PendingAction | null,
  shouldUsePendingAction: boolean,
) {
  if (shouldUsePendingAction && pendingAction?.type === "slack_message") {
    return {
      ok: true as const,
      value: {
        channel: pendingAction.channel,
        channelPurpose: normalizeSlackPurpose(pendingAction.channelPurpose) ?? "engineering",
        text: pendingAction.text,
        mentionPeople: pendingAction.mentionPeople,
      },
    };
  }

  const text = (input.text ?? input.message ?? auditTextFromSlackInput(input)).trim();

  if (!text) {
    return {
      ok: false as const,
      message: "Tool failed: updateSlack (text, message, or system/target/action is required).",
    };
  }

  return {
    ok: true as const,
    value: {
      channel: input.channel,
      channelPurpose:
        normalizeSlackPurpose(input.channelPurpose) ??
        defaultSlackPurposeFromInput(input) ??
        "company-brain-actions",
      text,
      mentionPeople: input.mentionPeople,
      audit: input.audit,
    },
  };
}

function auditTextFromSlackInput(input: UpdateSlackToolInput) {
  if (input.system && input.target && input.action) {
    return `${input.system}: ${input.action} on ${input.target}`;
  }
  if (input.action && input.target) {
    return `${input.action} on ${input.target}`;
  }
  return "";
}

function defaultSlackPurposeFromInput(input: UpdateSlackToolInput): SlackChannelPurpose | undefined {
  if (input.audit || (input.system && input.target && input.action)) return "company-brain-actions";
  return undefined;
}

function shouldAskSlackApproval(
  input: { channelPurpose?: SlackChannelPurpose },
  approved: boolean,
) {
  if (approved) return false;
  return input.channelPurpose !== "company-brain-actions";
}

function slackApprovalMessage(input: {
  channelPurpose?: SlackChannelPurpose;
  text?: string;
  mentionPeople?: string[];
}) {
  const destination = `#${input.channelPurpose ?? "company-brain-actions"}`;
  const mentionLine = input.mentionPeople?.length
    ? `I will tag: ${input.mentionPeople.join(", ")}.`
    : "No one is tagged yet. If someone should be tagged, tell me who; otherwise say yes to send as-is.";

  return `Approve posting to ${destination}? ${mentionLine} Message: "${input.text ?? ""}"`;
}

function slackChannelIdForPurpose(purpose?: SlackChannelPurpose) {
  if (!purpose) return undefined;

  const envKeyByPurpose: Record<SlackChannelPurpose, string> = {
    announcements: "SLACK_ANNOUNCEMENTS_CHANNEL_ID",
    engineering: "SLACK_ENGINEERING_CHANNEL_ID",
    "vulnerability-monitoring": "SLACK_VULNERABILITY_MONITORING_CHANNEL_ID",
    "company-brain-actions": "SLACK_ACTION_CHANNEL_ID",
  };

  return process.env[envKeyByPurpose[purpose]];
}

function slackToolChannelForPurpose(purpose?: SlackChannelPurpose) {
  const normalized = normalizeSlackPurpose(purpose) ?? "company-brain-actions";
  const map: Record<SlackChannelPurpose, string> = {
    announcements: "announcements",
    engineering: "engineering",
    "vulnerability-monitoring": "vulnerabilityMonitoring",
    "company-brain-actions": "actions",
  };
  return map[normalized];
}

function normalizeSlackPurpose(value?: string): SlackChannelPurpose | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^#/, "").toLowerCase();

  if (
    normalized === "announcements" ||
    normalized === "engineering" ||
    normalized === "vulnerability-monitoring" ||
    normalized === "company-brain-actions"
  ) {
    return normalized;
  }

  return undefined;
}

function withSlackMentions(text: string, mentionPeople?: string[]) {
  if (!mentionPeople?.length) return text;
  const mentions = mentionPeople
    .map((person) => personIdFromName(person))
    .filter((person): person is PersonId => Boolean(person) && person !== "everyone")
    .map((personId) => {
      const user = users.find((candidate) => candidate.id === personId);
      return user?.slackId ? `<@${user.slackId}>` : `@${personId}`;
    });

  if (!mentions.length) return text;
  return `${mentions.join(" ")} ${stripPlainNameMentions(text, mentionPeople)}`.trim();
}

function stripPlainNameMentions(text: string, mentionPeople: string[]) {
  let stripped = text.replace(/<@[A-Z0-9]+>\s*/g, "");

  for (const person of mentionPeople) {
    stripped = stripped.replace(new RegExp(`@?${escapeRegExp(person)}\\s*`, "gi"), "");
    const firstName = person.split(/\s+/)[0];
    if (firstName) {
      stripped = stripped.replace(new RegExp(`@?${escapeRegExp(firstName)}\\s*`, "gi"), "");
    }
  }

  return stripped
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^\s*[-,:]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function personIdFromName(name: string): PersonId | undefined {
  const normalized = name.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "everyone" || normalized === "channel") return "everyone";

  const match = users.find(
    (user) =>
      user.id === normalized ||
      user.name.toLowerCase() === normalized ||
      user.slackHandle.toLowerCase() === normalized ||
      user.name.toLowerCase().startsWith(normalized),
  );

  return match?.id;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Notion helpers ─────────────────────────────────────────────────────────

async function buildTicketFieldUpdateRequest(
  input: UpdateNotionInput,
  pendingAction: PendingAction | null,
  shouldUsePendingAction: boolean,
) {
  if (shouldUsePendingAction && pendingAction) {
    if (pendingAction.type === "update_ticket_fields") {
      return {
        ok: true as const,
        ticket: pendingAction.ticket,
        ticketName: pendingAction.ticket,
        current: pendingAction.current,
        changes: pendingAction.changes,
      };
    }

    if (pendingAction.type === "move_status") {
      return {
        ok: true as const,
        ticket: pendingAction.ticket,
        ticketName: pendingAction.ticket,
        current: { status: pendingAction.currentStatus },
        changes: { status: pendingAction.newStatus },
      };
    }
  }

  const changes = normalizeTicketFieldChanges({
    ...(input.changes ?? {}),
    ...(input.action === "move_status" || input.newStatus ? { status: input.newStatus } : {}),
  });

  if (!Object.keys(changes).length) {
    return {
      ok: false as const,
      message:
        "Tool failed: updateNotion (provide at least one sprint-board field change in changes, such as assignee, status, dueDate, priority, project, or name).",
    };
  }

  const result = await queryMcpNotionTickets({ ticket: input.ticket, includeBody: false });

  if (result.tickets.length !== 1) {
    return {
      ok: false as const,
      message: `Tool failed: updateNotion (expected one Notion ticket for "${input.ticket}", found ${result.tickets.length}).`,
    };
  }

  const ticket = result.tickets[0];
  const current = normalizeTicketFieldChanges({
    ...currentSnapshotForChanges(ticket, changes),
    ...(input.current ?? {}),
    ...(input.currentStatus ? { status: input.currentStatus } : {}),
  });

  return {
    ok: true as const,
    ticket: input.ticket,
    ticketName: ticket.name,
    current,
    changes,
  };
}

function currentSnapshotForChanges(
  ticket: Awaited<ReturnType<typeof queryMcpNotionTickets>>["tickets"][number],
  changes: TicketFieldChanges,
) {
  const current: TicketFieldChanges = {};

  if (changes.name !== undefined) current.name = ticket.name;
  if (changes.status !== undefined) current.status = ticket.status;
  if (changes.project !== undefined) current.project = ticket.project;
  if (changes.assignee !== undefined) current.assignee = ticket.assignee;
  if (changes.dueDate !== undefined) current.dueDate = ticket.dueDate;
  if (changes.priority !== undefined) current.priority = ticket.priority;

  return current;
}

function normalizeTicketFieldChanges(changes: TicketFieldChanges) {
  const normalized: TicketFieldChanges = {};

  if (changes.name !== undefined) normalized.name = changes.name.trim();
  if (changes.status !== undefined) normalized.status = normalizeStatus(changes.status);
  if (changes.project !== undefined) normalized.project = normalizeProject(changes.project);
  if (changes.assignee !== undefined) normalized.assignee = normalizeAssignee(changes.assignee);
  if (changes.dueDate !== undefined) normalized.dueDate = changes.dueDate;
  if (changes.priority !== undefined) normalized.priority = normalizePriority(changes.priority);

  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined && value !== ""),
  ) as TicketFieldChanges;
}

function normalizeStatus(status: string) {
  const aliases: Record<string, string> = {
    "not started": "Not started",
    todo: "Not started",
    "to do": "Not started",
    "in progress": "In progress",
    progress: "In progress",
    "in review": "In review",
    review: "In review",
    deployed: "Done",
    done: "Done",
    complete: "Done",
    completed: "Done",
  };

  return aliases[normalizeKey(status)] ?? status.trim();
}

function normalizeProject(project: string) {
  const aliases: Record<string, string> = {
    "harbor bean": HARBOR_BEAN_PROJECT,
    "harbor bean cafe": HARBOR_BEAN_PROJECT,
  };

  return aliases[normalizeKey(project)] ?? project.trim();
}

function normalizeAssignee(assignee: string) {
  return resolveAssignee(assignee) ?? assignee.trim();
}

function normalizePriority(priority: string) {
  const trimmed = priority.trim();
  return /^p\d+$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function normalizeKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function approvalMessage(ticketName: string, current: TicketFieldChanges, changes: TicketFieldChanges) {
  return `I found ${ticketName}. Apply sprint-board changes: ${formatChanges(current, changes)}?`;
}

function formatChanges(current: TicketFieldChanges, changes: TicketFieldChanges) {
  return (Object.keys(changes) as Array<keyof TicketFieldChanges>)
    .map((field) => `${field} ${formatValue(current[field])} -> ${formatValue(changes[field])}`)
    .join(", ");
}

function formatValue(value: unknown) {
  return value === null || value === "" || value === undefined ? "empty" : String(value);
}

// ── Message / routing helpers ──────────────────────────────────────────────

async function buildModelMessages(conversationId: string): Promise<ModelMessage[]> {
  const persistedMessages = await MessageModel.find({
    conversationId,
    role: { $in: ["user", "assistant"] },
  })
    .sort({ order: 1 })
    .limit(18)
    .lean();

  return persistedMessages.map((message) => ({
    role: message.role as "user" | "assistant",
    content: message.content,
  }));
}

function forcedToolChoiceForLatestMessage(
  message: string,
  pendingAction: PendingAction | null,
  approvalGranted: boolean,
) {
  if (!approvalGranted || !pendingAction) return undefined;

  if (
    pendingAction.type === "update_ticket_fields" ||
    pendingAction.type === "move_status" ||
    pendingAction.type === "slack_message" ||
    pendingAction.type === "create_ticket"
  ) {
    return { type: "tool" as const, toolName: "delegateToUpdater" as const };
  }

  return undefined;
}

function isSlackSendConfirmation(message: string) {
  return /\b(send it|post it|send this|post this|ok send|okay send|go ahead|yes|yep|yeah|confirm|confirmed|do it)\b/i.test(
    message,
  );
}

async function recoverPendingSlackActionFromDraft(conversationId: string) {
  const recentAssistantMessages = await MessageModel.find({
    conversationId,
    role: "assistant",
  })
    .sort({ order: -1 })
    .limit(8)
    .lean();

  for (const message of recentAssistantMessages) {
    const draft = parseSlackDraftFromAssistantText(message.content);

    if (draft) {
      return {
        actionId: `${conversationId}-recovered-slack-${Date.now()}`,
        type: "slack_message" as const,
        channelPurpose: draft.channelPurpose,
        text: draft.text,
        mentionPeople: draft.mentionPeople,
        reason: "Recovered from the last assistant Slack draft after the user approved sending.",
        createdAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

function parseSlackDraftFromAssistantText(content: string) {
  const channelMatch =
    content.match(/\*\*Channel:\*\*\s*#?([a-z0-9_-]+)/i) ??
    content.match(/\bChannel:\s*#?([a-z0-9_-]+)/i);
  const messageMatch =
    content.match(/\*\*Message:\*\*\s*(?:>\s*)?([\s\S]+)/i) ??
    content.match(/\bMessage:\s*(?:>\s*)?([\s\S]+)/i);

  if (!channelMatch || !messageMatch) return null;

  const channelPurpose = normalizeSlackPurpose(channelMatch[1]) ?? "engineering";
  const text = cleanupRecoveredSlackDraft(messageMatch[1]);

  if (text.length < 8) return null;

  return {
    channelPurpose,
    text,
    mentionPeople: extractMentionPeopleFromText(text),
  };
}

function cleanupRecoveredSlackDraft(text: string) {
  return text
    .split(/\n?\s*---/)[0]
    .replace(/\n?\s*Reply\s+\*\*?yes[\s\S]*$/i, "")
    .replace(/\n?\s*Do you want me to post[\s\S]*$/i, "")
    .replace(/^>\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMentionPeopleFromText(text: string) {
  return users
    .filter((user) => new RegExp(`\\b${escapeRegExp(user.name.split(" ")[0])}\\b`, "i").test(text))
    .map((user) => user.name);
}

function inferExaUseCase(query: string): "verification" | "research" | "cve" | "news" {
  if (/cve|vulnerability|security|exploit|advisory/i.test(query)) return "cve";
  if (/news|recent|article|market|competitor|industry/i.test(query)) return "news";
  if (/verify|valid|blocker|is it true|fact.?check|confirm/i.test(query)) return "verification";
  return "research";
}

// ── Router system prompt ───────────────────────────────────────────────────

function routerSystemPrompt({
  pendingAction,
  approvalGranted,
}: {
  pendingAction: PendingAction | null;
  approvalGranted: boolean;
}) {
  return `${ROUTER_PROMPT}

Today is ${gmt8TodayFromNow(Date.now())} GMT+8.

${pendingAction ? `Pending action awaiting approval:\n${JSON.stringify(pendingAction)}\nUser approval: ${approvalGranted ? "yes — delegate to Updater immediately" : "no"}` : "No pending actions."}`;
}

// ── Error / summary helpers ────────────────────────────────────────────────

function friendlyError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("rate limit")) return "Rate limited. Please try again in a moment.";
    if (error.message.includes("timeout")) return "Request timed out. Please try again.";
    return `Something went wrong: ${error.message}`;
  }
  return "An unexpected error occurred.";
}

function summaryFromAnswer(question: string, answer: string) {
  const short = answer.length > 120 ? answer.slice(0, 120) + "..." : answer;
  return short;
}
