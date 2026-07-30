const storageKey = "mistopis-anonymous-session";
const authStorageKey = "mistopis-auth-token";

export function getSessionHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};

  let session = window.localStorage.getItem(storageKey);
  if (!session) {
    session =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, session);
  }

  const token = window.localStorage.getItem(authStorageKey);
  return {
    "X-Mistopis-Session": session,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function getAuthToken() {
  return typeof window === "undefined"
    ? null
    : window.localStorage.getItem(authStorageKey);
}

export function rememberAuthToken(token: string) {
  window.localStorage.setItem(authStorageKey, token);
}

export function forgetAuthToken() {
  window.localStorage.removeItem(authStorageKey);
}
