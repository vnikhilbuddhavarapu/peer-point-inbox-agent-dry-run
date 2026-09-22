import { describe, expect, it } from "vitest";

import {
  mailPayloadSchema,
  outboundRequestSchema,
  outboundResponseSchema,
  signedMailPayloadSchema,
} from "../src/services/contracts.js";

const payload = {
  from: "correspondent@example.com",
  to: "inbox@example.net",
  subject: "Quarterly launch",
  text: "Can you help prepare the launch note?",
  messageId: "<mail-001@example.com>",
  inReplyTo: null,
  references: [],
  hopCount: 0,
  receivedAt: "2026-09-22T14:00:00.000Z",
};

describe("inbox mail contracts", () => {
  it("accepts the central router payload and signed envelope", () => {
    expect(mailPayloadSchema.parse(payload)).toEqual(payload);
    expect(
      signedMailPayloadSchema.parse({
        payload,
        timestamp: "1790085600",
        signature: "signature_-value",
      }),
    ).toMatchObject({ payload });
  });

  it("strictly rejects unknown fields and bounded payload violations", () => {
    expect(mailPayloadSchema.safeParse({ ...payload, secret: "not-allowed" }).success).toBe(false);
    expect(mailPayloadSchema.safeParse({ ...payload, hopCount: 4 }).success).toBe(false);
    expect(mailPayloadSchema.safeParse({ ...payload, text: "x".repeat(20_001) }).success).toBe(
      false,
    );
    expect(
      mailPayloadSchema.safeParse({
        ...payload,
        references: Array.from({ length: 21 }, (_, index) => `<${String(index)}@example.com>`),
      }).success,
    ).toBe(false);
  });

  it("normalizes and defaults the outbound router contract", () => {
    expect(
      outboundRequestSchema.parse({
        fromHandle: "Inbox-Agent",
        to: "correspondent@example.com",
        subject: " Re: Quarterly launch ",
        text: " Here is the draft. ",
        messageId: "<reply-001@example.net>",
      }),
    ).toEqual({
      fromHandle: "inbox-agent",
      to: "correspondent@example.com",
      subject: "Re: Quarterly launch",
      text: "Here is the draft.",
      messageId: "<reply-001@example.net>",
      inReplyTo: null,
      references: [],
      hopCount: 0,
    });
  });

  it("accepts only bounded router response shapes", () => {
    expect(
      outboundResponseSchema.parse({ ok: true, outcome: { status: "external-queued" } }),
    ).toEqual({ ok: true, outcome: { status: "external-queued" } });
    expect(outboundResponseSchema.safeParse({ ok: false }).success).toBe(false);
    expect(
      outboundResponseSchema.safeParse({
        ok: true,
        outcome: { status: "delivered", capability: "leak" },
      }).success,
    ).toBe(false);
  });
});
