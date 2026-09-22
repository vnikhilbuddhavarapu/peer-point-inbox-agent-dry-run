import { describe, expect, it } from "vitest";

import {
  FACT_LIMIT,
  MESSAGE_ID_LIMIT,
  SUBMISSION_LIMIT,
  appendInboundMessage,
  createInitialState,
  inboxAgentStateSchema,
  recordFact,
  recordSubmission,
  setDeliveryResult,
  setDraft,
  setDraftStatus,
} from "../src/agent/state.js";

function inbound(index = 0) {
  return {
    from: "correspondent@example.com",
    to: "inbox-agent@example.net",
    subject: "Quarterly launch",
    text: `Message ${String(index)}`,
    messageId: `<mail-${String(index).padStart(3, "0")}@example.com>`,
    inReplyTo: index === 0 ? null : `<mail-${String(index - 1).padStart(3, "0")}@example.com>`,
    references: [],
    hopCount: 0,
    receivedAt: new Date(Date.parse("2026-09-22T14:00:00.000Z") + index * 1_000).toISOString(),
  };
}

describe("inbox Agent state", () => {
  it("creates a strict empty state for one correspondent thread", () => {
    expect(inboxAgentStateSchema.parse(createInitialState())).toMatchObject({
      handle: "inbox-agent",
      status: "idle",
      thread: { correspondent: null, subject: "", messages: [], facts: [] },
      draft: null,
      pendingApprovals: [],
      processedMessageIds: [],
      submissions: [],
      delivery: null,
    });
    expect(
      inboxAgentStateSchema.safeParse({ ...createInitialState(), capability: "secret" }).success,
    ).toBe(false);
  });

  it("stores inbound messages idempotently and isolates the base correspondent", () => {
    const once = appendInboundMessage(createInitialState(), inbound());
    const duplicate = appendInboundMessage(once, inbound());

    expect(duplicate).toBe(once);
    expect(once.thread.correspondent).toBe("correspondent@example.com");
    expect(once.thread.messages).toHaveLength(1);
    expect(once.processedMessageIds).toEqual([inbound().messageId]);
    expect(() =>
      appendInboundMessage(once, { ...inbound(1), from: "different@example.com" }),
    ).toThrow("CORRESPONDENT_MISMATCH");
  });

  it("bounds idempotency IDs independently of retained messages", () => {
    let state = createInitialState();
    for (let index = 0; index < MESSAGE_ID_LIMIT + 2; index += 1) {
      state = appendInboundMessage(state, inbound(index));
    }

    expect(state.processedMessageIds).toHaveLength(MESSAGE_ID_LIMIT);
    expect(state.processedMessageIds[0]).toBe(inbound(2).messageId);
    expect(state.thread.messages.length).toBeLessThanOrEqual(50);
  });

  it("deduplicates and bounds established facts", () => {
    let state = createInitialState();
    for (let index = 0; index < FACT_LIMIT + 2; index += 1) {
      state = recordFact(state, `Launch fact ${String(index)}`);
    }
    state = recordFact(state, "Launch fact 2");

    expect(state.thread.facts).toHaveLength(FACT_LIMIT);
    expect(state.thread.facts.at(-1)).toBe("Launch fact 2");
    expect(() => recordFact(state, "x".repeat(501))).toThrow();
  });

  it("tracks a pending draft through sent or rejected status and delivery", () => {
    const pending = setDraft(createInitialState(), {
      messageId: "<reply-001@example.net>",
      to: "correspondent@example.com",
      subject: "Re: Quarterly launch",
      text: "Here is the requested draft.",
      inReplyTo: "<mail-001@example.com>",
      references: ["<mail-001@example.com>"],
    });
    expect(pending.draft?.status).toBe("pending");

    const sent = setDraftStatus(pending, "sent");
    const delivered = setDeliveryResult(sent, "<reply-001@example.net>", {
      status: "external-queued",
    });
    expect(delivered.draft?.status).toBe("sent");
    expect(delivered.delivery).toMatchObject({
      messageId: "<reply-001@example.net>",
      status: "external-queued",
    });
    expect(setDraftStatus(pending, "rejected").draft?.status).toBe("rejected");
  });

  it("keeps bounded idempotent submission records", () => {
    let state = createInitialState();
    for (let index = 0; index < SUBMISSION_LIMIT + 2; index += 1) {
      state = recordSubmission(state, {
        submissionId: `submission-${String(index)}`,
        messageId: inbound(index).messageId,
        submittedAt: inbound(index).receivedAt,
      });
    }
    state = recordSubmission(state, {
      submissionId: "submission-2",
      messageId: inbound(2).messageId,
      submittedAt: inbound(2).receivedAt,
    });

    expect(state.submissions).toHaveLength(SUBMISSION_LIMIT);
    expect(state.submissions.at(-1)?.submissionId).toBe("submission-2");
  });
});
