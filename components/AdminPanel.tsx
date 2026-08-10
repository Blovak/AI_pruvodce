"use client";

import {
  LoaderCircle,
  MapPinned,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { getSessionHeaders } from "@/lib/session";

type AdminUser = {
  email: string;
  createdAt: string;
  lastLoginAt: string;
  status: string;
};

type AdminStats = {
  users: AdminUser[];
  positionLookups: number;
};

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("cs-CZ", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : "Neznámé";
}

export function AdminPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/admin/stats"), {
        headers: getSessionHeaders(),
      });
      const data = (await response.json()) as AdminStats & { error?: string };
      if (!response.ok) throw new Error(data.error || "Načtení selhalo.");
      setStats(data);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Administrativní přehled se nepodařilo načíst.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadStats();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loadStats, onClose, open]);

  if (!open) return null;

  return (
    <div className="admin-backdrop" role="dialog" aria-modal="true">
      <section className="admin-panel" aria-labelledby="admin-title">
        <button
          aria-label="Zavřít administraci"
          className="icon-button admin-close"
          onClick={onClose}
          type="button"
        >
          <X size={20} />
        </button>
        <div className="admin-heading">
          <span><ShieldCheck size={23} /></span>
          <div>
            <p className="eyebrow">SPRÁVA APLIKACE</p>
            <h2 id="admin-title">Administrace</h2>
          </div>
        </div>

        {loading && !stats ? (
          <div className="admin-loading">
            <LoaderCircle className="spin" size={24} />
            Načítám provozní údaje…
          </div>
        ) : error && !stats ? (
          <div className="admin-error" role="alert">
            <p>{error}</p>
            <button onClick={loadStats} type="button">
              <RefreshCw size={15} /> Zkusit znovu
            </button>
          </div>
        ) : stats ? (
          <>
            <div className="admin-stats">
              <article>
                <Users size={22} />
                <span>Uživatelé</span>
                <strong>{stats.users.length}</strong>
              </article>
              <article>
                <MapPinned size={22} />
                <span>Dohledané pozice</span>
                <strong>{stats.positionLookups}</strong>
              </article>
            </div>

            <div className="admin-users-heading">
              <div>
                <p className="eyebrow">REGISTROVANÉ ÚČTY</p>
                <h3>Všichni uživatelé</h3>
              </div>
              <button disabled={loading} onClick={loadStats} type="button">
                {loading ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <RefreshCw size={15} />
                )}
                Obnovit
              </button>
            </div>
            {error && <p className="admin-inline-error">{error}</p>}
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Uživatel</th>
                    <th>Poslední přihlášení</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.users.map((user) => (
                    <tr key={user.email}>
                      <td>{user.email}</td>
                      <td>{dateLabel(user.lastLoginAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
