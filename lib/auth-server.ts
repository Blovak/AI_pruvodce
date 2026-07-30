type AuthStorageResponse = {
  ok?: boolean;
  authenticated?: boolean;
  email?: string;
};

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{32,160})$/i);
  return match?.[1] || "";
}

export async function authStorageRequest<T>(
  operation: string,
  data: Record<string, unknown>,
): Promise<T> {
  const url = process.env.GOOGLE_LOG_URL;
  const token = process.env.GOOGLE_LOG_TOKEN;
  if (!url || !token) {
    throw new Error("auth_not_configured");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token, operation, ...data }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`auth_storage_http_${response.status}`);
  const result = (await response.json()) as T & { ok?: boolean };
  if (!result.ok) throw new Error("auth_storage_failed");
  return result;
}

export async function authenticateRequest(request: Request) {
  const token = bearerToken(request);
  if (!token) return null;

  const result = await authStorageRequest<AuthStorageResponse>("authSession", {
    authToken: token,
  });
  return result.authenticated && result.email
    ? { email: result.email, token }
    : null;
}
