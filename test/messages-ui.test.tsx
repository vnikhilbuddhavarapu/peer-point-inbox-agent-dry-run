import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToolCallCard } from "@peer-point/workshop-ui";

import { toDisplayMessages } from "../src/client/lib/messages.js";

describe("Inbox Agent message UI", () => {
  it("strips complete and split think blocks without dropping visible text", () => {
    const messages: UIMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Prefix <THINK>private reasoning" },
          { type: "text", text: "continues</think> Grounded answer" },
          { type: "text", text: "</think>Final sentence" },
          { type: "reasoning", text: "also hidden", state: "done" },
        ],
      },
    ];

    expect(toDisplayMessages(messages)).toEqual([
      {
        id: "message-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Prefix" },
          { type: "text", text: "Grounded answer" },
          { type: "text", text: "Final sentence" },
        ],
      },
    ]);
  });

  it("drops messages containing only leaked reasoning", () => {
    const messages: UIMessage[] = [
      {
        id: "message-2",
        role: "assistant",
        parts: [{ type: "text", text: "<think>private chain of thought</think>" }],
      },
    ];

    expect(toDisplayMessages(messages)).toEqual([]);
  });

  it("projects mail tool details into the shared expandable disclosure UI", () => {
    const messages: UIMessage[] = [
      {
        id: "message-3",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "draftReply",
            toolCallId: "tool-1",
            state: "output-available",
            input: { to: "alex@example.com", subject: "Re: Workshop availability" },
            output: { status: "drafted", messageId: "message-draft-1" },
          },
        ],
      },
    ];

    const toolPart = toDisplayMessages(messages)[0]?.parts[0];
    expect(toolPart).toEqual({
      type: "tool",
      toolName: "draftReply",
      state: "output",
      summary: "Tool completed",
      input: { to: "alex@example.com", subject: "Re: Workshop availability" },
      output: { status: "drafted", messageId: "message-draft-1" },
    });
    if (!toolPart || toolPart.type !== "tool") throw new Error("Expected a projected tool part");

    const html = renderToStaticMarkup(<ToolCallCard part={toolPart} />);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Input");
    expect(html).toContain("Result");
    expect(html).toContain("message-draft-1");
  });

  it("maps tool approval state while leaving authoritative controls to the dashboard", () => {
    const messages: UIMessage[] = [
      {
        id: "message-4",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "sendReply",
            toolCallId: "tool-2",
            state: "approval-requested",
            input: { to: "alex@example.com" },
            approval: { id: "approval-1" },
          },
        ],
      },
    ];

    expect(toDisplayMessages(messages)[0]?.parts[0]).toMatchObject({
      type: "tool",
      toolName: "sendReply",
      state: "approval",
    });
  });

  it("keeps user text visible", () => {
    const messages: UIMessage[] = [
      {
        id: "message-5",
        role: "user",
        parts: [{ type: "text", text: "Draft a response but do not send it" }],
      },
    ];

    expect(toDisplayMessages(messages)[0]?.parts).toEqual([
      { type: "text", text: "Draft a response but do not send it" },
    ]);
  });
});
