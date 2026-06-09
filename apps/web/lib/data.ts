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
  type: string;
  source: string;
  summary: string;
  x: number;
  y: number;
  links: string[];
  metadata?: Record<string, unknown>;
  indexedAt?: string;
  sourceId?: string;
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
        sourceId: node.sourceId,
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
