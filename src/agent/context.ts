import type { ContextConfig } from "agents/context";

import type { WorkshopTaskResult } from "./workshop.js";

export type ClarificationStrategy = {
  instructions: string;
};

export function createClarificationStrategy(): WorkshopTaskResult<ClarificationStrategy> {
  // WORKSHOP TASK: describe when to clarify, which missing detail to ask for, and when a final reply is ready.
  return {
    ok: false,
    error: {
      code: "NOT_IMPLEMENTED",
      task: "clarification-strategy",
      message: "The clarification strategy has not been implemented.",
    },
  };
}

export function createContextBlocks(): ContextConfig[] {
  const strategy = createClarificationStrategy();
  const strategyInstructions = strategy.ok
    ? strategy.value.instructions
    : `Clarification behavior is unavailable (${strategy.error.code}). Acknowledge the inbound message in chat, but do not invent facts, save a draft, or request an email send.`;
  const soul = `You are the Peer Point Inbox Agent. You manage one correspondent thread and never send email without durable human approval.

${strategyInstructions}

Never claim an email was sent until the action result says it was sent or simulated.`;

  return [
    { label: "soul", provider: { get: () => Promise.resolve(soul) } },
    {
      label: "memory",
      description: "Durable established facts about the current correspondent and request.",
      maxTokens: 1_000,
    },
  ];
}
