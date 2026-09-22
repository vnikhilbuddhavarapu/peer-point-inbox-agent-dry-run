import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InboxDashboard } from "../src/client/components/inbox-dashboard.js";

describe("InboxDashboard", () => {
  it("renders the thread, facts, draft, authoritative approval, and delivery state", () => {
    const html = renderToStaticMarkup(
      <InboxDashboard
        state={
          {
            handle: "mtl-agent-07",
            status: "awaiting-approval",
            thread: {
              correspondent: "alex@example.com",
              subject: "Re: Workshop availability",
              messages: [
                {
                  messageId: "message-inbound-1",
                  direction: "inbound",
                  from: "alex@example.com",
                  text: "Can we meet next Tuesday?",
                  receivedAt: "2026-09-22T14:05:00.000Z",
                },
                {
                  messageId: "message-outbound-1",
                  direction: "outbound",
                  from: "mtl-agent-07@cf.prompt2prod.dev",
                  text: "Which time zone should I use?",
                  sentAt: "2026-09-22T14:06:00.000Z",
                },
              ],
              facts: ["The meeting should be next Tuesday", "Alex is the correspondent"],
            },
            draft: {
              to: "alex@example.com",
              subject: "Re: Workshop availability",
              text: "Tuesday at 10:00 ET works for the team.",
            },
            pendingApprovals: [
              {
                executionId: "execution-send-1",
                source: "action",
                descriptor: {
                  action: "sendReply",
                  summary: "Send the drafted reply to Alex",
                  input: {
                    to: "alex@example.com",
                    text: "Tuesday at 10:00 ET works for the team.",
                  },
                  permissions: ["mail:send"],
                  risk: "high",
                  kind: "durable-pause",
                },
              },
            ],
            delivery: {
              status: "pending",
              detail: "Waiting for human approval",
              messageId: "message-outbound-2",
            },
          } as never
        }
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("mtl-agent-07");
    expect(html).toContain("Re: Workshop availability");
    expect(html.indexOf("Can we meet next Tuesday?")).toBeLessThan(
      html.indexOf("Which time zone should I use?"),
    );
    expect(html).toContain("The meeting should be next Tuesday");
    expect(html).toContain("Tuesday at 10:00 ET works for the team.");
    expect(html).toContain("Send the drafted reply to Alex");
    expect(html).toContain("mail:send");
    expect(html).toContain("Review action input");
    expect(html).toContain('aria-label="Approve Send the drafted reply to Alex"');
    expect(html).toContain('aria-label="Reject Send the drafted reply to Alex"');
    expect(html).toContain("Waiting for human approval");
    expect(html).toContain('aria-live="polite"');
  });

  it("shows simulator guidance and actionable empty states", () => {
    const html = renderToStaticMarkup(
      <InboxDashboard
        state={
          {
            handle: "mtl-agent-08",
            status: "idle",
            thread: {
              correspondent: null,
              subject: null,
              messages: [],
              facts: [],
            },
            draft: null,
            pendingApprovals: [],
            delivery: null,
          } as never
        }
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("/admin/simulate");
    expect(html).toContain("same signed webhook and approval flow");
    expect(html).toContain("No messages yet");
    expect(html).toContain("No facts established yet");
    expect(html).toContain("No draft yet");
    expect(html).toContain("No action is waiting for approval");
    expect(html).toContain("No outbound delivery has been attempted");
  });

  it("disables only the approval currently being resolved", () => {
    const html = renderToStaticMarkup(
      <InboxDashboard
        approvalBusy="execution-send-1"
        state={
          {
            handle: "mtl-agent-09",
            status: "awaiting-approval",
            thread: {
              correspondent: "alex@example.com",
              subject: "Reply",
              messages: [],
              facts: [],
            },
            draft: null,
            pendingApprovals: [
              {
                executionId: "execution-send-1",
                source: "action",
                descriptor: { action: "sendReply", summary: "Send reply", risk: "medium" },
              },
            ],
            delivery: null,
          } as never
        }
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain("Working…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
