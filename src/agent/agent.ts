import { modelIdSchema, type ModelId } from "@peer-point/workshop-config";
import {
  Think,
  action,
  type ChatResponseResult,
  type PendingApproval as ThinkPendingApproval,
  type TurnConfig,
  type TurnContext,
} from "@cloudflare/think";
import { callable } from "agents";
import type { ContextConfig } from "agents/context";
import { tool, type LanguageModel, type UIMessage } from "ai";
import { z } from "zod";

import { createContextBlocks } from "./context.js";
import { createInboxModel } from "./model.js";
import {
  appendInboundMessage,
  appendOutboundMessage,
  createInitialState,
  draftInputSchema,
  inboxAgentStateSchema,
  recordSubmission,
  setDeliveryResult,
  setDraft,
  setDraftStatus,
  setInboxStatus,
  setPendingApprovals,
  type DraftInput,
  type InboxAgentState,
  type PendingApproval,
} from "./state.js";
import { resolveSendReplyPolicy, saveEstablishedFact, workshopTaskIncomplete } from "./workshop.js";
import { outboundRequestSchema, type MailPayload } from "../services/contracts.js";
import { sendOutboundMail } from "../services/mail-router.js";
import { logError, logInfo } from "../shared/logger.js";

const ACTIVE_TOOLS = ["saveFact", "saveDraft", "sendReply", "set_context"];

function sameDraft(left: DraftInput, right: DraftInput): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class InboxAgent extends Think<Env, InboxAgentState> {
  override initialState = createInitialState("mtl-agent");
  override maxSteps = 5;
  override includeMcpTools = false;
  override workspaceBash = false;
  override sendReasoning = false;
  override storeMessages = false;
  override storeTools = false;

  override getModel(): LanguageModel {
    return createInboxModel(this.env, this.state.selectedModel);
  }

  override configureContext(): ContextConfig[] {
    return createContextBlocks();
  }

  override getTools() {
    return {
      saveFact: tool({
        description: "Persist one established fact from the correspondent's email.",
        inputSchema: z.object({ fact: z.string().trim().min(1).max(500) }).strict(),
        execute: ({ fact }) => {
          const outcome = saveEstablishedFact(this.state, fact);
          if (outcome.result.ok) this.setState(outcome.state);
          return outcome.result;
        },
      }),
      saveDraft: tool({
        description:
          "Persist the exact clarification or final reply draft before requesting send approval.",
        inputSchema: draftInputSchema,
        execute: (draft) => {
          this.setState(setDraft(this.state, draft));
          return { ok: true as const, draft };
        },
      }),
    };
  }

  override getActions() {
    const sendPolicy = resolveSendReplyPolicy();

    return {
      sendReply: action({
        description: "Send the current email draft only after durable human approval.",
        inputSchema: draftInputSchema,
        kind: sendPolicy.kind,
        approval: sendPolicy.approval,
        approvalSummary: sendPolicy.approvalSummary,
        approvalRisk: sendPolicy.approvalRisk,
        idempotencyKey: ({ input }) => `email:${input.messageId}`,
        execute: async (input) => {
          if (!sendPolicy.enabled) {
            return workshopTaskIncomplete(
              "durable-pause-policy",
              "Outbound delivery remains disabled until the durable send policy is implemented.",
            );
          }

          const draft = draftInputSchema.parse(input);
          const current = this.state.draft;
          const currentInput = current
            ? draftInputSchema.parse({
                messageId: current.messageId,
                to: current.to,
                subject: current.subject,
                text: current.text,
                inReplyTo: current.inReplyTo,
                references: current.references,
              })
            : null;
          if (!currentInput || !sameDraft(draft, currentInput)) {
            throw new Error("DRAFT_CHANGED_AFTER_APPROVAL_REQUEST");
          }

          const request = outboundRequestSchema.parse({
            fromHandle: this.state.handle,
            ...draft,
            hopCount: 0,
          });
          const result =
            this.env.MAIL_ROUTER_CAPABILITY === "simulator-only"
              ? { ok: true as const, data: { status: "simulated" as const } }
              : await sendOutboundMail(request, {
                  baseUrl: this.env.MAIL_ROUTER_URL,
                  capability: this.env.MAIL_ROUTER_CAPABILITY,
                });
          if (!result.ok) throw new Error(`MAIL_ROUTER_${result.error.code}`);

          const now = new Date().toISOString();
          this.setState(
            setDraftStatus(
              setDeliveryResult(
                appendOutboundMessage(this.state, {
                  from: `${this.state.handle}@${this.env.INBOUND_DOMAIN}`,
                  to: draft.to,
                  subject: draft.subject,
                  text: draft.text,
                  messageId: draft.messageId,
                  inReplyTo: draft.inReplyTo,
                  references: draft.references,
                  receivedAt: now,
                }),
                draft.messageId,
                result.data,
              ),
              "sent",
            ),
          );
          return { ok: true as const, outcome: result.data };
        },
      }),
    };
  }

  override validateStateChange(nextState: InboxAgentState): void {
    inboxAgentStateSchema.parse(nextState);
  }

  @callable()
  selectModel(modelId: ModelId): ModelId {
    const selectedModel = modelIdSchema.parse(modelId);
    this.setState(
      inboxAgentStateSchema.parse({
        ...this.state,
        selectedModel,
        lastUpdatedAt: new Date().toISOString(),
      }),
    );
    return selectedModel;
  }

  async receiveEmail(payload: MailPayload): Promise<{ submissionId: string; accepted: boolean }> {
    const next = appendInboundMessage(this.state, payload);
    if (next === this.state) {
      const existing = this.state.submissions.find((item) => item.messageId === payload.messageId);
      return { submissionId: existing?.submissionId ?? payload.messageId, accepted: false };
    }
    this.setState(setInboxStatus(next, "processing"));
    const message: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        {
          type: "text",
          text: `Inbound email\nFrom: ${payload.from}\nSubject: ${payload.subject}\nMessage-ID: ${payload.messageId}\nIn-Reply-To: ${payload.inReplyTo ?? "none"}\n\n${payload.text}`,
        },
      ],
    };
    const submission = await this.submitMessages([message], {
      idempotencyKey: payload.messageId,
      metadata: { channel: "email", messageId: payload.messageId },
    });
    this.setState(
      recordSubmission(this.state, {
        submissionId: submission.submissionId,
        messageId: payload.messageId,
        submittedAt: new Date().toISOString(),
      }),
    );
    return { submissionId: submission.submissionId, accepted: submission.accepted };
  }

  @callable()
  async refreshApprovals(): Promise<PendingApproval[]> {
    const approvals = (await this.pendingApprovals()).map((approval) =>
      pendingApprovalFromThink(approval),
    );
    this.setState(setPendingApprovals(this.state, approvals));
    return approvals;
  }

  @callable()
  async approveSend(executionId: string): Promise<unknown> {
    const result = await this.approveExecution(executionId);
    await this.refreshApprovals();
    return result;
  }

  @callable()
  async rejectSend(executionId: string): Promise<unknown> {
    const result = await this.rejectExecution(executionId, "Rejected in Inbox Agent dashboard");
    if (this.state.draft) this.setState(setDraftStatus(this.state, "rejected"));
    await this.refreshApprovals();
    return result;
  }

  @callable()
  async resetInbox(): Promise<InboxAgentState> {
    this.resetTurnState();
    for (const approval of await this.pendingApprovals()) {
      await this.rejectExecution(approval.executionId, "Inbox reset");
    }
    this.resetTurnState();
    await this.clearMessages();
    const next = createInitialState(this.state.handle, this.state.selectedModel);
    this.setState(next);
    return next;
  }

  @callable()
  getDashboardState(): InboxAgentState {
    return inboxAgentStateSchema.parse(this.state);
  }

  override beforeTurn(ctx: TurnContext): TurnConfig {
    const selectedModel =
      ctx.body?.modelId === undefined
        ? this.state.selectedModel
        : modelIdSchema.parse(ctx.body.modelId);
    this.setState(
      inboxAgentStateSchema.parse({
        ...setInboxStatus(this.state, "processing"),
        selectedModel,
      }),
    );
    return {
      model: createInboxModel(this.env, selectedModel),
      activeTools: ACTIVE_TOOLS,
      maxOutputTokens: 500,
      maxSteps: this.maxSteps,
      sendReasoning: false,
    };
  }

  override async onChatResponse(result: ChatResponseResult): Promise<void> {
    const approvals = (await this.pendingApprovals()).map((approval) =>
      pendingApprovalFromThink(approval),
    );
    this.setState(
      inboxAgentStateSchema.parse({
        ...setPendingApprovals(
          setInboxStatus(this.state, approvals.length > 0 ? "pending" : this.state.status),
          approvals,
        ),
        turnCount: this.state.turnCount + 1,
      }),
    );
    logInfo({
      event: "agent_turn",
      operation: "chat-response",
      outcome: result.status === "completed" ? "success" : "failure",
      modelId: this.state.selectedModel,
    });
  }

  override onChatError(error: unknown): unknown {
    this.setState(setInboxStatus(this.state, "error"));
    logError({
      event: "agent_turn",
      operation: "chat-error",
      outcome: "failure",
      errorCode: "CHAT_FAILED",
    });
    return error;
  }
}

function pendingApprovalFromThink(approval: ThinkPendingApproval): PendingApproval {
  return {
    executionId: approval.executionId,
    source: approval.source,
    descriptor: {
      action: approval.descriptor.action,
      summary: approval.descriptor.summary,
      risk: approval.descriptor.risk ?? "high",
      permissions: approval.descriptor.permissions,
      input: draftInputSchema.parse(approval.descriptor.input),
    },
  };
}
