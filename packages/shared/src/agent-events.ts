import type { ToolName } from "./tool-types";

export type ExaSearchResult = {
  title: string;
  url: string;
  summary: string;
  publishedDate?: string;
  author?: string;
  image?: string;
  favicon?: string;
  highlights?: string[];
};

export type ExaUseCase = "verification" | "research" | "cve" | "news";

export type ExaVerdictResult = {
  verdict: string;
  confidence: string;
  evidence_url: string;
  evidence_title: string;
  summary: string;
  recommended_next_step: string;
};

export type ExaCVEEventResult = {
  cve_id: string;
  severity: string;
  affected_packages: string[];
  summary: string;
  mitigation: string;
  patch_url: string;
};

export type ExaNewsEventArticle = {
  title: string;
  source: string;
  url: string;
  published_date: string;
  summary: string;
};

export type RepoMonitor = {
  owner: string;
  repo: string;
  monitorId: string;
  packages: string[];
  slackChannelId: string;
  severityThreshold: "critical" | "high" | "moderate" | "low" | "all";
  status: "active" | "paused" | "error";
  createdAt: string;
};

export type BudgetAllocationEvent = {
  projectId: string;
  amountCents: number;
  currency: string;
  cardId: string;
  status: "active" | "created";
};

export type FoodRecommendationEvent = {
  restaurantName: string;
  url: string;
  reason: string;
  estimatedCostPerHead: string;
};

export type FoodOrderEvent = {
  teamName: string;
  headcount: number;
  dietary: string[];
  allergens: string[];
  recommendations: FoodRecommendationEvent[];
  budgetPerHeadCents: number;
  payment?: {
    totalCents: number;
    paymentIntentId: string;
    status: string;
  };
};

export type AgentEvent =
  | {
      type: "tool_call";
      tool: ToolName;
      args?: unknown;
    }
  | {
      type: "tool_result";
      tool: ToolName;
      result: unknown;
    }
  | {
      type: "exa_results";
      results: ExaSearchResult[];
    }
  | {
      type: "exa_searching";
      runId: string;
      useCase: ExaUseCase;
      query: string;
    }
  | {
      type: "exa_verdict";
      runId: string;
      verdict: ExaVerdictResult;
    }
  | {
      type: "exa_cve";
      runId: string;
      result: ExaCVEEventResult;
    }
  | {
      type: "exa_news";
      runId: string;
      articles: ExaNewsEventArticle[];
    }
  | {
      type: "repo_monitors";
      monitors: RepoMonitor[];
    }
  | {
      type: "budget_allocated";
      allocations: BudgetAllocationEvent[];
      totalCents: number;
    }
  | {
      type: "food_order";
      order: FoodOrderEvent;
    }
  | {
      type: "assistant_message";
      content: string;
    }
  | {
      type: "done";
    };
