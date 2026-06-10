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
    repoMonitors: {
      type: [
        {
          owner: String,
          repo: String,
          monitorId: String,
          packages: [String],
          slackChannelId: String,
          severityThreshold: String,
          status: String,
          createdAt: String,
        },
      ],
      default: undefined,
    },
    exaVerdict: { type: Schema.Types.Mixed, default: undefined },
    exaCVE: { type: Schema.Types.Mixed, default: undefined },
    exaNews: { type: [Schema.Types.Mixed], default: undefined },
    budgetAllocations: { type: [Schema.Types.Mixed], default: undefined },
    foodOrder: { type: Schema.Types.Mixed, default: undefined },
    kbDocuments: { type: [Schema.Types.Mixed], default: undefined },
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
    type: { type: String, enum: ["tag"], required: true },
    source: { type: String, enum: ["s3", "notion", "both"], required: true },
    summary: { type: String, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    links: { type: [String], default: [] },
    metadata: {
      type: {
        documents: [{ path: String, source: String, title: String }],
        weight: Number,
      },
      default: undefined,
    },
    indexedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

const KBDocumentSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    domain: { type: String, required: true, index: true },
    sensitivity: { type: String, enum: ["public", "internal", "confidential", "restricted"], required: true },
    tags: { type: [String], default: [], index: true },
    summary: { type: String, default: "" },
    owner: { type: String, default: undefined },
    team: { type: String, default: undefined },
    s3Bucket: { type: String, required: true },
    s3Key: { type: String, required: true },
    contentType: { type: String, default: "text/plain" },
    sizeBytes: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const ExaRunSchema = new Schema(
  {
    runId: { type: String, required: true, unique: true },
    conversationId: { type: String, required: true, index: true },
    messageOrder: { type: Number, required: true },
    useCase: { type: String, enum: ["verification", "research", "cve", "news"], required: true },
    query: { type: String, required: true },
    status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
    result: { type: Schema.Types.Mixed, default: undefined },
    error: { type: String, default: undefined },
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

export const KBDocumentModel =
  mongoose.models.KBDocument ?? mongoose.model("KBDocument", KBDocumentSchema);

export const ExaRunModel =
  mongoose.models.ExaRun ?? mongoose.model("ExaRun", ExaRunSchema);
