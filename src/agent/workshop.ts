import type { InboxAgentState } from "./state.js";

export type WorkshopTaskName =
  "clarification-strategy" | "established-facts" | "durable-pause-policy";

export type WorkshopTaskError = {
  code: "NOT_IMPLEMENTED";
  task: WorkshopTaskName;
  message: string;
};

export type WorkshopTaskResult<T> =
  { ok: true; value: T } | { ok: false; error: WorkshopTaskError };

export function workshopTaskIncomplete(
  task: WorkshopTaskName,
  message: string,
): WorkshopTaskResult<never> {
  return { ok: false, error: { code: "NOT_IMPLEMENTED", task, message } };
}

export type EstablishedFactResult = {
  state: InboxAgentState;
  result: WorkshopTaskResult<{ fact: string }>;
};

export function saveEstablishedFact(state: InboxAgentState, fact: string): EstablishedFactResult {
  // WORKSHOP TASK: persist only facts established by the correspondent and return the updated state.
  void fact;
  return {
    state,
    result: workshopTaskIncomplete(
      "established-facts",
      "Established-fact persistence has not been implemented.",
    ),
  };
}

export type ConfiguredSendReplyPolicy = {
  kind: "durable-pause";
  approval: true;
  approvalSummary: string;
  approvalRisk: "high";
};

export type ResolvedSendReplyPolicy = ConfiguredSendReplyPolicy & {
  enabled: boolean;
};

export function configureSendReplyPolicy(): WorkshopTaskResult<ConfiguredSendReplyPolicy> {
  // WORKSHOP TASK: return a durable-pause policy that requires approval for every email send.
  return workshopTaskIncomplete(
    "durable-pause-policy",
    "The durable send policy has not been implemented.",
  );
}

export function resolveSendReplyPolicy(): ResolvedSendReplyPolicy {
  const configured = configureSendReplyPolicy();
  if (configured.ok) return { enabled: true, ...configured.value };

  return {
    enabled: false,
    kind: "durable-pause",
    approval: true,
    approvalSummary: "Workshop send is disabled",
    approvalRisk: "high",
  };
}
