import { describe, expect, it, vi } from "vitest";

import { MAX_SIGNATURE_SKEW_MS, verifySignature } from "../src/services/signature.js";

const timestamp = "1790085600";
const now = Number(timestamp) * 1_000;
const signature = btoa(String.fromCharCode(...new Uint8Array(64)))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "");
const publicJwk: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "test-x",
  y: "test-y",
};

function subtleMock(verified = true): {
  subtle: SubtleCrypto;
  importKey: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
} {
  const importKey = vi.fn().mockResolvedValue({ type: "public" });
  const verify = vi.fn().mockResolvedValue(verified);
  return {
    subtle: { importKey, verify } as unknown as SubtleCrypto,
    importKey,
    verify,
  };
}

describe("mail webhook signature verification", () => {
  it("verifies timestamp.signature with ECDSA P-256 and SHA-256", async () => {
    const mock = subtleMock();

    await expect(
      verifySignature('{"messageId":"mail-1"}', timestamp, signature, publicJwk, {
        now: () => now,
        subtle: mock.subtle,
      }),
    ).resolves.toBe(true);

    expect(mock.importKey).toHaveBeenCalledWith(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const verifyCall = mock.verify.mock.calls[0];
    expect(verifyCall?.[0]).toEqual({ name: "ECDSA", hash: "SHA-256" });
    expect(new TextDecoder().decode(verifyCall?.[3] as Uint8Array)).toBe(
      `${timestamp}.{"messageId":"mail-1"}`,
    );
  });

  it("honors the verification result without exposing key material", async () => {
    const mock = subtleMock(false);
    await expect(
      verifySignature("body", timestamp, signature, JSON.stringify(publicJwk), {
        now: () => now,
        subtle: mock.subtle,
      }),
    ).resolves.toBe(false);
  });

  it("rejects timestamps more than five minutes old or in the future before crypto", async () => {
    const mock = subtleMock();
    await expect(
      verifySignature("body", timestamp, signature, publicJwk, {
        now: () => now + MAX_SIGNATURE_SKEW_MS + 1,
        subtle: mock.subtle,
      }),
    ).resolves.toBe(false);
    await expect(
      verifySignature("body", timestamp, signature, publicJwk, {
        now: () => now - MAX_SIGNATURE_SKEW_MS - 1,
        subtle: mock.subtle,
      }),
    ).resolves.toBe(false);
    expect(mock.importKey).not.toHaveBeenCalled();
  });

  it("rejects malformed signatures and private keys", async () => {
    const mock = subtleMock();
    await expect(
      verifySignature("body", timestamp, "not+base64url", publicJwk, {
        now: () => now,
        subtle: mock.subtle,
      }),
    ).resolves.toBe(false);
    await expect(
      verifySignature(
        "body",
        timestamp,
        signature,
        { ...publicJwk, d: "private" },
        {
          now: () => now,
          subtle: mock.subtle,
        },
      ),
    ).resolves.toBe(false);
    expect(mock.importKey).not.toHaveBeenCalled();
  });
});
