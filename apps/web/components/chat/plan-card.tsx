"use client";

import { useState } from "react";
import type { AgentPlan, PlanStep } from "@company-brain/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  Circle,
  Loader2,
  XCircle,
  SkipForward,
  ListChecks,
  Play,
  Pencil,
  Brain,
} from "lucide-react";

const TOOL_LABELS: Record<string, string> = {
  queryNotion: "Notion",
  updateNotion: "Notion",
  querySlack: "Slack",
  updateSlack: "Slack",
  queryGithub: "GitHub",
  updateGithub: "GitHub",
  queryExa: "Exa Search",
  queryRepos: "CVE Monitors",
  queryKnowledgeBase: "Knowledge Base",
  makePayment: "Stripe",
  buySomething: "Food Order",
};

const AGENT_LABELS: Record<string, string> = {
  main: "Router",
  searcher: "Searcher",
  updater: "Updater",
  coder: "Coder",
  paymentsManager: "Payments",
};

function StepStatusIcon({ status }: { status: PlanStep["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "skipped":
      return <SkipForward className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/50" />;
  }
}

export function PlanCard({
  plan,
  onApprove,
  onEdit,
}: {
  plan: AgentPlan;
  onApprove?: () => void;
  onEdit?: (stepIds: string[]) => void;
}) {
  const [excludedSteps, setExcludedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    if (plan.status !== "proposed") return;
    setExcludedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleApprove = () => {
    if (excludedSteps.size > 0 && onEdit) {
      onEdit(plan.steps.filter((s) => !excludedSteps.has(s.id)).map((s) => s.id));
    } else if (onApprove) {
      onApprove();
    }
  };

  const isProposed = plan.status === "proposed";
  const isExecuting = plan.status === "executing";
  const isCompleted = plan.status === "completed";
  const completedCount = plan.steps.filter((s) => s.status === "done").length;

  return (
    <Card className="bg-card border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Execution Plan</span>
          {isExecuting && (
            <Badge className="text-[10px] h-5 bg-primary/10 text-primary">
              {completedCount}/{plan.steps.length}
            </Badge>
          )}
          {isCompleted && (
            <Badge className="text-[10px] h-5 bg-green-500/10 text-green-500">
              Complete
            </Badge>
          )}
        </div>
        {isProposed && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onEdit?.([])}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Skip all
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleApprove}
            >
              <Play className="h-3 w-3" />
              {excludedSteps.size > 0 ? "Run selected" : "Approve"}
            </Button>
          </div>
        )}
      </div>

      <CardContent className="p-0">
        <div className="px-4 py-2 bg-muted/30 border-b border-border">
          <div className="flex items-start gap-2">
            <Brain className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {plan.reasoning}
            </p>
          </div>
        </div>

        <div className="divide-y divide-border">
          {plan.steps.map((step, index) => {
            const excluded = excludedSteps.has(step.id);
            return (
              <div
                key={step.id}
                onClick={() => toggleStep(step.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 transition-colors",
                  isProposed && "cursor-pointer hover:bg-muted/30",
                  excluded && "opacity-40",
                  step.status === "running" && "bg-primary/5",
                )}
              >
                <span className="text-xs font-mono text-muted-foreground/60 w-4 text-right">
                  {index + 1}
                </span>
                <StepStatusIcon status={excluded ? "skipped" : step.status} />
                <div className="flex-grow min-w-0">
                  <p className={cn(
                    "text-sm text-foreground",
                    excluded && "line-through",
                  )}>
                    {step.description}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Badge variant="secondary" className="text-[10px] h-5">
                    {AGENT_LABELS[step.agent] ?? step.agent}
                  </Badge>
                  <Badge className="text-[10px] h-5 bg-accent/10 text-accent">
                    {TOOL_LABELS[step.tool] ?? step.tool}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
