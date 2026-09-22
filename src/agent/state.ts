import { MODEL_IDS, modelIdSchema, type ModelId } from "@peer-point/workshop-config";
import { z } from "zod";

import {
  deliveryOutcomeSchema,
  mailPayloadSchema,
  MAX_MAIL_TEXT_LENGTH,
  MAX_MESSAGE_ID_LENGTH,
  MAX_REFERENCES,
  type DeliveryOutcome,
  type MailPayload,
} from "../services/contracts.js";

export const MESSAGE_LIMIT = 50;
export const FACT_LIMIT = 24;
export const MESSAGE_ID_LIMIT = 100;
export const SUBMISSION_LIMIT = 24;

export const threadMessageSchema = mailPayloadSchema
  .omit({ hopCount: true })
  .extend({ direction: z.enum(["inbound", "outbound"]) })
  .strict();
export type ThreadMessage = z.infer<typeof threadMessageSchema>;

export const threadSchema = z
  .object({
    correspondent: z.string().email().max(254).nullable(),
    subject: z.string().max(200),
    messages: z.array(threadMessageSchema).max(MESSAGE_LIMIT),
    facts: z.array(z.string().trim().min(1).max(500)).max(FACT_LIMIT),
  })
  .strict();
export type CorrespondentThread = z.infer<typeof threadSchema>;

export const draftStatusSchema = z.enum(["pending", "sent", "rejected"]);
export type DraftStatus = z.infer<typeof draftStatusSchema>;

export const draftSchema = z
  .object({
    messageId: z.string().min(3).max(MAX_MESSAGE_ID_LENGTH),
    to: z.string().email().max(254),
    subject: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(MAX_MAIL_TEXT_LENGTH),
    inReplyTo: z.string().max(MAX_MESSAGE_ID_LENGTH).nullable(),
    references: z.array(z.string().max(MAX_MESSAGE_ID_LENGTH)).max(MAX_REFERENCES),
    status: draftStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;

export const draftInputSchema = draftSchema.omit({
  status: true,
  createdAt: true,
  updatedAt: true,
});
export type DraftInput = z.infer<typeof draftInputSchema>;

export const submissionSchema = z
  .object({
    submissionId: z.string().min(1).max(200),
    messageId: z.string().min(3).max(MAX_MESSAGE_ID_LENGTH),
    submittedAt: z.string().datetime(),
  })
  .strict();
export type Submission = z.infer<typeof submissionSchema>;

export const deliveryResultSchema = deliveryOutcomeSchema
  .extend({
    messageId: z.string().min(3).max(MAX_MESSAGE_ID_LENGTH),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type DeliveryResult = z.infer<typeof deliveryResultSchema>;

export const inboxStatusSchema = z.enum([
  "idle",
  "processing",
  "pending",
  "sent",
  "rejected",
  "error",
]);
export type InboxStatus = z.infer<typeof inboxStatusSchema>;

export const pendingApprovalSchema = z
  .object({
    executionId: z.string().min(1).max(200),
    source: z.enum(["action", "codemode"]),
    descriptor: z
      .object({
        action: z.string().min(1).max(80),
        summary: z.string().min(1).max(500),
        risk: z.enum(["low", "medium", "high"]),
        permissions: z.array(z.string().min(1).max(100)).max(12),
        input: draftInputSchema,
      })
      .strict(),
  })
  .strict();
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const inboxAgentStateSchema = z
  .object({
    selectedModel: modelIdSchema,
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9-]{2,31}$/u),
    status: inboxStatusSchema,
    thread: threadSchema,
    draft: draftSchema.nullable(),
    pendingApprovals: z.array(pendingApprovalSchema).max(SUBMISSION_LIMIT),
    processedMessageIds: z
      .array(z.string().min(3).max(MAX_MESSAGE_ID_LENGTH))
      .max(MESSAGE_ID_LIMIT),
    submissions: z.array(submissionSchema).max(SUBMISSION_LIMIT),
    delivery: deliveryResultSchema.nullable(),
    turnCount: z.number().int().nonnegative().max(1_000_000),
    lastUpdatedAt: z.string().datetime(),
  })
  .strict();
export type InboxAgentState = z.infer<typeof inboxAgentStateSchema>;
export type InboxState = InboxAgentState;

export function createInitialState(
  handle = "inbox-agent",
  selectedModel: ModelId = MODEL_IDS[5],
): InboxAgentState {
  return inboxAgentStateSchema.parse({
    selectedModel,
    handle,
    status: "idle",
    thread: { correspondent: null, subject: "", messages: [], facts: [] },
    draft: null,
    pendingApprovals: [],
    processedMessageIds: [],
    submissions: [],
    delivery: null,
    turnCount: 0,
    lastUpdatedAt: new Date().toISOString(),
  });
}

function updated(state: InboxAgentState, patch: Partial<InboxAgentState>): InboxAgentState {
  return inboxAgentStateSchema.parse({
    ...state,
    ...patch,
    lastUpdatedAt: new Date().toISOString(),
  });
}

function appendUniqueBounded(values: readonly string[], value: string, limit: number): string[] {
  return [...values.filter((existing) => existing !== value), value].slice(-limit);
}

export function appendInboundMessage(
  state: InboxAgentState,
  untrustedPayload: MailPayload,
): InboxAgentState {
  const payload = mailPayloadSchema.parse(untrustedPayload);
  if (state.processedMessageIds.includes(payload.messageId)) return state;
  if (state.thread.correspondent !== null && state.thread.correspondent !== payload.from) {
    throw new Error("CORRESPONDENT_MISMATCH");
  }

  const message = threadMessageSchema.parse({
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    messageId: payload.messageId,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    receivedAt: payload.receivedAt,
    direction: "inbound",
  });
  return updated(state, {
    thread: {
      ...state.thread,
      correspondent: state.thread.correspondent ?? payload.from,
      subject: state.thread.subject || payload.subject,
      messages: [...state.thread.messages, message].slice(-MESSAGE_LIMIT),
    },
    processedMessageIds: appendUniqueBounded(
      state.processedMessageIds,
      payload.messageId,
      MESSAGE_ID_LIMIT,
    ),
  });
}

export function appendOutboundMessage(
  state: InboxAgentState,
  untrustedMessage: Omit<ThreadMessage, "direction">,
): InboxAgentState {
  const message = threadMessageSchema.parse({ ...untrustedMessage, direction: "outbound" });
  if (state.processedMessageIds.includes(message.messageId)) return state;
  if (state.thread.correspondent !== null && state.thread.correspondent !== message.to) {
    throw new Error("CORRESPONDENT_MISMATCH");
  }
  return updated(state, {
    thread: {
      ...state.thread,
      messages: [...state.thread.messages, message].slice(-MESSAGE_LIMIT),
    },
    processedMessageIds: appendUniqueBounded(
      state.processedMessageIds,
      message.messageId,
      MESSAGE_ID_LIMIT,
    ),
  });
}

export function recordFact(state: InboxAgentState, untrustedFact: string): InboxAgentState {
  const fact = z.string().trim().min(1).max(500).parse(untrustedFact);
  return updated(state, {
    thread: {
      ...state.thread,
      facts: appendUniqueBounded(state.thread.facts, fact, FACT_LIMIT),
    },
  });
}

export function setDraft(state: InboxAgentState, untrustedDraft: DraftInput): InboxAgentState {
  const now = new Date().toISOString();
  const draft = draftSchema.parse({
    ...draftInputSchema.parse(untrustedDraft),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  return updated(state, { draft, status: "pending", delivery: null });
}

export function setDraftStatus(state: InboxAgentState, status: DraftStatus): InboxAgentState {
  if (!state.draft) throw new Error("DRAFT_NOT_FOUND");
  const parsedStatus = draftStatusSchema.parse(status);
  return updated(state, {
    status: parsedStatus,
    draft: {
      ...state.draft,
      status: parsedStatus,
      updatedAt: new Date().toISOString(),
    },
  });
}

export function setInboxStatus(state: InboxAgentState, status: InboxStatus): InboxAgentState {
  return updated(state, { status: inboxStatusSchema.parse(status) });
}

export function setPendingApprovals(
  state: InboxAgentState,
  approvals: readonly PendingApproval[],
): InboxAgentState {
  return updated(state, {
    pendingApprovals: z.array(pendingApprovalSchema).max(SUBMISSION_LIMIT).parse(approvals),
  });
}

export function recordSubmission(
  state: InboxAgentState,
  untrustedSubmission: Submission,
): InboxAgentState {
  const submission = submissionSchema.parse(untrustedSubmission);
  const submissions = [
    ...state.submissions.filter(({ submissionId }) => submissionId !== submission.submissionId),
    submission,
  ].slice(-SUBMISSION_LIMIT);
  return updated(state, { submissions });
}

export function setDeliveryResult(
  state: InboxAgentState,
  messageId: string,
  untrustedOutcome: DeliveryOutcome,
): InboxAgentState {
  const deliveryResult = deliveryResultSchema.parse({
    ...deliveryOutcomeSchema.parse(untrustedOutcome),
    messageId,
    recordedAt: new Date().toISOString(),
  });
  return updated(state, { delivery: deliveryResult });
}
