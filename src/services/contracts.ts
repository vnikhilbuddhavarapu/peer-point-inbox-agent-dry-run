import { z } from "zod";

export const MAX_MAIL_TEXT_LENGTH = 20_000;
export const MAX_MESSAGE_ID_LENGTH = 500;
export const MAX_REFERENCES = 20;

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{2,31}$/u);

export const mailPayloadSchema = z
  .object({
    from: z.string().email().max(254),
    to: z.string().email().max(254),
    subject: z.string().max(200),
    text: z.string().max(MAX_MAIL_TEXT_LENGTH),
    messageId: z.string().min(3).max(MAX_MESSAGE_ID_LENGTH),
    inReplyTo: z.string().max(MAX_MESSAGE_ID_LENGTH).nullable(),
    references: z.array(z.string().max(MAX_MESSAGE_ID_LENGTH)).max(MAX_REFERENCES),
    hopCount: z.number().int().min(0).max(3),
    receivedAt: z.string().datetime(),
  })
  .strict();
export type MailPayload = z.infer<typeof mailPayloadSchema>;

export const signatureTimestampSchema = z.string().regex(/^\d{1,16}$/u);
export const signatureSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const signedMailPayloadSchema = z
  .object({
    payload: mailPayloadSchema,
    timestamp: signatureTimestampSchema,
    signature: signatureSchema,
  })
  .strict();
export type SignedMailPayload = z.infer<typeof signedMailPayloadSchema>;

export const outboundRequestSchema = z
  .object({
    fromHandle: handleSchema,
    to: z.string().email().max(254),
    subject: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(MAX_MAIL_TEXT_LENGTH),
    messageId: z.string().min(3).max(MAX_MESSAGE_ID_LENGTH),
    inReplyTo: z.string().max(MAX_MESSAGE_ID_LENGTH).nullable().default(null),
    references: z.array(z.string().max(MAX_MESSAGE_ID_LENGTH)).max(MAX_REFERENCES).default([]),
    hopCount: z.number().int().min(0).max(2).default(0),
  })
  .strict();
export type OutboundRequest = z.infer<typeof outboundRequestSchema>;

export const deliveryStatusSchema = z.enum([
  "delivered",
  "duplicate",
  "rate-limited",
  "unknown-recipient",
  "external-queued",
  "simulated",
]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const deliveryOutcomeSchema = z
  .object({
    status: deliveryStatusSchema,
  })
  .strict();
export type DeliveryOutcome = z.infer<typeof deliveryOutcomeSchema>;

const routerErrorSchema = z
  .object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(200),
  })
  .strict();

export const outboundResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      outcome: deliveryOutcomeSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      outcome: deliveryOutcomeSchema.optional(),
      error: routerErrorSchema.optional(),
    })
    .strict()
    .refine((response) => response.outcome !== undefined || response.error !== undefined, {
      message: "A rejected response must include an outcome or error",
    }),
]);
export type OutboundResponse = z.infer<typeof outboundResponseSchema>;
