import mongoose, { Schema } from "mongoose";

const CompanyUserSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    role: { type: String, required: true },
    responsibilities: { type: [String], default: [] },
  },
  { timestamps: true },
);

const AgentSchema = new Schema(
  {
    agentId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    owner: { type: String, required: true },
    purpose: { type: String, required: true },
    tools: { type: [String], default: [] },
  },
  { timestamps: true },
);

const ConversationSchema = new Schema(
  {
    conversationId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    updatedLabel: { type: String, default: "" },
    order: { type: Number, default: 0 },
    pendingAction: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

const MessageSchema = new Schema(
  {
    messageId: { type: String, required: true, unique: true },
    conversationId: { type: String, required: true, index: true },
    role: { type: String, enum: ["user", "assistant", "tool"], required: true },
    content: { type: String, required: true },
    toolName: { type: String },
    order: { type: Number, required: true },
    toolData: { type: Schema.Types.Mixed, default: undefined },
    exaResults: {
      type: [
        {
          title: String,
          url: String,
          summary: String,
          publishedDate: String,
        },
      ],
      default: undefined,
    },
  },
  { timestamps: true },
);

const SlackAuditSchema = new Schema(
  {
    auditId: { type: String, required: true, unique: true },
    conversationId: { type: String, required: true, index: true },
    channel: { type: String, default: "#company-brain-actions" },
    message: { type: String, required: true },
    action: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);

const KnowledgeNodeSchema = new Schema(
  {
    nodeId: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    type: { type: String, required: true },
    source: { type: String, required: true },
    summary: { type: String, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    links: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const CompanyUserModel =
  mongoose.models.CompanyUser ?? mongoose.model("CompanyUser", CompanyUserSchema);

export const AgentModel = mongoose.models.Agent ?? mongoose.model("Agent", AgentSchema);

export const ConversationModel =
  mongoose.models.Conversation ?? mongoose.model("Conversation", ConversationSchema);

export const MessageModel = mongoose.models.Message ?? mongoose.model("Message", MessageSchema);

export const KnowledgeNodeModel =
  mongoose.models.KnowledgeNode ?? mongoose.model("KnowledgeNode", KnowledgeNodeSchema);

export const SlackAuditModel =
  mongoose.models.SlackAudit ?? mongoose.model("SlackAudit", SlackAuditSchema);
