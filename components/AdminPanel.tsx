"use client";

import {
  LoaderCircle,
  Map,
  MapPinned,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { getSessionHeaders } from "@/lib/session";
import {
  AdminPositionsMap,
  type AdminPosition,
} from "@/components/AdminPositionsMap";

type AdminUser = {
  email: string;
  createdAt: string;
  lastLoginAt: string;
  status: string;
  newPositions: number;
};

type AdminStats = {
  users: AdminUser[];
  positionLookups: number;
  positions: AdminPosition[];
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
  const [view, setView] = useState<"users" | "map">("users");
  const [mapFullscreen, setMapFullscreen] = useState(false);

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
  }, [loadStats, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !mapFullscreen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mapFullscreen, onClose, open]);

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

            <div className="admin-view-bar">
              <div className="admin-view-tabs" role="tablist">
                <button
                  aria-selected={view === "users"}
                  className={view === "users" ? "is-active" : ""}
                  onClick={() => setView("users")}
                  role="tab"
                  type="button"
                >
                  <Users size={16} /> Uživatelé
                </button>
                <button
                  aria-selected={view === "map"}
                  className={view === "map" ? "is-active" : ""}
                  onClick={() => setView("map")}
                  role="tab"
                  type="button"
                >
                  <Map size={16} /> Mapa bodů
                </button>
              </div>
              <button
                className="admin-refresh"
                disabled={loading}
                onClick={loadStats}
                type="button"
              >
                {loading ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <RefreshCw size={15} />
                )}
                Obnovit
              </button>
            </div>
            {error && <p className="admin-inline-error">{error}</p>}
            {view === "users" ? (
              <>
                <div className="admin-users-heading">
                  <div>
                    <p className="eyebrow">REGISTROVANÉ ÚČTY</p>
                    <h3>Všichni uživatelé</h3>
                  </div>
                </div>
                <div className="admin-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Uživatel</th>
                        <th>Poslední přihlášení</th>
                        <th>Nové pozice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.users.map((user) => (
                        <tr key={user.email}>
                          <td>{user.email}</td>
                          <td>{dateLabel(user.lastLoginAt)}</td>
                          <td className="admin-position-count">
                            {user.newPositions}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="admin-map-section" role="tabpanel">
                <div className="admin-users-heading">
                  <div>
                    <p className="eyebrow">DOHLEDANÉ POZICE</p>
                    <h3>Všechny body v mapě</h3>
                  </div>
                </div>
                <AdminPositionsMap
                  onFullscreenChange={setMapFullscreen}
                  positions={stats.positions || []}
                />
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
