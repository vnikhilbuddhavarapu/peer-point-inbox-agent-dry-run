import { z } from "zod";

import {
  outboundRequestSchema,
  outboundResponseSchema,
  type DeliveryOutcome,
  type OutboundRequest,
} from "./contracts.js";

export const MAIL_ROUTER_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 24_000;

const httpsUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  }, "Mail router URL must be an HTTPS URL without credentials");

const capabilitySchema = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u);

export interface MailRouterOptions {
  baseUrl: string;
  capability: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export type MailRouterErrorCode =
  "INVALID_INPUT" | "INVALID_CONFIG" | "UNAVAILABLE" | "MALFORMED_RESPONSE" | "REMOTE_REJECTED";

export interface MailRouterError {
  code: MailRouterErrorCode;
  message: string;
  status?: number;
  remoteCode?: string;
}

export type MailRouterResult =
  | { ok: true; data: DeliveryOutcome }
  | { ok: false; error: MailRouterError; data?: DeliveryOutcome };

function failure(code: MailRouterErrorCode, message: string): MailRouterResult {
  return { ok: false, error: { code, message } };
}

export async function sendOutboundMail(
  untrustedInput: unknown,
  options: MailRouterOptions,
): Promise<MailRouterResult> {
  const input = outboundRequestSchema.safeParse(untrustedInput);
  if (!input.success) return failure("INVALID_INPUT", "Outbound mail input is invalid");

  const baseUrl = httpsUrlSchema.safeParse(options.baseUrl);
  const capability = capabilitySchema.safeParse(options.capability);
  const timeoutMs = z
    .number()
    .int()
    .min(1)
    .max(30_000)
    .safeParse(options.timeoutMs ?? MAIL_ROUTER_TIMEOUT_MS);
  if (!baseUrl.success || !capability.success || !timeoutMs.success) {
    return failure("INVALID_CONFIG", "Mail router configuration is invalid");
  }

  const url = new URL("/v1/outbound", baseUrl.data);
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${capability.data}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.data),
      signal: AbortSignal.timeout(timeoutMs.data),
    });
  } catch {
    return failure("UNAVAILABLE", "Mail router is unavailable");
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return failure("UNAVAILABLE", "Mail router response could not be read");
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    return failure("MALFORMED_RESPONSE", "Mail router returned an invalid response");
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return failure("MALFORMED_RESPONSE", "Mail router returned an invalid response");
  }
  const parsed = outboundResponseSchema.safeParse(body);
  if (!parsed.success) {
    return failure("MALFORMED_RESPONSE", "Mail router returned an invalid response");
  }

  if (!response.ok || !parsed.data.ok) {
    return {
      ok: false,
      error: {
        code: "REMOTE_REJECTED",
        message: "Mail router rejected outbound delivery",
        status: response.status,
        ...(!parsed.data.ok && parsed.data.error
          ? { remoteCode: parsed.data.error.code }
          : undefined),
      },
      ...(!parsed.data.ok && parsed.data.outcome ? { data: parsed.data.outcome } : undefined),
    };
  }

  return { ok: true, data: parsed.data.outcome };
}

export async function sendMail(
  input: OutboundRequest,
  options: MailRouterOptions,
): Promise<MailRouterResult> {
  return sendOutboundMail(input, options);
}
