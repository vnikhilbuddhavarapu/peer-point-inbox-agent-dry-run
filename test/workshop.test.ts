import { describe, expect, it } from "vitest";

import { createClarificationStrategy } from "../src/agent/context.js";
import { createInitialState } from "../src/agent/state.js";
import {
  configureSendReplyPolicy,
  resolveSendReplyPolicy,
  saveEstablishedFact,
} from "../src/agent/workshop.js";

describe("Inbox Agent workshop boundaries", () => {
  it("provides useful instructions or a visible typed clarification fallback", () => {
    const strategy = createClarificationStrategy();

    if (strategy.ok) {
      expect(strategy.value.instructions.trim().length).toBeGreaterThan(40);
    } else {
      expect(strategy.error).toMatchObject({
        code: "NOT_IMPLEMENTED",
        task: "clarification-strategy",
      });
    }
  });

  it("persists a validated fact or leaves durable state unchanged", () => {
    const initial = createInitialState();
    const fact = "The rollout is complete.";
    const outcome = saveEstablishedFact(initial, fact);

    if (outcome.result.ok) {
      expect(outcome.result.value).toEqual({ fact });
      expect(outcome.state.thread.facts).toContain(fact);
    } else {
      expect(outcome.state).toBe(initial);
      expect(outcome.state.thread.facts).toEqual([]);
      expect(outcome.result.error).toMatchObject({
        code: "NOT_IMPLEMENTED",
        task: "established-facts",
      });
    }
  });

  it("requires a durable approval or disables outbound delivery behind one", () => {
    const configured = configureSendReplyPolicy();
    const resolved = resolveSendReplyPolicy();

    expect(resolved.kind).toBe("durable-pause");
    expect(resolved.approval).toBe(true);
    expect(resolved.approvalRisk).toBe("high");
    if (configured.ok) {
      expect(resolved.enabled).toBe(true);
      expect(resolved).toMatchObject(configured.value);
    } else {
      expect(configured.error).toMatchObject({
        code: "NOT_IMPLEMENTED",
        task: "durable-pause-policy",
      });
      expect(resolved.enabled).toBe(false);
      expect(resolved.approvalSummary).toBe("Workshop send is disabled");
    }
  });
});
