import { describe, expect, it, vi } from "vitest";

import { sendOutboundMail } from "../src/services/mail-router.js";

const capability = "capability_abcdefghijklmnopqrstuvwxyz";
const input = {
  fromHandle: "inbox-agent",
  to: "correspondent@example.com",
  subject: "Re: Quarterly launch",
  text: "Here is the requested draft.",
  messageId: "<reply-001@example.net>",
  inReplyTo: "<mail-001@example.com>",
  references: ["<mail-001@example.com>"],
  hopCount: 0,
};

describe("mail router client", () => {
  it("posts the validated contract to /v1/outbound with the capability bearer", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true, outcome: { status: "external-queued" } }));

    await expect(
      sendOutboundMail(input, {
        baseUrl: "https://mail-router.example.workers.dev/base",
        capability,
        fetch: fetchMock,
      }),
    ).resolves.toEqual({ ok: true, data: { status: "external-queued" } });

    const [requestUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBeInstanceOf(URL);
    expect((requestUrl as URL).href).toBe("https://mail-router.example.workers.dev/v1/outbound");
    expect(init).toMatchObject({ method: "POST" });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${capability}`);
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toEqual(input);
  });

  it("returns typed failures for invalid input without making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      sendOutboundMail(
        { ...input, text: "", unexpected: capability },
        { baseUrl: "https://mail-router.example", capability, fetch: fetchMock },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves bounded rejection metadata without returning the capability", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          ok: false,
          error: { code: "EXTERNAL_DISABLED", message: "External delivery is not ready" },
        },
        { status: 409 },
      ),
    );

    const result = await sendOutboundMail(input, {
      baseUrl: "https://mail-router.example",
      capability,
      fetch: fetchMock,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "REMOTE_REJECTED",
        message: "Mail router rejected outbound delivery",
        status: 409,
        remoteCode: "EXTERNAL_DISABLED",
      },
    });
    expect(JSON.stringify(result)).not.toContain(capability);
  });

  it("rejects malformed responses and reports network failures safely", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network failed"));

    await expect(
      sendOutboundMail(input, {
        baseUrl: "https://mail-router.example",
        capability,
        fetch: malformed,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "MALFORMED_RESPONSE" } });
    await expect(
      sendOutboundMail(input, {
        baseUrl: "https://mail-router.example",
        capability,
        fetch: unavailable,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
  });
});
