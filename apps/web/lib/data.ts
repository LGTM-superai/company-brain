import { connectMongo } from "./mongodb";
import {
  AgentModel,
  CompanyUserModel,
  ConversationModel,
  KBDocumentModel,
  KnowledgeNodeModel,
  MessageModel,
} from "./models";

export type DashboardConversation = {
  conversationId: string;
  title: string;
  summary: string;
  updatedLabel: string;
};

export type BudgetAllocation = {
  projectId: string;
  amountCents: number;
  currency: string;
  cardId: string;
  status: "active" | "created";
};

export type FoodRecommendation = {
  restaurantName: string;
  url: string;
  reason: string;
  estimatedCostPerHead: string;
};

export type FoodLineItem = {
  person: string;
  item: string;
  priceCents: number;
  notes?: string;
};

export type FoodOrder = {
  teamName: string;
  headcount: number;
  dietary: string[];
  allergens: string[];
  recommendations: FoodRecommendation[];
  budgetPerHeadCents: number;
  lineItems?: FoodLineItem[];
  payment?: {
    totalCents: number;
    paymentIntentId: string;
    status: string;
  };
};

export type DashboardMessage = {
  messageId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolData?: unknown;
  exaResults?: Array<{
    title: string;
    url: string;
    summary: string;
    publishedDate?: string;
  }>;
  repoMonitors?: Array<{
    owner: string;
    repo: string;
    monitorId: string;
    packages: string[];
    slackChannelId: string;
    severityThreshold: string;
    status: string;
    createdAt: string;
  }>;
  exaVerdict?: {
    verdict: string;
    blocker_validity?: string;
    confidence: string;
    evidence_url: string;
    evidence_title: string;
    summary: string;
    recommended_next_step: string;
    notion_note_suggestion?: string;
    slack_message_suggestion?: string;
  };
  exaCVE?: {
    cve_id: string;
    severity: string;
    affected_packages: string[];
    summary: string;
    mitigation: string;
    patch_url: string;
  };
  exaNews?: Array<{
    title: string;
    source: string;
    url: string;
    published_date: string;
    summary: string;
  }>;
  budgetAllocations?: BudgetAllocation[];
  foodOrder?: FoodOrder;
  kbDocuments?: import("@company-brain/shared").KBDocumentResult[];
  toolFailure?: { tool: string; error: string; recovery: string };
  serviceStatus?: { service: string; status: "healthy" | "degraded" | "down" };
  plan?: import("@company-brain/shared").AgentPlan;
};

export type DashboardAgent = {
  agentId: string;
  name: string;
  owner: string;
  purpose: string;
  tools: string[];
};

export type DashboardUser = {
  userId: string;
  name: string;
  email: string;
  role: string;
  responsibilities: string[];
};

export type KnowledgeNode = {
  nodeId: string;
  label: string;
  type: "tag";
  source: "s3" | "notion" | "both";
  summary: string;
  x: number;
  y: number;
  links: string[];
  metadata?: {
    documents: Array<{ path: string; source: "s3" | "notion"; title?: string }>;
    weight: number;
  };
  indexedAt?: string;
};

export type DashboardData = {
  conversations: DashboardConversation[];
  messages: DashboardMessage[];
  agents: DashboardAgent[];
  users: DashboardUser[];
  knowledgeNodes: KnowledgeNode[];
  error?: string;
};

function tagToNodeId(tag: string): string {
  return `tag-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function buildKnowledgeNodesFromDocs(docs: any[]): KnowledgeNode[] {
  const tagMap = new Map<string, {
    nodeId: string;
    label: string;
    source: "s3" | "notion" | "both";
    links: Set<string>;
    documents: Array<{ path: string; source: "s3" | "notion"; title?: string }>;
    weight: number;
  }>();

  for (const doc of docs) {
    const tags: string[] = doc.tags ?? [];
    if (tags.length === 0) continue;
    const source: "s3" | "notion" = doc.s3Key ? "s3" : "notion";

    for (const tag of tags) {
      const nodeId = tagToNodeId(tag);
      let existing = tagMap.get(nodeId);
      if (!existing) {
        existing = { nodeId, label: tag, source, links: new Set(), documents: [], weight: 0 };
        tagMap.set(nodeId, existing);
      } else if (existing.source !== source) {
        existing.source = "both";
      }
      existing.documents.push({ path: doc.key ?? doc.s3Key ?? doc.title, source, title: doc.title });
      existing.weight++;
    }

    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tagToNodeId(tags[i]);
        const b = tagToNodeId(tags[j]);
        tagMap.get(a)!.links.add(b);
        tagMap.get(b)!.links.add(a);
      }
    }
  }

  const nodes = Array.from(tagMap.values());
  if (nodes.length === 0) return [];

  // Force-directed layout
  const positions = nodes.map((_, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const radius = 30 + Math.random() * 10;
    return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
  });
  const nodeIndex = new Map(nodes.map((n, i) => [n.nodeId, i]));

  for (let iter = 0; iter < 300; iter++) {
    const forces = positions.map(() => ({ fx: 0, fy: 0 }));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 100 / (dist * dist);
        forces[i].fx += (dx / dist) * force;
        forces[i].fy += (dy / dist) * force;
        forces[j].fx -= (dx / dist) * force;
        forces[j].fy -= (dy / dist) * force;
      }
    }
    for (const node of nodes) {
      const i = nodeIndex.get(node.nodeId)!;
      for (const linkId of node.links) {
        const j = nodeIndex.get(linkId);
        if (j === undefined) continue;
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        forces[i].fx += dx * dist * 0.01;
        forces[i].fy += dy * dist * 0.01;
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      forces[i].fx += (50 - positions[i].x) * 0.005;
      forces[i].fy += (50 - positions[i].y) * 0.005;
    }
    const cooling = 1 - iter / 300;
    for (let i = 0; i < nodes.length; i++) {
      positions[i].x += forces[i].fx * cooling * 0.5;
      positions[i].y += forces[i].fy * cooling * 0.5;
      positions[i].x = Math.max(5, Math.min(95, positions[i].x));
      positions[i].y = Math.max(5, Math.min(95, positions[i].y));
    }
  }

  const excludePattern = /\b(slack|exa|github|stripe|webhook)\b/i;
  return nodes
    .filter((n) => !excludePattern.test(n.label))
    .map((n) => {
      const i = nodeIndex.get(n.nodeId)!;
      return {
        nodeId: n.nodeId,
        label: n.label,
        type: "tag" as const,
        source: n.source,
        summary: `Tag: ${n.label}`,
        x: Math.round(positions[i].x * 100) / 100,
        y: Math.round(positions[i].y * 100) / 100,
        links: Array.from(n.links),
        metadata: { documents: n.documents, weight: n.weight },
      };
    });
}

export async function getDashboardData(): Promise<DashboardData> {
  try {
    await connectMongo();

    const [conversations, agents, users, knowledgeNodes] = await Promise.all([
      ConversationModel.find().sort({ updatedAt: -1, order: 1 }).lean(),
      AgentModel.find().sort({ agentId: 1 }).lean(),
      CompanyUserModel.find().sort({ userId: 1 }).lean(),
      KnowledgeNodeModel.find({
        label: { $not: /\b(slack|exa|github|stripe|webhook)\b/i },
      }).sort({ nodeId: 1 }).lean(),
    ]);

    // If no pre-indexed nodes exist, build the graph dynamically from KBDocuments
    let resolvedNodes: KnowledgeNode[];
    if (knowledgeNodes.length > 0) {
      resolvedNodes = knowledgeNodes.map((node) => ({
        nodeId: node.nodeId,
        label: node.label,
        type: node.type,
        source: node.source,
        summary: node.summary,
        x: node.x,
        y: node.y,
        links: node.links,
        metadata: node.metadata,
        indexedAt: node.indexedAt?.toISOString?.() ?? node.indexedAt,
      }));
    } else {
      const docs = await KBDocumentModel.find({}).lean();
      resolvedNodes = buildKnowledgeNodesFromDocs(docs);
    }

    const activeConversation = conversations[0];
    const messages = activeConversation
      ? await MessageModel.find({ conversationId: activeConversation.conversationId })
          .sort({ order: 1 })
          .lean()
      : [];

    return {
      conversations: conversations.map((conversation) => ({
        conversationId: conversation.conversationId,
        title: conversation.title,
        summary: conversation.summary,
        updatedLabel: conversation.updatedLabel,
      })),
      messages: messages.map((message) =>
        JSON.parse(
          JSON.stringify({
            messageId: message.messageId,
            role: message.role,
            content: message.content,
            toolName: message.toolName,
            toolData: message.toolData,
            exaResults: message.exaResults?.map((result: Record<string, unknown>) => ({
              title: result.title,
              url: result.url,
              summary: result.summary,
              publishedDate: result.publishedDate,
            })),
            repoMonitors: message.repoMonitors?.map((monitor: Record<string, unknown>) => ({
              owner: monitor.owner,
              repo: monitor.repo,
              monitorId: monitor.monitorId,
              packages: monitor.packages,
              slackChannelId: monitor.slackChannelId,
              severityThreshold: monitor.severityThreshold,
              status: monitor.status,
              createdAt: monitor.createdAt,
            })),
            exaVerdict: message.exaVerdict,
            exaCVE: message.exaCVE,
            exaNews: message.exaNews,
            budgetAllocations: message.budgetAllocations,
            foodOrder: message.foodOrder,
            kbDocuments: message.kbDocuments,
          }),
        ),
      ),
      agents: agents.map((agent) => ({
        agentId: agent.agentId,
        name: agent.name,
        owner: agent.owner,
        purpose: agent.purpose,
        tools: agent.tools,
      })),
      users: users.map((user) => ({
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        responsibilities: user.responsibilities,
      })),
      knowledgeNodes: resolvedNodes,
    };
  } catch (error) {
    return {
      conversations: [],
      messages: [],
      agents: [],
      users: [],
      knowledgeNodes: [],
      error: error instanceof Error ? error.message : "Could not load MongoDB data.",
    };
  }
}
