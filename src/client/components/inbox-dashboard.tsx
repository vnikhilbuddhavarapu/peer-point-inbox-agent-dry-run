import type { InboxState } from "../../agent/state.js";

interface InboxDashboardProps {
  state: InboxState;
  approvalBusy?: string;
  onApprove: (executionId: string) => void;
  onReject: (executionId: string) => void;
}

type UnknownRecord = Record<string, unknown>;

const DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
});

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function asItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstValue(record: UnknownRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function textValue(record: UnknownRecord, keys: readonly string[], fallback = ""): string {
  const value = firstValue(record, keys);
  return typeof value === "string" && value.trim() ? value : fallback;
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function displayLabel(value: string): string {
  return value.replaceAll(/[-_]/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (["sent", "delivered", "duplicate", "complete", "completed", "success"].includes(normalized)) {
    return "success";
  }
  if (["failed", "error", "rejected", "rate-limited", "unknown-recipient"].includes(normalized)) {
    return "error";
  }
  if (
    [
      "pending",
      "drafting",
      "processing",
      "sending",
      "external-queued",
      "awaiting-approval",
    ].includes(normalized)
  ) {
    return "active";
  }
  return "neutral";
}

function formatTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : `${DATE_FORMATTER.format(timestamp)} UTC`;
}

function boundedJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2) ?? "Not specified";
    return serialized.length > 4_000
      ? `${serialized.slice(0, 4_000)}\n… details truncated`
      : serialized;
  } catch {
    return "Details unavailable";
  }
}

function factEntries(value: unknown): Array<{ label: string; value: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (typeof item === "string" && item.trim()) {
        return [{ label: `Fact ${String(index + 1)}`, value: item }];
      }
      const fact = asRecord(item);
      const displayed = displayValue(firstValue(fact, ["value", "detail", "fact", "text"]));
      if (!displayed) return [];
      return [
        {
          label: textValue(fact, ["label", "name", "key", "title"], `Fact ${String(index + 1)}`),
          value: displayed,
        },
      ];
    });
  }

  return Object.entries(asRecord(value)).flatMap(([label, item]) => {
    const displayed = displayValue(item);
    return displayed ? [{ label: displayLabel(label), value: displayed }] : [];
  });
}

function ThreadView({ thread }: { thread: InboxState["thread"] }) {
  const model = asRecord(thread);
  const messages = asItems(model.messages);
  const subject = textValue(model, ["subject"], "No subject");
  const correspondent = textValue(model, ["correspondent"], "No correspondent yet");

  return (
    <section className="inbox-panel inbox-thread" aria-labelledby="inbox-thread-title">
      <header className="inbox-panel__header">
        <div>
          <p>Conversation</p>
          <h2 id="inbox-thread-title">Thread</h2>
        </div>
        <span aria-label={`${String(messages.length)} messages`}>{messages.length}</span>
      </header>
      <div className="inbox-thread__summary">
        <div>
          <span>Correspondent</span>
          <strong>{correspondent}</strong>
        </div>
        <div>
          <span>Subject</span>
          <strong>{subject}</strong>
        </div>
      </div>
      {messages.length === 0 ? (
        <p className="inbox-empty">
          No messages yet. Send a signed message through the simulator to begin.
        </p>
      ) : (
        <ol className="inbox-messages" aria-label="Email thread in chronological order">
          {messages.map((item, index) => {
            const message = asRecord(item);
            const direction = textValue(
              message,
              ["direction", "role", "type"],
              "inbound",
            ).toLowerCase();
            const outbound = ["outbound", "assistant", "sent", "agent"].includes(direction);
            const sender = textValue(
              message,
              ["from", "sender", "author"],
              outbound ? "Inbox Agent" : correspondent,
            );
            const body = textValue(
              message,
              ["text", "body", "content"],
              "Message body unavailable",
            );
            const rawTimestamp = firstValue(message, [
              "receivedAt",
              "sentAt",
              "createdAt",
              "timestamp",
            ]);
            const timestamp = formatTimestamp(rawTimestamp);
            const id = textValue(message, ["messageId", "id"], `message-${String(index + 1)}`);

            return (
              <li
                className={`inbox-message inbox-message--${outbound ? "outbound" : "inbound"}`}
                key={`${id}-${String(index)}`}
              >
                <article aria-label={`${outbound ? "Outbound" : "Inbound"} message from ${sender}`}>
                  <header>
                    <strong>{sender}</strong>
                    <span>{outbound ? "Outbound" : "Inbound"}</span>
                    {timestamp ? (
                      <time dateTime={typeof rawTimestamp === "string" ? rawTimestamp : undefined}>
                        {timestamp}
                      </time>
                    ) : null}
                  </header>
                  <p>{body}</p>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function FactSummary({ facts }: { facts: InboxState["thread"]["facts"] }) {
  const entries = factEntries(facts);

  return (
    <section className="inbox-panel" aria-labelledby="inbox-facts-title">
      <header className="inbox-panel__header">
        <div>
          <p>Durable context</p>
          <h2 id="inbox-facts-title">Established facts</h2>
        </div>
        <span aria-label={`${String(entries.length)} established facts`}>{entries.length}</span>
      </header>
      {entries.length === 0 ? (
        <p className="inbox-empty">
          No facts established yet. The Agent will add confirmed details from the thread.
        </p>
      ) : (
        <dl className="inbox-facts">
          {entries.map((fact, index) => (
            <div key={`${fact.label}-${String(index)}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function DraftCard({ draft }: { draft: InboxState["draft"] }) {
  const model = asRecord(draft);
  const body = textValue(model, ["text", "body", "content"]);
  const status = textValue(model, ["status"], body ? "ready" : "empty");

  return (
    <section className="inbox-panel inbox-draft" aria-labelledby="inbox-draft-title">
      <header className="inbox-panel__header">
        <div>
          <p>Proposed response</p>
          <h2 id="inbox-draft-title">Draft reply</h2>
        </div>
        <span>{displayLabel(status)}</span>
      </header>
      {body ? (
        <article>
          <dl>
            <div>
              <dt>To</dt>
              <dd>{textValue(model, ["to"], "Recipient unavailable")}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{textValue(model, ["subject"], "No subject")}</dd>
            </div>
          </dl>
          <p>{body}</p>
        </article>
      ) : (
        <p className="inbox-empty">
          No draft yet. The Agent will draft only after it has enough confirmed context.
        </p>
      )}
    </section>
  );
}

function ApprovalCards({
  approvals,
  busy,
  onApprove,
  onReject,
}: {
  approvals: InboxState["pendingApprovals"];
  busy?: string;
  onApprove: (executionId: string) => void;
  onReject: (executionId: string) => void;
}) {
  const items = asItems(approvals);

  return (
    <section className="inbox-panel inbox-approvals" aria-labelledby="inbox-approvals-title">
      <header className="inbox-panel__header">
        <div>
          <p>Human-in-the-loop</p>
          <h2 id="inbox-approvals-title">Pending approvals</h2>
        </div>
        <span aria-label={`${String(items.length)} pending approvals`}>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="inbox-empty">No action is waiting for approval.</p>
      ) : (
        <ul className="inbox-approval-list">
          {items.map((item, index) => {
            const approval = asRecord(item);
            const descriptor = asRecord(approval.descriptor);
            const executionId = textValue(approval, ["executionId", "id"]);
            const action = textValue(descriptor, ["action", "toolName"], "Action");
            const summary = textValue(descriptor, ["summary", "description"], displayLabel(action));
            const risk = textValue(descriptor, ["risk"], "medium");
            const source = textValue(approval, ["source"], "action");
            const permissions = asItems(descriptor.permissions)
              .map(displayValue)
              .filter((value): value is string => value !== undefined);
            const input = descriptor.input;
            const isBusy = Boolean(executionId) && busy === executionId;

            return (
              <li key={executionId || `approval-${String(index + 1)}`}>
                <article aria-labelledby={`approval-${String(index)}-title`}>
                  <header>
                    <div>
                      <span className={`inbox-risk inbox-risk--${risk.toLowerCase()}`}>
                        {displayLabel(risk)} risk
                      </span>
                      <span>{displayLabel(source)}</span>
                    </div>
                    <h3 id={`approval-${String(index)}-title`}>{summary}</h3>
                    <code>{action}</code>
                  </header>
                  {permissions.length > 0 ? (
                    <p className="inbox-approval__permissions">
                      <strong>Permissions:</strong> {permissions.join(", ")}
                    </p>
                  ) : null}
                  {input === undefined ? null : (
                    <details>
                      <summary>Review action input</summary>
                      <pre>{boundedJson(input)}</pre>
                    </details>
                  )}
                  <div className="inbox-approval__actions">
                    <button
                      type="button"
                      className="inbox-button inbox-button--reject"
                      disabled={!executionId || isBusy}
                      aria-label={`Reject ${summary}`}
                      onClick={() => onReject(executionId)}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="inbox-button inbox-button--approve"
                      disabled={!executionId || isBusy}
                      aria-label={`Approve ${summary}`}
                      onClick={() => onApprove(executionId)}
                    >
                      {isBusy ? "Working…" : "Approve"}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DeliveryStatus({ delivery }: { delivery: InboxState["delivery"] }) {
  const model = asRecord(delivery);
  const rawStatus =
    displayValue(firstValue(model, ["status", "outcome"])) ?? displayValue(delivery) ?? "Not sent";
  const status = displayLabel(rawStatus);
  const detail = textValue(model, ["detail", "message", "error"]);
  const messageId = textValue(model, ["messageId", "id"]);
  const rawTimestamp = firstValue(model, [
    "deliveredAt",
    "sentAt",
    "recordedAt",
    "updatedAt",
    "timestamp",
  ]);
  const timestamp = formatTimestamp(rawTimestamp);

  return (
    <section
      className="inbox-panel inbox-delivery"
      aria-labelledby="inbox-delivery-title"
      aria-live="polite"
    >
      <header className="inbox-panel__header">
        <div>
          <p>Outbound mail</p>
          <h2 id="inbox-delivery-title">Delivery status</h2>
        </div>
        <span className={`inbox-status inbox-status--${statusTone(rawStatus)}`}>{status}</span>
      </header>
      {detail || messageId || timestamp ? (
        <dl>
          {detail ? (
            <div>
              <dt>Detail</dt>
              <dd>{detail}</dd>
            </div>
          ) : null}
          {messageId ? (
            <div>
              <dt>Message ID</dt>
              <dd>{messageId}</dd>
            </div>
          ) : null}
          {timestamp ? (
            <div>
              <dt>Updated</dt>
              <dd>
                <time dateTime={typeof rawTimestamp === "string" ? rawTimestamp : undefined}>
                  {timestamp}
                </time>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="inbox-empty">No outbound delivery has been attempted.</p>
      )}
    </section>
  );
}

export function InboxDashboard({ state, approvalBusy, onApprove, onReject }: InboxDashboardProps) {
  return (
    <div className="inbox-dashboard">
      <section className="inbox-overview" aria-labelledby="inbox-overview-title">
        <header className="inbox-panel__header">
          <div>
            <p>Registered inbox</p>
            <h2 id="inbox-overview-title">{state.handle || "Handle pending"}</h2>
          </div>
          <span className={`inbox-status inbox-status--${statusTone(state.status)}`}>
            {displayLabel(state.status)}
          </span>
        </header>
        <p>
          Send mail to this handle or use the instructor mail router <code>/admin/simulate</code>{" "}
          endpoint. The simulator uses the same signed webhook and approval flow without external
          delivery.
        </p>
      </section>
      <ThreadView thread={state.thread} />
      <FactSummary facts={state.thread.facts} />
      <DraftCard draft={state.draft} />
      <ApprovalCards
        approvals={state.pendingApprovals}
        {...(approvalBusy === undefined ? {} : { busy: approvalBusy })}
        onApprove={onApprove}
        onReject={onReject}
      />
      <DeliveryStatus delivery={state.delivery} />
    </div>
  );
}
