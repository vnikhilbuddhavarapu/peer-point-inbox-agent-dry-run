import { MODEL_DEFINITIONS, MODEL_IDS, type ModelId } from "@peer-point/workshop-config";
import { WorkshopShell, type ConnectionStatus } from "@peer-point/workshop-ui";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { InboxAgent } from "../agent/agent.js";
import { createInitialState, type InboxState } from "../agent/state.js";
import { InboxDashboard } from "./components/inbox-dashboard.js";
import { toDisplayMessages } from "./lib/messages.js";

function connectionStatus(
  readyState: number,
  chatStatus: string,
  hasError: boolean,
): ConnectionStatus {
  if (hasError || chatStatus === "error") return "error";
  if (chatStatus === "submitted") return "thinking";
  if (chatStatus === "streaming") return "streaming";
  if (readyState !== WebSocket.OPEN) return "connecting";
  return "ready";
}

export function App() {
  const [state, setState] = useState<InboxState>(createInitialState("mtl-agent"));
  const [selectedModel, setSelectedModel] = useState<ModelId>(MODEL_IDS[5]);
  const [input, setInput] = useState("");
  const [approvalBusy, setApprovalBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const reconciled = useRef(false);

  const agent = useAgent<InboxAgent, InboxState>({
    agent: "InboxAgent",
    name: "inbox",
    onStateUpdate: setState,
    onStateUpdateError: () => setActionError("The Agent rejected a state update."),
  });
  const chat = useAgentChat({
    agent,
    body: () => ({ modelId: selectedModel }),
    syncMessagesToServer: false,
  });

  useEffect(() => setSelectedModel(state.selectedModel), [state.selectedModel]);
  useEffect(() => {
    if (agent.readyState !== WebSocket.OPEN || reconciled.current) return;
    reconciled.current = true;
    void agent.stub
      .refreshApprovals()
      .catch(() => setActionError("Approval state is unavailable."));
  }, [agent.readyState, agent.stub]);

  const messages = useMemo(() => toDisplayMessages(chat.messages), [chat.messages]);
  const status = connectionStatus(
    agent.readyState,
    chat.status,
    Boolean(agent.connectionError ?? chat.error ?? actionError),
  );
  const error = actionError ?? chat.error?.message ?? agent.connectionError?.message;

  function submit(): void {
    const text = input.trim();
    if (!text) return;
    setActionError(undefined);
    void chat.sendMessage({ text }).catch(() => setActionError("The message could not be sent."));
    setInput("");
  }

  function resolveApproval(executionId: string, approved: boolean): void {
    setApprovalBusy(executionId);
    setActionError(undefined);
    const request = approved
      ? agent.stub.approveSend(executionId)
      : agent.stub.rejectSend(executionId);
    void request
      .catch(() => setActionError(approved ? "Approval failed." : "Rejection failed."))
      .finally(() => setApprovalBusy(undefined));
  }

  function reset(): void {
    chat.clearHistory();
    void agent.stub.resetInbox().catch(() => setActionError("Inbox reset failed."));
  }

  return (
    <WorkshopShell
      aside={
        <InboxDashboard
          state={state}
          {...(approvalBusy === undefined ? {} : { approvalBusy })}
          onApprove={(id) => resolveApproval(id, true)}
          onReject={(id) => resolveApproval(id, false)}
        />
      }
      description="Process signed inbound email, preserve thread facts, draft clarifications and replies, and require durable human approval before every send."
      {...(error === undefined ? {} : { error })}
      input={input}
      inputPlaceholder="Ask about the current thread or draft…"
      messages={messages}
      models={MODEL_DEFINITIONS}
      onInputChange={setInput}
      onModelChange={(modelId) => {
        setSelectedModel(modelId);
        void agent.stub.selectModel(modelId);
      }}
      onReset={reset}
      onStop={() => void chat.stop()}
      onSubmit={submit}
      resetLabel="Reset inbox"
      selectedModel={selectedModel}
      status={status}
      title="Inbox Agent"
    />
  );
}
