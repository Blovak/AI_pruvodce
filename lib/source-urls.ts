const trustedSourceHosts = new Set(["cs.wikipedia.org"]);

export function normalizeSourceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const uniqueUrls = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;

    try {
      const url = new URL(item);
      if (url.protocol !== "https:" || !trustedSourceHosts.has(url.hostname)) {
        continue;
      }
      uniqueUrls.add(url.toString());
    } catch {
      // Neplatné a relativní adresy nejsou důvěryhodným zdrojem.
    }
  }

  return [...uniqueUrls];
}
