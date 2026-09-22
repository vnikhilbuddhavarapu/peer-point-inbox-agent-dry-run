# Inbox Agent

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vnikhilbuddhavarapu/peer-point-card-3-inbox-agent)

Build the decision-making layer of an email Agent while the signed ingress, durable thread, simulator, draft plumbing, and approval dashboard are already wired for you.

## Learning objective

A vague email should cause one useful clarification question. The reply should add only correspondent-established facts to durable state. Every outbound email must park as a Think Action and wait for explicit human approval before any delivery side effect.

The starter intentionally fails closed. Before the workshop tasks are complete, signed email is still accepted and visible in the thread UI, but fact persistence returns a typed `NOT_IMPLEMENTED` result and outbound delivery remains disabled behind an approval pause.

## Already complete

- bounded Zod mail and router contracts;
- ECDSA P-256 verification for `POST /email`, including replay-window checks;
- idempotent programmatic submission keyed by message ID;
- one-correspondent thread, draft, submission, delivery, and model state;
- draft persistence and outbound router execution plumbing;
- WebSocket thread and authoritative pending-approval UI;
- approve, reject, reset, model selection, and simulator-mode delivery paths;
- safe structured logs that omit email content, prompts, endpoints, and credentials.

## Build these three behaviors

Edit exactly these two files:

1. `src/agent/context.ts`
   - Replace the `WORKSHOP TASK` fallback with a concise clarification strategy.
   - Tell the Agent how to distinguish a vague request from a reply that contains enough established detail.
   - Require one focused question and forbid invented dates, audiences, decisions, incidents, or attachments.
2. `src/agent/workshop.ts`
   - Implement established-fact persistence using the validated state helper in `state.ts`.
   - Return a configured `durable-pause` send policy that requires approval for every outbound email.

Keep the result unions intact. Expected, unfinished behavior should remain typed data rather than an exception.

## First run

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Open the printed local URL. The health endpoint is `/api/health`. Local Workers AI development uses your authenticated lab account and its `default` AI Gateway.

The instructor-operated simulator signs inbound requests; the attendee app never receives its private signing key. After deployment, target the Worker URL from the workshop simulator and send this first message:

> Subject: Leadership rollout update
>
> Can you send leadership an update on the rollout?

A useful second message for the base scenario is:

> Tell the Montreal leadership team the rollout is complete, no incidents occurred, and feedback is due September 23.

## Contracts to preserve

- `mailPayloadSchema` bounds sender, recipient, subject, body, message IDs, references, hops, and received time.
- `draftInputSchema` is the exact value saved before `sendReply` is requested.
- `WorkshopTaskResult<T>` uses either `{ ok: true, value }` or `{ ok: false, error }`.
- A completed send policy has `kind: "durable-pause"` and `approval: true`.
- The Action revalidates its approved input against the current draft before calling the router.
- Message IDs remain the idempotency boundary for ingress, submissions, thread entries, and side effects.

## Check your work

```bash
npm test
npm run typecheck
npm run build
npx wrangler deploy --dry-run
```

The focused workshop tests accept either the safe typed fallback or a correctly shaped completed result. Do not weaken the contract, signature, state-boundary, or UI tests.

### Base checklist

- [ ] A vague first email produces one concise clarification draft.
- [ ] The draft creates a pending Action visible in the dashboard.
- [ ] No outbound message or delivery result exists before approval.
- [ ] The correspondent's second email adds only established facts.
- [ ] A useful final draft preserves `Re:` subject and message references.
- [ ] Each outbound send parks independently and proceeds only after approval.
- [ ] Duplicate inbound message IDs do not duplicate the thread or submission.

### Stretch checklist

- [ ] Improve the structured thread summary without growing context without bounds.
- [ ] Exercise external email threading only after the instructor explicitly enables the event-domain path.
- [ ] Explore multiple-correspondent isolation as a separate Durable Object naming strategy.

## Deploy and demo

```bash
npm run deploy
```

Use the deployed URL with the signed simulator. Demo the thread after the first inbound message, the pending approval before each send, the absence of pre-approval delivery, and the final two-turn fact summary.

`MAIL_ROUTER_CAPABILITY=simulator-only` is the deterministic fallback. A real capability is secret material: add it with Wrangler's secret command only when instructed, never place it in source, `.dev.vars.example`, logs, screenshots, or chat.

## Recovery

- **`INVALID_SIGNATURE` or `EMAIL_REJECTED`:** use the workshop simulator. Handwritten `curl` requests are intentionally rejected because attendees do not receive the signing key.
- **No model response locally:** confirm Wrangler is authenticated to the temporary lab account and the account-local `default` AI Gateway is available.
- **No approval appears:** refresh the dashboard, inspect the typed tool result, and confirm the send policy returns `ok: true` with `durable-pause` plus `approval: true`.
- **Facts stay empty:** confirm `saveEstablishedFact` returns the state produced by the bounded `recordFact` helper.
- **Draft approval fails after an edit:** request a new Action. The approved input must exactly match the current draft.
- **Need a clean attempt:** use the dashboard reset, which rejects parked approvals before clearing application state.

## Security constraints

Do not bypass signature verification, replay limits, strict schemas, the one-correspondent guard, model allowlisting, idempotency keys, draft revalidation, or the durable approval gate. Do not add permissive CORS, expose private endpoints, log email content or tool payloads, commit `.dev.vars`, or place router/signing credentials in browser code.

## Start with Peer Point OS

After the Deploy to Cloudflare flow creates your repository and first deployment, give the generated Git URL to Peer Point OS with this prompt:

```text
Clone this repository in an isolated Container MCP environment. Read the complete README before editing. Run npm ci and npm run verify to establish a baseline. Implement a working Inbox Agent using the required Cloudflare primitives and preserving its safety constraints. You may choose a different architecture from the suggested path. Run focused tests and npm run verify, inspect the diff, then push through the GitHub gatekeeper. Do not claim success until verification passes. After the push, inspect Workers Builds and give me the deployed URL and demo checklist.
```

## Start with your own IDE

```bash
npm ci
npm run verify
npm run dev
```

Before pushing or deploying:

```bash
npm run verify
```

Deploy only to the temporary lab account assigned for the event.
