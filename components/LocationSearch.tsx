"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, MapPin, Search, X } from "lucide-react";
import type { Place } from "@/lib/types";
import { apiUrl } from "@/lib/api-url";
import { getSessionHeaders } from "@/lib/session";

export function LocationSearch({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (place: Place) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        apiUrl(`/api/geocode?q=${encodeURIComponent(query)}`),
        { headers: getSessionHeaders() },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResults(data);
      if (!data.length) setError("Žádné místo jsme nenašli.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Vyhledávání selhalo.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="search-backdrop" role="dialog" aria-modal="true">
      <div className="search-sheet">
        <button className="icon-button close-search" onClick={onClose} type="button">
          <X size={20} />
          <span className="sr-only">Zavřít</span>
        </button>
        <p className="eyebrow">JINÉ MÍSTO</p>
        <h2>Kde se chcete rozhlédnout?</h2>
        <form className="search-form" onSubmit={submit}>
          <Search size={19} />
          <input
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Náměstí, památka nebo obec"
            value={query}
          />
          <button disabled={loading} type="submit">
            {loading ? <LoaderCircle className="spin" size={18} /> : "Hledat"}
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
        <div className="search-results">
          {results.map((result) => (
            <button
              key={`${result.latitude}-${result.longitude}`}
              onClick={() => {
                onSelect(result);
                onClose();
              }}
              type="button"
            >
              <MapPin size={18} />
              <span>{result.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
