import { connectMongo } from "./mongodb";
import {
  AgentModel,
  CompanyUserModel,
  ConversationModel,
  KnowledgeNodeModel,
  MessageModel,
} from "./models";

export type DashboardConversation = {
  conversationId: string;
  title: string;
  summary: string;
  updatedLabel: string;
};

export type DashboardMessage = {
  messageId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
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
    confidence: string;
    evidence_url: string;
    evidence_title: string;
    summary: string;
    recommended_next_step: string;
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

export async function getDashboardData(): Promise<DashboardData> {
  try {
    await connectMongo();

    const [conversations, agents, users, knowledgeNodes] = await Promise.all([
      ConversationModel.find().sort({ updatedAt: -1, order: 1 }).lean(),
      AgentModel.find().sort({ agentId: 1 }).lean(),
      CompanyUserModel.find().sort({ userId: 1 }).lean(),
      KnowledgeNodeModel.find().sort({ nodeId: 1 }).lean(),
    ]);

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
      messages: messages.map((message) => ({
        messageId: message.messageId,
        role: message.role,
        content: message.content,
        toolName: message.toolName,
        exaResults: message.exaResults,
        repoMonitors: message.repoMonitors,
        exaVerdict: message.exaVerdict,
        exaCVE: message.exaCVE,
        exaNews: message.exaNews,
      })),
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
      knowledgeNodes: knowledgeNodes.map((node) => ({
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
      })),
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
