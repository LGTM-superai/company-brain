import { NextResponse } from "next/server";
import {
  generateText,
  streamText,
  tool,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import type {
  AgentEvent,
  AgentId,
  AgentPlan,
  BudgetAllocationEvent,
  FoodLineItem,
  FoodOrderEvent,
  PlanStep,
  RepoMonitor,
  ToolName,
} from "@company-brain/shared";
import { users, resolveAssignee, type PersonId } from "@company-brain/shared";
import { toolRegistry, getTeamProfile } from "@company-brain/tools";
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
  appendMcpTicketNote,
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
import { runSpecialist, type SpecialistResult } from "../../../lib/agent-delegation";
import { searchNotionKB, fetchNotionPageContent } from "../../../lib/knowledge-base";
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
  action: z.enum(["record_latest_agent_note", "append_fix_note", "update_ticket_fields", "move_status"]),
  ticket: z.string(),
  note: z.string().optional(),
  heading: z.string().optional(),
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
  let approvalGranted = pendingAction
    ? isApprovalMessage(rawMessage) || isFoodOrderSelection(rawMessage, pendingAction)
    : false;

  // If user selected a restaurant (phase 1 → choose_items), transition to ask what they want
  if (approvalGranted && pendingAction?.type === "food_order" && pendingAction.phase === "pick_restaurant" && !isApprovalMessage(rawMessage)) {
    pendingAction.selectedRestaurant = rawMessage.trim();
    pendingAction.phase = "choose_items";
    pendingAction.reason = `You picked ${rawMessage.trim()}. What would you like to order for the team?`;
    await setPendingAction(conversationId, pendingAction);
    // Don't delegate — just respond with the question
    approvalGranted = false;
  }

  // If user told us what they want (choose_items → generate line items), save their request
  if (approvalGranted && pendingAction?.type === "food_order" && pendingAction.phase === "choose_items") {
    pendingAction.userItemRequest = rawMessage.trim();
    pendingAction.phase = "confirm_order";
    await setPendingAction(conversationId, pendingAction);
  }

  // If user confirmed the line items (confirm_order → confirm_payment), transition to payment confirmation
  if (approvalGranted && pendingAction?.type === "food_order" && pendingAction.phase === "confirm_order" && pendingAction.lineItems) {
    pendingAction.phase = "confirm_payment";
    pendingAction.reason = `Ready to charge SGD ${((pendingAction.totalCents ?? 0) / 100).toFixed(2)} for ${pendingAction.headcount} people from ${pendingAction.selectedRestaurant ?? "the restaurant"}. Shall I proceed with payment?`;
    await setPendingAction(conversationId, pendingAction);
    approvalGranted = false;
  }

  // If user wants different options, save previous restaurant names and clear so Phase 1 re-runs
  let previousRestaurants: string[] = [];
  if (pendingAction?.type === "food_order" && !approvalGranted && isFoodReSearchRequest(rawMessage)) {
    // Collect restaurant names already shown from recent food_order events
    const recentFoodMessages = await MessageModel.find({
      conversationId,
      role: "tool",
      toolName: "buySomething",
      foodOrder: { $exists: true },
    }).sort({ order: -1 }).limit(3).lean();

    for (const msg of recentFoodMessages) {
      const order = msg.foodOrder as { recommendations?: { restaurantName: string }[] } | undefined;
      if (order?.recommendations) {
        for (const rec of order.recommendations) {
          if (rec.restaurantName && !previousRestaurants.includes(rec.restaurantName)) {
            previousRestaurants.push(rec.restaurantName);
          }
        }
      }
    }

    await clearPendingAction(conversationId);
    pendingAction = null;
  }

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
        const sharedContext: SharedContext = {
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
          completedDelegations: new Map(),
          awaitingApproval: null,
          previousRestaurants,
        };

        const shouldStop = ({ steps }: { steps: Array<unknown> }) => {
          if (sharedContext.awaitingApproval) return true;
          // For food orders: proposePlan (step 1) + delegateToPayments (step 2) is enough
          // For other flows: allow up to 6 steps for multi-agent chains
          if (sharedContext.completedDelegations.size > 0 && steps.length >= 3) return true;
          return steps.length >= 6;
        };

        const result = streamText({
          model: getRuntimeModel(),
          system: routerSystemPrompt({ pendingAction, approvalGranted }),
          messages: modelMessages,
          tools: buildDelegationTools(sharedContext),
          toolChoice,
          stopWhen: shouldStop,
          maxOutputTokens: 2400,
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

        const answer = fullAnswer.trim() || sharedContext.awaitingApproval?.text || "Done.";
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
  completedDelegations: Map<string, SpecialistResult>;
  awaitingApproval: SpecialistResult | null;
  previousRestaurants: string[];
};

function delegationKey(agentId: AgentId, _input: Record<string, unknown>) {
  // Key by agent only — each agent should run at most once per turn.
  // The router rephrases the task string on retries, so input-based keys don't prevent duplicates.
  return agentId;
}

function guardApprovalHalt(ctx: SharedContext): SpecialistResult | null {
  if (ctx.awaitingApproval) {
    return {
      ok: false,
      text: ctx.awaitingApproval.text,
      toolCalls: [],
    };
  }
  return null;
}

function markIfApproval(ctx: SharedContext, result: SpecialistResult) {
  if (result.requiresApproval) {
    ctx.awaitingApproval = result;
  }
}

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
            "queryKnowledgeBase", "queryTeamDietary", "makePayment", "buySomething",
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
        const halted = guardApprovalHalt(ctx);
        if (halted) return halted;
        const key = delegationKey("searcher", input);
        const cached = ctx.completedDelegations.get(key);
        if (cached) return cached;

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
        ctx.completedDelegations.set(key, result);
        markIfApproval(ctx, result);
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
        const halted = guardApprovalHalt(ctx);
        if (halted) return halted;
        const key = delegationKey("updater", input);
        const cached = ctx.completedDelegations.get(key);
        if (cached) return cached;

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
        ctx.completedDelegations.set(key, result);
        markIfApproval(ctx, result);
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
        const halted = guardApprovalHalt(ctx);
        if (halted) return halted;
        const key = delegationKey("coder", input);
        const cached = ctx.completedDelegations.get(key);
        if (cached) return cached;

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
        ctx.completedDelegations.set(key, result);
        markIfApproval(ctx, result);
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
        const halted = guardApprovalHalt(ctx);
        if (halted) return halted;
        const key = delegationKey("paymentsManager", input);
        const cached = ctx.completedDelegations.get(key);
        if (cached) return cached;

        emitStepStart(ctx, "paymentsManager");
        ctx.send("agent_event", {
          type: "agent_delegation",
          agent: "paymentsManager",
          task: input.task,
        });
        // Only tell the agent "approval granted" if user confirmed payment in the final phase
        const foodConfirmGranted = ctx.approvalGranted
          && ctx.pendingAction?.type === "food_order"
          && ctx.pendingAction.phase === "confirm_payment"
          && !!ctx.pendingAction.lineItems;
        const paymentsSystemPrompt = ctx.pendingAction
          ? `${PAYMENTS_PROMPT}\n\nPending action: ${JSON.stringify(ctx.pendingAction)}\nApproval granted: ${foodConfirmGranted ? "yes — call buySomething with confirm=true immediately" : "no — do NOT set confirm=true"}`
          : PAYMENTS_PROMPT;
        const result = await runSpecialist({
          agentId: "paymentsManager",
          systemPrompt: paymentsSystemPrompt,
          tools: buildPaymentsTools(ctx),
          query: input.task,
          conversationId: ctx.conversationId,
          events: ctx.events,
          send: ctx.send,
          approvalGranted: ctx.approvalGranted,
          pendingAction: ctx.pendingAction,
          maxSteps: 4,
          forceToolUse: true,
        });
        emitStepDone(ctx, "paymentsManager", result.ok);
        ctx.completedDelegations.set(key, result);
        // Check if buySomething staged a new or updated pending action during execution
        const freshPending = await getPendingAction(ctx.conversationId);
        if (freshPending && (!ctx.pendingAction || freshPending.actionId !== ctx.pendingAction.actionId)) {
          result.requiresApproval = true;
        }
        markIfApproval(ctx, result);
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
        "Query the company knowledge base (S3 + Notion). Always searches both sources in parallel. Three modes: 'search' returns document metadata with download cards — use when user says 'give me the file', 'find the doc', or asks for a list. 'read' retrieves full content — use when user says 'summarize', 'explain', 'what does it say', or asks about content. 'both' (DEFAULT) returns download cards AND fetches content for summarization — use when the user's intent is ambiguous or they just ask a general question about a topic.",
      inputSchema: z.object({
        query: z.string().describe("Search query or document topic"),
        mode: z.enum(["search", "read", "both"]).default("both").describe("'search' = file cards only, 'read' = content only for summarization, 'both' = file cards + content (DEFAULT)"),
        domain: z.enum(["engineering", "product", "people", "business", "general"]).optional(),
        tags: z.array(z.string()).optional().describe("Filter by document tags"),
        documentKey: z.string().optional().describe("Fetch a specific S3 document by key"),
        notionPageId: z.string().optional().describe("Fetch a specific Notion page by ID"),
        username: z.string().optional().describe("Requesting user for access control"),
      }),
      execute: async (input) => {
        if (input.documentKey) {
          return fetchDocumentContent(input.documentKey, input.username);
        }
        if (input.notionPageId) {
          return fetchNotionPageContent(input.notionPageId, input.username);
        }

        const [s3Result, notionResult] = await Promise.all([
          searchDocuments({
            query: input.query,
            domain: input.domain,
            tags: input.tags,
            username: input.username,
          }),
          searchNotionKB({
            query: input.query,
            domain: input.domain,
            tags: input.tags,
            username: input.username,
          }),
        ]);

        const s3Docs = s3Result.data.documents;
        const notionDocs = notionResult.data.documents;
        const allDenied = notionResult.accessDenied ?? [];

        // Fetch content for top documents to serve as inline artifacts
        const s3DocsWithContent = await Promise.all(
          s3Docs.slice(0, 3).map(async (d) => {
            const contentResult = await fetchDocumentContent(d.key, input.username);
            return {
              ...d,
              source: "s3" as const,
              content: contentResult.ok ? (contentResult.data as any)?.content : undefined,
              contentType: contentResult.ok ? (contentResult.data as any)?.contentType : undefined,
            };
          }),
        );
        const remainingS3Docs = s3Docs.slice(3).map((d) => ({ ...d, source: "s3" as const }));

        const notionDocsWithContent = await Promise.all(
          notionDocs.slice(0, 3).map(async (d) => {
            const contentResult = await fetchNotionPageContent(d.id, input.username);
            return {
              ...d,
              downloadUrl: d.url,
              content: contentResult.ok ? (contentResult.data as any)?.content : undefined,
              contentType: "text/markdown",
            };
          }),
        );
        const remainingNotionDocs = notionDocs.slice(3).map((d) => ({ ...d, downloadUrl: d.url }));

        const allDocs = [
          ...s3DocsWithContent,
          ...remainingS3Docs,
          ...notionDocsWithContent,
          ...remainingNotionDocs,
        ];

        if (input.mode === "read") {
          if (s3DocsWithContent.length > 0 && s3DocsWithContent[0].content) {
            return {
              ok: true,
              tool: "queryKnowledgeBase",
              summary: `Retrieved "${s3DocsWithContent[0].title}".`,
              data: s3DocsWithContent[0],
            };
          }
          if (notionDocsWithContent.length > 0 && notionDocsWithContent[0].content) {
            return {
              ok: true,
              tool: "queryKnowledgeBase",
              summary: `Retrieved "${notionDocsWithContent[0].title}".`,
              data: notionDocsWithContent[0],
            };
          }
          return {
            ok: true,
            tool: "queryKnowledgeBase",
            summary: `No documents found matching "${input.query}" in S3 or Notion.`,
            data: { documents: [] },
          };
        }

        if (allDocs.length > 0) {
          ctx.events.push({ type: "kb_documents", documents: allDocs as any });
          await persistToolCard(ctx.conversationId, "queryKnowledgeBase", "Knowledge Base", ctx.nextOrderRef, {
            kbDocuments: allDocs,
          });
        }

        const merged = {
          ok: true as const,
          tool: "queryKnowledgeBase",
          summary: `Found ${allDocs.length} document(s) (${s3Docs.length} from S3, ${notionDocs.length} from Notion).${allDenied.length ? ` ${allDenied.length} denied.` : ""}`,
          data: { documents: allDocs },
          accessDenied: allDenied,
        };

        if (input.mode === "search") {
          return merged;
        }

        // mode === "both": content already fetched above, include top doc for LLM summarization
        const topDoc = s3DocsWithContent[0] ?? notionDocsWithContent[0];
        if (topDoc?.content) {
          return {
            ...merged,
            topDocument: topDoc,
            message: `Found ${allDocs.length} document(s). Top result content included for summarization.`,
          };
        }

        return {
          ...merged,
          message: `No documents found matching "${input.query}" in S3 or Notion.`,
        };
      },
    }),
    queryTeamDietary: tool({
      description:
        "Retrieve team dietary profiles from the company knowledge base. Use this BEFORE ordering food to get dietary restrictions, allergens, and cuisine preferences for a team.",
      inputSchema: z.object({
        teamName: z.string().describe("Team name: tech, product, or design"),
      }),
      execute: async (input) => {
        const query = `${input.teamName} dietary`;
        const s3Result = await searchDocuments({
          query,
          domain: "people",
          username: "admin",
        });

        if (s3Result.data.documents.length > 0) {
          const topDoc = s3Result.data.documents[0];
          const content = await fetchDocumentContent(topDoc.key, "admin");
          return {
            ok: true,
            tool: "queryTeamDietary",
            summary: `Retrieved dietary profiles for ${input.teamName} team from KB.`,
            data: content.ok ? content.data : { summary: topDoc.summary },
            source: "s3",
          };
        }

        const notionResult = await searchNotionKB({
          query,
          domain: "people",
          username: "admin",
        });

        if (notionResult.data.documents.length > 0) {
          const topDoc = notionResult.data.documents[0];
          const content = await fetchNotionPageContent(topDoc.id, "admin");
          return {
            ok: true,
            tool: "queryTeamDietary",
            summary: `Retrieved dietary profiles for ${input.teamName} team from Notion KB.`,
            data: content.ok ? content.data : { title: topDoc.title },
            source: "notion",
          };
        }

        const profile = getTeamProfile(input.teamName);
        if (profile) {
          return {
            ok: true,
            tool: "queryTeamDietary",
            summary: `Retrieved dietary profiles for ${input.teamName} team (${profile.headcount} people). Dietary: ${profile.combinedDietary.join(", ") || "none"}. Allergens: ${profile.combinedAllergens.join(", ") || "none"}.`,
            data: {
              teamName: profile.teamName,
              headcount: profile.headcount,
              members: profile.members.map((m) => ({
                name: m.name,
                dietary: m.dietary,
                allergens: m.allergens,
                cuisinePreferences: m.cuisinePreferences,
                dislikes: m.dislikes,
              })),
              combinedDietary: profile.combinedDietary,
              combinedAllergens: profile.combinedAllergens,
              preferredCuisines: profile.preferredCuisines,
            },
            source: "internal",
          };
        }

        return {
          ok: false,
          tool: "queryTeamDietary",
          summary: `No dietary profiles found for team "${input.teamName}". Available teams: tech, product, design.`,
        };
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
        "Update the live Notion sprint board. Can append a fix note to the bottom of a ticket, write Latest agent note, or update Name, Status, Project, Assignee, Due Date, and Priority.",
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

        if (input.action === "append_fix_note") {
          if (!input.note) {
            return { ok: false, message: "Tool failed: updateNotion (note is required)." };
          }

          const result = await appendMcpTicketNote({
            ticket: input.ticket,
            heading: input.heading ?? "Agent fix note",
            note: input.note,
          });

          if (result.ok) {
            await auditExternalMutation(ctx.conversationId, {
              system: "Notion",
              target: input.ticket,
              action: "Appended fix note to ticket bottom",
            });
            return { ok: true, message: `Done. Appended the fix note to the bottom of ${input.ticket}.` };
          }

          return { ok: false, message: result.message ?? `Failed to append fix note on ${input.ticket}.` };
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
        "Order food for a team. Phases are managed by pending action state. Just call with teamName — the system routes to the correct phase automatically.",
      inputSchema: z.object({
        teamName: z.string().describe("Team to order for: tech, product, or design"),
        budgetPerHeadCents: z.number().int().positive().optional().describe("Budget per person in cents (default 2500 = SGD 25)"),
        confirm: z.boolean().optional().describe("Set to true ONLY when system says approval granted"),
        excludeRestaurants: z.array(z.string()).optional().describe("Restaurant names to exclude (already shown)"),
      }),
      execute: async (input) => {
        const pending = ctx.pendingAction?.type === "food_order" ? ctx.pendingAction : null;
        const foodApprovalGranted = ctx.approvalGranted && !!pending;

        // ─── Phase 3: user confirmed payment → charge Stripe (only when in confirm_payment phase) ───
        if (input.confirm || (foodApprovalGranted && pending?.phase === "confirm_payment" && pending.lineItems)) {
          const alreadyCharged = ctx.events.some(
            (e) => e.type === "food_order" && "order" in e && (e as any).order?.payment,
          );
          if (alreadyCharged) {
            return { ok: true, tool: "buySomething", summary: "Payment already processed." };
          }

          const teamName = pending?.teamName ?? input.teamName;
          const budgetPerHead = pending?.budgetPerHeadCents ?? input.budgetPerHeadCents ?? 2500;
          const headcount = pending?.headcount ?? 5;
          const totalCents = pending?.totalCents ?? budgetPerHead * headcount;
          const lineItems = pending?.lineItems;

          const chargeResult = await toolRegistry.buySomething.run({
            teamName,
            budgetPerHeadCents: budgetPerHead,
            confirm: true,
          }, {});

          if (chargeResult.ok && chargeResult.data) {
            const data = chargeResult.data as {
              team: { teamName: string; headcount: number; combinedDietary: string[]; combinedAllergens: string[] };
              recommendations: FoodOrderEvent["recommendations"];
              budgetPerHeadCents: number;
              lineItems?: FoodLineItem[];
              payment?: FoodOrderEvent["payment"];
            };
            const order: FoodOrderEvent = {
              teamName: data.team.teamName,
              headcount: data.team.headcount,
              dietary: data.team.combinedDietary,
              allergens: data.team.combinedAllergens,
              recommendations: data.recommendations,
              budgetPerHeadCents: data.budgetPerHeadCents,
              lineItems: lineItems ?? data.lineItems,
              payment: data.payment,
            };

            ctx.send("agent_event", { type: "food_order", order });
            const sentEvent = { type: "food_order" as const, order, _sent: true };
            ctx.events.push(sentEvent as typeof sentEvent & { _sent: boolean });
            await persistToolCard(ctx.conversationId, "buySomething", "Food order charged", ctx.nextOrderRef, {
              foodOrder: order,
            });
            await clearPendingAction(ctx.conversationId);
            await auditExternalMutation(ctx.conversationId, {
              system: "Stripe",
              target: `Team lunch: ${teamName}`,
              action: `Charged SGD ${(totalCents / 100).toFixed(2)} for ${headcount} people`,
            });
          }

          return { ...chargeResult, pendingAction: null };
        }

        // ─── Phase 2: user told us what they want → generate line items + ask confirmation ───
        if (foodApprovalGranted && pending?.phase === "confirm_order" && pending.userItemRequest && !pending.lineItems) {
          const teamName = pending.teamName;
          const budgetPerHead = pending.budgetPerHeadCents;
          const headcount = pending.headcount;
          const selectedRestaurant = pending.selectedRestaurant ?? "Selected restaurant";

          const itemResult = await toolRegistry.buySomething.run({
            teamName,
            budgetPerHeadCents: budgetPerHead,
            confirm: true,
          }, {});

          const itemData = itemResult.data as {
            team: { teamName: string; headcount: number; combinedDietary: string[]; combinedAllergens: string[] };
            lineItems?: FoodLineItem[];
          } | undefined;

          const lineItems: FoodLineItem[] = itemData?.lineItems ?? [];
          const actualTotal = lineItems.reduce((sum, li) => sum + li.priceCents, 0) || pending.totalCents;

          const order: FoodOrderEvent = {
            teamName,
            headcount,
            dietary: pending.dietary,
            allergens: pending.allergens,
            recommendations: [{ restaurantName: selectedRestaurant, url: "", reason: "User selected", estimatedCostPerHead: `~$${(budgetPerHead / 100).toFixed(0)}/person` }],
            budgetPerHeadCents: budgetPerHead,
            lineItems,
          };

          ctx.send("agent_event", { type: "food_order", order });
          const sentEvent = { type: "food_order" as const, order, _sent: true };
          ctx.events.push(sentEvent as typeof sentEvent & { _sent: boolean });
          await persistToolCard(ctx.conversationId, "buySomething", "Order preview", ctx.nextOrderRef, {
            foodOrder: order,
          });

          const confirmAction: PendingAction = {
            actionId: `${ctx.conversationId}-pending-food-confirm-${Date.now()}`,
            type: "food_order",
            phase: "confirm_order",
            teamName,
            headcount,
            budgetPerHeadCents: budgetPerHead,
            totalCents: actualTotal,
            selectedRestaurant,
            dietary: pending.dietary,
            allergens: pending.allergens,
            userItemRequest: pending.userItemRequest,
            lineItems,
            reason: `Confirm order from ${selectedRestaurant} — SGD ${(actualTotal / 100).toFixed(2)} for ${headcount} people.`,
            createdAt: new Date().toISOString(),
          };

          await setPendingAction(ctx.conversationId, confirmAction);

          const itemsSummary = lineItems.map((li) => `• ${li.person}: ${li.item} — $${(li.priceCents / 100).toFixed(2)}`).join("\n");
          return {
            ok: true,
            tool: "buySomething",
            summary: `Here's what I'll order from ${selectedRestaurant}:\n\n${itemsSummary}\n\nTotal: SGD ${(actualTotal / 100).toFixed(2)} for ${headcount} people. Shall I confirm and place this order?`,
            data: { order, lineItems },
            pendingAction: confirmAction,
          };
        }

        // ─── Phase 1: search restaurants, show recommendations ───
        const excludeList = [
          ...(ctx.previousRestaurants ?? []),
          ...(input.excludeRestaurants ?? []),
        ];
        const result = await toolRegistry.buySomething.run({
          teamName: input.teamName,
          budgetPerHeadCents: input.budgetPerHeadCents ?? 2500,
          confirm: false,
          ...(excludeList.length > 0 ? { excludeRestaurants: excludeList } : {}),
        }, {});

        if (result.ok && result.data) {
          const data = result.data as {
            team: { teamName: string; headcount: number; combinedDietary: string[]; combinedAllergens: string[] };
            recommendations: FoodOrderEvent["recommendations"];
            budgetPerHeadCents: number;
          };

          const exclusions = [
            ...(ctx.previousRestaurants ?? []),
            ...(input.excludeRestaurants ?? []),
          ].map((n) => n.toLowerCase());
          if (exclusions.length > 0) {
            data.recommendations = data.recommendations.filter(
              (rec) => !exclusions.some((ex) => rec.restaurantName.toLowerCase().includes(ex) || ex.includes(rec.restaurantName.toLowerCase())),
            );
          }

          const order: FoodOrderEvent = {
            teamName: data.team.teamName,
            headcount: data.team.headcount,
            dietary: data.team.combinedDietary,
            allergens: data.team.combinedAllergens,
            recommendations: data.recommendations,
            budgetPerHeadCents: data.budgetPerHeadCents,
          };

          ctx.send("agent_event", { type: "food_order", order });
          const sentEvent = { type: "food_order" as const, order, _sent: true };
          ctx.events.push(sentEvent as typeof sentEvent & { _sent: boolean });
          await persistToolCard(ctx.conversationId, "buySomething", "Restaurant recommendations", ctx.nextOrderRef, {
            foodOrder: order,
          });

          const totalCents = data.budgetPerHeadCents * data.team.headcount;
          const pendingFoodAction: PendingAction = {
            actionId: `${ctx.conversationId}-pending-food-${Date.now()}`,
            type: "food_order",
            phase: "pick_restaurant",
            teamName: data.team.teamName,
            headcount: data.team.headcount,
            budgetPerHeadCents: data.budgetPerHeadCents,
            totalCents,
            dietary: data.team.combinedDietary,
            allergens: data.team.combinedAllergens,
            reason: `Pick a restaurant for ${data.team.teamName} team lunch (${data.team.headcount} people).`,
            createdAt: new Date().toISOString(),
          };

          await setPendingAction(ctx.conversationId, pendingFoodAction);

          const recNames = data.recommendations.map((r) => r.restaurantName).join(", ");
          return {
            ok: true,
            tool: "buySomething",
            summary: `Here are ${data.recommendations.length} restaurant options for the ${data.team.teamName} team (${data.team.headcount} people): ${recNames}. Which restaurant would you like to order from?`,
            data: result.data,
            pendingAction: pendingFoodAction,
          };
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
    role: { $in: ["user", "assistant", "tool"] },
  })
    .sort({ order: 1 })
    .limit(30)
    .lean();

  const messages: ModelMessage[] = [];

  for (const message of persistedMessages) {
    if (message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, content: message.content });
    } else if (message.role === "tool" && message.toolData) {
      const toolData = message.toolData as { state?: string; output?: Record<string, unknown> };
      if (toolData.state === "finished" && toolData.output) {
        const output = toolData.output;
        const summary = output.summary ?? output.message ?? output.text;
        if (summary) {
          messages.push({
            role: "assistant",
            content: `[Tool result — ${message.toolName}]: ${String(summary).slice(0, 400)}`,
          });
        }
      }
    }
  }

  // Keep context window manageable — take the last 20 messages
  return messages.slice(-20);
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

  if (pendingAction.type === "food_order") {
    return { type: "tool" as const, toolName: "delegateToPayments" as const };
  }

  return undefined;
}

function isFoodOrderSelection(message: string, pendingAction: PendingAction | null): boolean {
  if (pendingAction?.type !== "food_order") return false;
  const rejection = /\b(no|cancel|stop|nevermind|never mind|don't|nope)\b/i;
  if (rejection.test(message)) return false;
  if (isFoodReSearchRequest(message)) return false;

  // "confirm_order" phase requires explicit confirmation of the items
  if (pendingAction.phase === "confirm_order") {
    return isApprovalMessage(message);
  }

  // "confirm_payment" phase requires explicit confirmation before charging
  if (pendingAction.phase === "confirm_payment") {
    return isApprovalMessage(message);
  }

  // "choose_items" phase: user is telling us what they want to order
  // Any non-rejection response is treated as their item request
  if (pendingAction.phase === "choose_items") {
    return true;
  }

  // "pick_restaurant" phase: any non-rejection response is a restaurant selection
  return true;
}

function isFoodReSearchRequest(message: string): boolean {
  return /\b(others?|different|more|else|another|alternatives|new options|other options|other locations|other restaurants|try again|search again)\b/i.test(message);
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

${pendingAction?.type === "food_order" && pendingAction.phase === "choose_items" && !approvalGranted
    ? `Food order in progress: user picked "${pendingAction.selectedRestaurant}" for ${pendingAction.teamName} team (${pendingAction.headcount} people, budget ~$${((pendingAction.budgetPerHeadCents ?? 2500) / 100).toFixed(0)}/person). DO NOT delegate or call any tools. Ask the user what they'd like to order — suggest a few options based on the restaurant type and ask them to pick or tell you what they want.`
    : pendingAction?.type === "food_order" && pendingAction.phase === "confirm_payment" && !approvalGranted
    ? `Food order ready for payment: ${pendingAction.teamName} team, ${pendingAction.headcount} people, SGD ${((pendingAction.totalCents ?? 0) / 100).toFixed(2)} from ${pendingAction.selectedRestaurant ?? "the restaurant"}. DO NOT delegate or call any tools. Ask the user to confirm they want to proceed with payment. Be explicit about the total amount that will be charged.`
    : pendingAction ? `Pending action awaiting approval:\n${JSON.stringify(pendingAction)}\nUser approval: ${approvalGranted ? "yes — delegate to Updater immediately" : "no"}` : "No pending actions."}`;
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
