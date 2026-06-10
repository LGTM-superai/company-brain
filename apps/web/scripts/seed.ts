import { agentRegistry } from "@company-brain/agents";
import { users } from "@company-brain/shared";
import { connectMongo, disconnectMongo } from "../lib/mongodb";
import {
  AgentModel,
  CompanyUserModel,
  ConversationModel,
  KnowledgeNodeModel,
  MessageModel,
} from "../lib/models";

const conversations = [
  {
    conversationId: "conv-harbor-overdue",
    title: "Harbor Bean overdue blockers",
    summary: "Detected HB-101 as P0, Not started, and overdue by GMT+8 date logic.",
    updatedLabel: "Just now",
    order: 1,
  },
  {
    conversationId: "conv-map-blocker-exa",
    title: "HB-204 Exa validation",
    summary: "Used Exa to verify whether the map overflow blocker is fixable from official docs.",
    updatedLabel: "12 min ago",
    order: 2,
  },
  {
    conversationId: "conv-hb101-followup-note",
    title: "HB-101 follow-up note",
    summary: "Recorded a Latest agent note for Carlos follow-up and logged the simulated Slack audit.",
    updatedLabel: "34 min ago",
    order: 3,
  },
  {
    conversationId: "conv-hb201-approval-move",
    title: "HB-201 approval move",
    summary: "Prepared a status move that only mutates Notion after second-turn approval.",
    updatedLabel: "Yesterday",
    order: 4,
  },
];

const messages = [
  {
    messageId: "m-001",
    conversationId: "conv-harbor-overdue",
    role: "user",
    content: "What is overdue or potentially blocked for Harbor Bean?",
    order: 1,
  },
  {
    messageId: "m-002",
    conversationId: "conv-harbor-overdue",
    role: "tool",
    content: "Tool called: queryNotion",
    toolName: "queryNotion",
    order: 2,
  },
  {
    messageId: "m-003",
    conversationId: "conv-harbor-overdue",
    role: "assistant",
    content:
      "HB-101 is potentially blocked: it is Not started, P0, assigned to Carlos, and due June 5, 2026. As of June 9, 2026 GMT+8, it is overdue by 4 days.",
    order: 3,
  },
  {
    messageId: "m-004",
    conversationId: "conv-map-blocker-exa",
    role: "user",
    content: "Is the map issue a real blocker or fixable based on docs?",
    order: 1,
  },
  {
    messageId: "m-005",
    conversationId: "conv-map-blocker-exa",
    role: "tool",
    content: "Tool called: queryNotion",
    toolName: "queryNotion",
    order: 2,
  },
  {
    messageId: "m-006",
    conversationId: "conv-map-blocker-exa",
    role: "tool",
    content: "Tool called: queryExa",
    toolName: "queryExa",
    order: 3,
    toolData: {
      output: {
        ok: true,
        verdict: {
          verdict: "Likely fixable",
          confidence: "medium",
          evidence_url: "https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio",
          evidence_title: "CSS aspect-ratio",
          summary: "Responsive iframe wrappers can preserve map aspect ratio and prevent overflow.",
          recommended_next_step: "Apply a responsive iframe container before treating HB-204 as a hard blocker.",
        },
      },
    },
  },
  {
    messageId: "m-007",
    conversationId: "conv-map-blocker-exa",
    role: "assistant",
    content:
      "HB-204 looks fixable rather than truly blocked. Exa evidence points to responsive aspect-ratio handling for embedded content, so the next step is to implement the wrapper and verify mobile width behavior.",
    order: 4,
  },
  {
    messageId: "m-008",
    conversationId: "conv-hb101-followup-note",
    role: "user",
    content: "Record that HB-101 is potentially blocked and needs Carlos follow-up.",
    order: 1,
  },
  {
    messageId: "m-009",
    conversationId: "conv-hb101-followup-note",
    role: "tool",
    content: "Tool called: queryNotion",
    toolName: "queryNotion",
    order: 2,
  },
  {
    messageId: "m-010",
    conversationId: "conv-hb101-followup-note",
    role: "tool",
    content: "Tool called: updateNotion",
    toolName: "updateNotion",
    order: 3,
  },
  {
    messageId: "m-011",
    conversationId: "conv-hb101-followup-note",
    role: "tool",
    content: "Tool called: updateSlack",
    toolName: "updateSlack",
    order: 4,
  },
  {
    messageId: "m-012",
    conversationId: "conv-hb101-followup-note",
    role: "assistant",
    content:
      "Recorded the HB-101 Latest agent note for Carlos follow-up and logged the simulated audit to #company-brain-actions.",
    order: 5,
  },
  {
    messageId: "m-013",
    conversationId: "conv-hb201-approval-move",
    role: "user",
    content: "Move HB-201 to In review.",
    order: 1,
  },
  {
    messageId: "m-014",
    conversationId: "conv-hb201-approval-move",
    role: "tool",
    content: "Tool called: queryNotion",
    toolName: "queryNotion",
    order: 2,
  },
  {
    messageId: "m-015",
    conversationId: "conv-hb201-approval-move",
    role: "assistant",
    content:
      "I found HB-201, currently In progress. Move it to In review?",
    order: 3,
  },
];

const knowledgeNodes = [
  {
    nodeId: "company-brain",
    label: "Company Brain",
    type: "agent-router",
    source: "internal",
    summary: "Routes work to coder, payments manager, searcher, and updater agents.",
    x: 50,
    y: 50,
    links: ["sprint-board", "slack", "github", "exa"],
  },
  {
    nodeId: "sprint-board",
    label: "Sprint Board",
    type: "project-source",
    source: "notion",
    summary: "Live Notion kanban tickets, statuses, assignees, priorities, due dates, and body-defined agent flow.",
    x: 27,
    y: 73,
    links: ["company-brain", "hb-101", "hb-204", "hb-201"],
  },
  {
    nodeId: "slack",
    label: "Slack",
    type: "communication-source",
    source: "slack",
    summary: "Engineering updates, announcements, blocker signals, and action logs.",
    x: 77,
    y: 25,
    links: ["company-brain"],
  },
  {
    nodeId: "github",
    label: "GitHub",
    type: "code-source",
    source: "github",
    summary: "Repository, issue, pull request, branch, and code context.",
    x: 73,
    y: 75,
    links: ["company-brain"],
  },
  {
    nodeId: "exa",
    label: "Exa",
    type: "external-search",
    source: "exa",
    summary: "External documentation and live-web validation results.",
    x: 50,
    y: 17,
    links: ["company-brain", "hb-204"],
  },
  {
    nodeId: "hb-101",
    label: "HB-101",
    type: "ticket",
    source: "notion",
    summary: "Collect final reservation link; P0, Not started, and overdue.",
    x: 50,
    y: 84,
    links: ["sprint-board"],
  },
  {
    nodeId: "hb-204",
    label: "HB-204",
    type: "ticket",
    source: "notion",
    summary: "Validate responsive Google Maps embed with Exa-backed docs evidence.",
    x: 21,
    y: 47,
    links: ["sprint-board", "exa"],
  },
  {
    nodeId: "hb-201",
    label: "HB-201",
    type: "ticket",
    source: "notion",
    summary: "Hero and opening-hours section; status move requires approval.",
    x: 82,
    y: 50,
    links: ["sprint-board"],
  },
];

const replacedConversationIds = [
  "contact-page-launch",
  "brochure-assets",
  "security-triage",
  "conv-pistachio-launch-blocker",
  "conv-brochure-asset-lookup",
  "conv-ticket-status-update",
  "conv-contractor-payment",
  ...conversations.map((conversation) => conversation.conversationId),
];

async function seed() {
  await connectMongo();

  await Promise.all(
    users.map((user) =>
      CompanyUserModel.updateOne(
        { userId: user.id },
        {
          $set: {
            userId: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            responsibilities: user.responsibilities,
          },
        },
        { upsert: true },
      ),
    ),
  );

  await Promise.all(
    Object.values(agentRegistry).map((agent) =>
      AgentModel.updateOne(
        { agentId: agent.id },
        {
          $set: {
            agentId: agent.id,
            name: agent.name,
            owner: agent.owner,
            purpose: agent.purpose,
            tools: agent.tools,
          },
        },
        { upsert: true },
      ),
    ),
  );

  await ConversationModel.deleteMany({
    conversationId: { $in: replacedConversationIds },
  });

  await Promise.all(
    conversations.map((conversation) =>
      ConversationModel.updateOne(
        { conversationId: conversation.conversationId },
        { $set: conversation },
        { upsert: true },
      ),
    ),
  );

  await MessageModel.deleteMany({
    conversationId: { $in: replacedConversationIds },
  });
  await MessageModel.insertMany(messages);

  await KnowledgeNodeModel.deleteMany({ nodeId: { $in: ["notion-kb", "web-112", "brochure-assets"] } });

  await Promise.all(
    knowledgeNodes.map((node) =>
      KnowledgeNodeModel.updateOne({ nodeId: node.nodeId }, { $set: node }, { upsert: true }),
    ),
  );

  await disconnectMongo();

  console.log("Seeded Company Brain sample data.");
}

seed().catch(async (error) => {
  console.error(error);
  await disconnectMongo();
  process.exit(1);
});
