import { generateText, stepCountIs, type ToolSet } from "ai";
import type { AgentEvent, AgentId, ToolName } from "@company-brain/shared";
import { getRuntimeModel } from "./ai-model";
import type { PendingAction } from "./run-history";

export type SpecialistResult = {
  ok: boolean;
  text: string;
  toolCalls: string[];
  requiresApproval?: boolean;
  pendingAction?: PendingAction;
};

export type SpecialistOptions = {
  agentId: AgentId;
  systemPrompt: string;
  tools: ToolSet;
  query: string;
  conversationId: string;
  events: AgentEvent[];
  send: (event: string, data: unknown) => void;
  approvalGranted: boolean;
  pendingAction: PendingAction | null;
};

export async function runSpecialist(options: SpecialistOptions): Promise<SpecialistResult> {
  const { agentId, systemPrompt, tools, query, events, send } = options;
  const toolCallNames: string[] = [];

  const attempt = async (retryCount: number): Promise<SpecialistResult> => {
    try {
      const result = await generateText({
        model: getRuntimeModel(),
        system: systemPrompt,
        messages: [{ role: "user", content: query }],
        tools,
        stopWhen: stepCountIs(5),
        maxOutputTokens: 800,
        onStepFinish: ({ toolCalls, toolResults }) => {
          for (const tc of toolCalls) {
            const toolName = tc.toolName as ToolName;
            toolCallNames.push(toolName);
            events.push({ type: "tool_call", tool: toolName, args: tc.input });
          }

          for (const tr of toolResults) {
            const resultData = tr.output as Record<string, unknown> | undefined;
            if (resultData?.requiresApproval) {
              send("agent_event", {
                type: "tool_result",
                tool: tr.toolName as ToolName,
                result: resultData,
              });
            } else {
              const summary = resultData?.summary ?? resultData?.message ?? "";
              const ok = resultData?.ok !== false;
              if (summary) {
                send("tool_done", { tool: `delegate:${agentId}`, summary: String(summary).slice(0, 200), error: !ok });
              }
            }
          }
        },
      });

      const lastStep = result.steps[result.steps.length - 1];
      const approvalResult = lastStep?.toolResults?.find(
        (tr) => (tr.output as Record<string, unknown> | undefined)?.requiresApproval,
      );

      if (approvalResult) {
        const data = approvalResult.output as Record<string, unknown>;
        return {
          ok: false,
          text: (data.message as string) ?? "This action requires your approval.",
          toolCalls: toolCallNames,
          requiresApproval: true,
          pendingAction: data.pendingAction as PendingAction | undefined,
        };
      }

      return {
        ok: true,
        text: result.text || "Done.",
        toolCalls: toolCallNames,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const isRetryable =
        message.includes("timeout") ||
        message.includes("rate limit") ||
        message.includes("503") ||
        message.includes("429");

      if (isRetryable && retryCount < 1) {
        send("agent_event", {
          type: "agent_delegation",
          agent: agentId,
          task: `Retrying ${agentId} (${message.slice(0, 60)})...`,
        });
        return attempt(retryCount + 1);
      }

      return {
        ok: false,
        text: `${agentId} failed: ${message}`,
        toolCalls: toolCallNames,
      };
    }
  };

  return attempt(0);
}
