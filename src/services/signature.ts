import { z } from "zod";

import { signatureSchema, signatureTimestampSchema } from "./contracts.js";

export const MAX_SIGNATURE_SKEW_MS = 5 * 60 * 1_000;

const publicJwkSchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(1).max(128),
    y: z.string().min(1).max(128),
    key_ops: z.array(z.string().max(20)).max(4).optional(),
    ext: z.boolean().optional(),
    alg: z.string().max(40).optional(),
    use: z.string().max(20).optional(),
    kid: z.string().max(200).optional(),
  })
  .strict();

export interface SignatureVerificationOptions {
  now?: () => number;
  subtle?: SubtleCrypto;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!signatureSchema.safeParse(value).success) return null;
  const remainder = value.length % 4;
  if (remainder === 1) return null;
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - remainder) % 4);
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function parsePublicJwk(value: string | JsonWebKey): JsonWebKey | null {
  let untrusted: unknown = value;
  if (typeof value === "string") {
    if (value.length > 4_096) return null;
    try {
      untrusted = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = publicJwkSchema.safeParse(untrusted);
  return parsed.success ? (parsed.data as JsonWebKey) : null;
}

export async function verifySignature(
  body: string,
  timestamp: string,
  signature: string,
  publicJwk: string | JsonWebKey,
  options: SignatureVerificationOptions = {},
): Promise<boolean> {
  const parsedTimestamp = signatureTimestampSchema.safeParse(timestamp);
  if (!parsedTimestamp.success) return false;

  const timestampSeconds = Number(parsedTimestamp.data);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  const now = options.now?.() ?? Date.now();
  if (!Number.isFinite(now) || Math.abs(now - timestampSeconds * 1_000) > MAX_SIGNATURE_SKEW_MS) {
    return false;
  }

  const signatureBytes = decodeBase64Url(signature);
  const jwk = parsePublicJwk(publicJwk);
  if (!signatureBytes || signatureBytes.byteLength !== 64 || !jwk) return false;

  try {
    const subtle = options.subtle ?? crypto.subtle;
    const key = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
    return await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Uint8Array.from(signatureBytes).buffer,
      new TextEncoder().encode(`${timestamp}.${body}`),
    );
  } catch {
    return false;
  }
}

export const verifyMailSignature = verifySignature;

export async function verifyPayload(
  publicJwk: string | JsonWebKey,
  timestamp: string,
  body: string,
  signature: string,
  options: SignatureVerificationOptions = {},
): Promise<boolean> {
  return verifySignature(body, timestamp, signature, publicJwk, options);
}
