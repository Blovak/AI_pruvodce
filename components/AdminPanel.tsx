"use client";

import {
  CheckCircle2,
  DatabaseZap,
  LoaderCircle,
  Map,
  MapPinned,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

type GpsImportJob = {
  status: "idle" | "running" | "complete" | "error";
  processed: number;
  created: number;
  duplicates: number;
  invalid: number;
  existingCompatible: number;
  alreadyImported: number;
  archived: number;
  sourceRows: number;
  backupRows: number;
  startedAt: string;
  updatedAt: string;
  lastError: string;
};

const GPS_IMPORT_MINIMUM_PER_RUN = 3000;

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
  const [view, setView] = useState<"users" | "map" | "import">("users");
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [importJob, setImportJob] = useState<GpsImportJob | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importRunning, setImportRunning] = useState(false);
  const [importError, setImportError] = useState("");
  const [importRunProcessed, setImportRunProcessed] = useState(0);
  const [importTargetReached, setImportTargetReached] = useState(false);
  const stopImport = useRef(false);

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

  const loadImportStatus = useCallback(async () => {
    setImportLoading(true);
    setImportError("");
    try {
      const response = await fetch(apiUrl("/api/admin/gps-import"), {
        headers: getSessionHeaders(),
      });
      const data = (await response.json()) as {
        job?: GpsImportJob | null;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Načtení stavu selhalo.");
      setImportJob(data.job || null);
    } catch (reason) {
      setImportError(
        reason instanceof Error
          ? reason.message
          : "Stav importu se nepodařilo načíst.",
      );
    } finally {
      setImportLoading(false);
    }
  }, []);

  const runImport = useCallback(async () => {
    stopImport.current = false;
    setImportRunning(true);
    setImportError("");
    setImportRunProcessed(0);
    setImportTargetReached(false);
    const startsNewJob = !importJob || importJob.status === "complete";
    const processedAtStart = startsNewJob
      ? 0
      : Number(importJob.processed || 0);
    let reset = startsNewJob;
    try {
      while (!stopImport.current) {
        const response = await fetch(apiUrl("/api/admin/gps-import"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getSessionHeaders(),
          },
          body: JSON.stringify({ reset }),
        });
        const data = (await response.json()) as {
          job?: GpsImportJob;
          error?: string;
        };
        if (!response.ok || !data.job) {
          throw new Error(data.error || "Import se nepodařilo dokončit.");
        }
        setImportJob(data.job);
        const processedInRun = Math.max(
          data.job.processed - processedAtStart,
          0,
        );
        setImportRunProcessed(processedInRun);
        reset = false;
        if (data.job.status === "complete") {
          await loadStats();
          break;
        }
        if (processedInRun >= GPS_IMPORT_MINIMUM_PER_RUN) {
          setImportTargetReached(true);
          await loadStats();
          break;
        }
      }
    } catch (reason) {
      setImportError(
        reason instanceof Error ? reason.message : "Import se nezdařil.",
      );
    } finally {
      setImportRunning(false);
    }
  }, [importJob, loadStats]);

  useEffect(() => {
    if (!open) return;
    void loadStats();
    void loadImportStatus();
    return () => {
      stopImport.current = true;
    };
  }, [loadImportStatus, loadStats, open]);

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
                <button
                  aria-selected={view === "import"}
                  className={view === "import" ? "is-active" : ""}
                  onClick={() => setView("import")}
                  role="tab"
                  type="button"
                >
                  <DatabaseZap size={16} /> Import GPS
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
            ) : view === "map" ? (
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
            ) : (
              <div className="admin-import-section" role="tabpanel">
                <div className="admin-users-heading">
                  <div>
                    <p className="eyebrow">GOOGLE SHEETS → DATABÁZE</p>
                    <h3>Import GPS bodů</h3>
                  </div>
                </div>
                <p className="admin-import-description">
                  Zpracuje nezpracované řádky z listu GPS body. Shodné sousední
                  popisy přeskočí a všechny prošlé řádky přesune do listu Backup
                  se stavem True. Jedno spuštění zpracuje minimálně 3&nbsp;000
                  řádků, pokud jich ve zdrojovém listu tolik zbývá.
                </p>

                {importJob ? (
                  <div className="admin-import-grid">
                    <article>
                      <span>Prošlo řádků</span>
                      <strong>{importJob.processed}</strong>
                    </article>
                    <article>
                      <span>Nové body</span>
                      <strong>{importJob.created}</strong>
                    </article>
                    <article>
                      <span>Duplicity</span>
                      <strong>{importJob.duplicates}</strong>
                    </article>
                    <article>
                      <span>Již v databázi</span>
                      <strong>
                        {importJob.alreadyImported + importJob.existingCompatible}
                      </strong>
                    </article>
                    <article>
                      <span>Neplatné</span>
                      <strong>{importJob.invalid}</strong>
                    </article>
                    <article>
                      <span>Archivováno</span>
                      <strong>{importJob.archived}</strong>
                    </article>
                  </div>
                ) : (
                  <p className="admin-import-empty">
                    Import zatím nebyl spuštěn.
                  </p>
                )}

                {importJob && (
                  <div className={`admin-import-status is-${importJob.status}`}>
                    {importJob.status === "complete" ? (
                      <CheckCircle2 size={18} />
                    ) : importRunning ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <DatabaseZap size={18} />
                    )}
                    <span>
                      {importJob.status === "complete"
                        ? "Import je dokončený."
                        : importJob.status === "error"
                          ? "Poslední dávka skončila chybou; lze bezpečně pokračovat."
                          : importRunning
                            ? `Zpracovávám řádky… ${importRunProcessed.toLocaleString("cs-CZ")} / ${GPS_IMPORT_MINIMUM_PER_RUN.toLocaleString("cs-CZ")}`
                            : importTargetReached
                              ? "Bylo zpracováno alespoň 3 000 řádků. Import může pokračovat další dávkou."
                              : "Import je připraven pokračovat."}
                    </span>
                    <small>
                      GPS body: {importJob.sourceRows} · Backup:{" "}
                      {importJob.backupRows}
                    </small>
                  </div>
                )}

                {importError && (
                  <p className="admin-inline-error" role="alert">
                    {importError}
                  </p>
                )}
                <div className="admin-import-actions">
                  {importRunning ? (
                    <button
                      className="admin-import-stop"
                      onClick={() => {
                        stopImport.current = true;
                      }}
                      type="button"
                    >
                      <Square size={14} /> Zastavit po dávce
                    </button>
                  ) : (
                    <button
                      className="admin-import-start"
                      onClick={runImport}
                      type="button"
                    >
                      <Play size={15} />
                      {!importJob || importJob.status === "complete"
                        ? "Spustit nový import"
                        : "Pokračovat v importu"}
                    </button>
                  )}
                  <button
                    className="admin-import-refresh"
                    disabled={importLoading || importRunning}
                    onClick={loadImportStatus}
                    type="button"
                  >
                    <RefreshCw size={14} /> Obnovit stav
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
