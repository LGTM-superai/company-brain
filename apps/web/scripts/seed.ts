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
    conversationId: "conv-pistachio-launch-blocker",
    title: "Pistachio Cafe launch blocker",
    summary: "Checked Notion sprint status, Slack silence, GitHub context, and Exa docs for WEB-112.",
    updatedLabel: "Just now",
    order: 1,
  },
  {
    conversationId: "conv-brochure-asset-lookup",
    title: "June tasting brochure",
    summary: "Located the latest marketing brochure image from the Notion knowledge base asset index.",
    updatedLabel: "12 min ago",
    order: 2,
  },
  {
    conversationId: "conv-ticket-status-update",
    title: "Move WEB-112 to review",
    summary: "Updated the Notion sprint board and logged the write to #company-brain-actions.",
    updatedLabel: "34 min ago",
    order: 3,
  },
  {
    conversationId: "conv-contractor-payment",
    title: "Freelancer payout approval",
    summary: "Prepared a human-in-the-loop Stripe payout for approved cafe landing page illustration work.",
    updatedLabel: "Yesterday",
    order: 4,
  },
];

const messages = [
  {
    messageId: "m-001",
    conversationId: "conv-pistachio-launch-blocker",
    role: "user",
    content: "What is blocking the Pistachio Cafe contact page launch? Verify whether the blocker is actually valid.",
    order: 1,
  },
  {
    messageId: "m-002",
    conversationId: "conv-pistachio-launch-blocker",
    role: "tool",
    content: "Tool called: queryNotionSprintBoard",
    toolName: "queryNotionSprintBoard",
    order: 2,
  },
  {
    messageId: "m-003",
    conversationId: "conv-pistachio-launch-blocker",
    role: "tool",
    content: "Tool called: querySlack",
    toolName: "querySlack",
    order: 3,
  },
  {
    messageId: "m-004",
    conversationId: "conv-pistachio-launch-blocker",
    role: "tool",
    content: "Tool called: queryExa",
    toolName: "queryExa",
    order: 4,
    exaResults: [
      {
        title: "Next.js Forms and Server Actions",
        url: "https://nextjs.org/docs/app/guides/forms",
        publishedDate: "2026-05-21",
        summary: "Official docs for form submissions, validation, and server-side handlers.",
      },
      {
        title: "Vercel Guide: Handling Form Submissions",
        url: "https://vercel.com/guides",
        publishedDate: "2026-04-18",
        summary: "Implementation patterns for contact forms, redirects, and deployment behavior.",
      },
    ],
  },
  {
    messageId: "m-005",
    conversationId: "conv-pistachio-launch-blocker",
    role: "assistant",
    content:
      "WEB-112 is the current blocker. The Notion sprint board still has it In Progress, Slack has no owner update in the last 18 hours, and Exa found public implementation docs, so this looks like a solvable execution blocker rather than missing external knowledge.",
    order: 5,
  },
  {
    messageId: "m-006",
    conversationId: "conv-brochure-asset-lookup",
    role: "user",
    content: "Can you find the brochure image marketing uploaded for the June tasting event?",
    order: 1,
  },
  {
    messageId: "m-007",
    conversationId: "conv-brochure-asset-lookup",
    role: "tool",
    content: "Tool called: queryNotionKB",
    toolName: "queryNotionKB",
    order: 2,
  },
  {
    messageId: "m-008",
    conversationId: "conv-brochure-asset-lookup",
    role: "assistant",
    content:
      "Found it in the Notion page Marketing / Campaigns / June Tasting Event. The indexed asset points to Assets/brochure-june-event.png and is linked to the Pistachio Cafe launch package.",
    order: 3,
  },
  {
    messageId: "m-009",
    conversationId: "conv-ticket-status-update",
    role: "user",
    content: "Move WEB-112 from In Progress to In Review and log the action.",
    order: 1,
  },
  {
    messageId: "m-010",
    conversationId: "conv-ticket-status-update",
    role: "tool",
    content: "Tool called: queryNotionSprintBoard",
    toolName: "queryNotionSprintBoard",
    order: 2,
  },
  {
    messageId: "m-011",
    conversationId: "conv-ticket-status-update",
    role: "tool",
    content: "Tool called: updateNotionSprintBoard",
    toolName: "updateNotionSprintBoard",
    order: 3,
  },
  {
    messageId: "m-012",
    conversationId: "conv-ticket-status-update",
    role: "tool",
    content: "Tool called: updateSlack",
    toolName: "updateSlack",
    order: 4,
  },
  {
    messageId: "m-013",
    conversationId: "conv-ticket-status-update",
    role: "assistant",
    content:
      "WEB-112 was moved to In Review in the Notion sprint board, and the simulated write was logged to #company-brain-actions.",
    order: 5,
  },
  {
    messageId: "m-014",
    conversationId: "conv-contractor-payment",
    role: "user",
    content: "Pay the freelancer for the cafe menu illustration if the scope and approval are complete.",
    order: 1,
  },
  {
    messageId: "m-015",
    conversationId: "conv-contractor-payment",
    role: "tool",
    content: "Tool called: queryNotionKB",
    toolName: "queryNotionKB",
    order: 2,
  },
  {
    messageId: "m-016",
    conversationId: "conv-contractor-payment",
    role: "tool",
    content: "Tool called: makePayment",
    toolName: "makePayment",
    order: 3,
  },
  {
    messageId: "m-017",
    conversationId: "conv-contractor-payment",
    role: "assistant",
    content:
      "The invoice and approval record are present. A Stripe payout is staged for human approval, and the intended action will be posted to #company-brain-actions before execution.",
    order: 4,
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
    links: ["notion-kb", "sprint-board", "slack", "github", "exa"],
  },
  {
    nodeId: "notion-kb",
    label: "Notion KB",
    type: "knowledge-source",
    source: "notion",
    summary: "Company docs, client briefs, launch plans, and policy pages.",
    x: 18,
    y: 24,
    links: ["company-brain", "brochure-assets"],
  },
  {
    nodeId: "sprint-board",
    label: "Sprint Board",
    type: "project-source",
    source: "notion",
    summary: "Kanban tickets, statuses, assignees, priorities, and blockers.",
    x: 27,
    y: 73,
    links: ["company-brain", "web-112"],
  },
  {
    nodeId: "slack",
    label: "Slack",
    type: "communication-source",
    source: "slack",
    summary: "Engineering updates, announcements, blocker signals, and action logs.",
    x: 77,
    y: 25,
    links: ["company-brain", "web-112"],
  },
  {
    nodeId: "github",
    label: "GitHub",
    type: "code-source",
    source: "github",
    summary: "Repository, issue, pull request, branch, and code context.",
    x: 73,
    y: 75,
    links: ["company-brain", "web-112"],
  },
  {
    nodeId: "exa",
    label: "Exa",
    type: "external-search",
    source: "exa",
    summary: "External documentation and live-web validation results.",
    x: 50,
    y: 17,
    links: ["company-brain", "web-112"],
  },
  {
    nodeId: "web-112",
    label: "WEB-112",
    type: "ticket",
    source: "notion",
    summary: "Implement contact form routing; currently the main launch blocker.",
    x: 50,
    y: 84,
    links: ["sprint-board", "slack", "github", "exa"],
  },
  {
    nodeId: "brochure-assets",
    label: "Brochure Assets",
    type: "asset",
    source: "s3",
    summary: "Marketing event brochure image indexed from Notion and stored in S3.",
    x: 18,
    y: 49,
    links: ["notion-kb"],
  },
];

const replacedConversationIds = [
  "contact-page-launch",
  "brochure-assets",
  "security-triage",
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
    conversationId: { $in: ["contact-page-launch", "brochure-assets", "security-triage"] },
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
