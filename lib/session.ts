const storageKey = "mistopis-anonymous-session";

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

  return { "X-Mistopis-Session": session };
}
