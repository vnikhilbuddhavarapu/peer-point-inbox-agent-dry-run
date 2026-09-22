import { getAgentByName, routeAgentRequest } from "agents";

import { InboxAgent } from "./agent/agent.js";
import { mailPayloadSchema } from "./services/contracts.js";
import { verifyMailSignature } from "./services/signature.js";
import { boundedBody, json } from "./shared/http.js";

export { InboxAgent };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/email") {
      try {
        const body = await boundedBody(request);
        const timestamp = request.headers.get("x-peer-point-timestamp") ?? "";
        const signature = request.headers.get("x-peer-point-signature") ?? "";
        if (
          !(await verifyMailSignature(body, timestamp, signature, env.EMAIL_SIGNING_PUBLIC_JWK))
        ) {
          return json({ ok: false, error: { code: "INVALID_SIGNATURE" } }, 401);
        }
        const payload = mailPayloadSchema.parse(JSON.parse(body) as unknown);
        const agent = await getAgentByName(env.INBOX_AGENT, "inbox");
        const submission = await agent.receiveEmail(payload);
        return json({ ok: true, submission }, submission.accepted ? 202 : 200);
      } catch {
        return json({ ok: false, error: { code: "EMAIL_REJECTED" } }, 400);
      }
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "inbox-agent", environment: env.ENVIRONMENT });
    }

    return json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
  },
} satisfies ExportedHandler<Env>;
