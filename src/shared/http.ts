const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export function json(data: unknown, status = 200): Response {
  const response = Response.json(data, { status });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

export async function boundedBody(request: Request, maximum = 24_000): Promise<string> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maximum) throw new Error("REQUEST_TOO_LARGE");
  const body = await request.text();
  if (body.length > maximum) throw new Error("REQUEST_TOO_LARGE");
  return body;
}
