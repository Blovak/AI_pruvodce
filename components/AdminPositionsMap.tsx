"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";

export type AdminPosition = {
  id: string;
  latitude: number;
  longitude: number;
  place: string;
  createdAt: string;
  createdByEmail: string;
};

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("cs-CZ", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : "Neznámé datum";
}

export function AdminPositionsMap({
  positions,
  onFullscreenChange,
}: {
  positions: AdminPosition[];
  onFullscreenChange: (fullscreen: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<CircleMarker[]>([]);
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    void import("leaflet").then((leaflet) => {
      if (cancelled || !containerRef.current) return;
      map = leaflet.map(containerRef.current, {
        attributionControl: false,
        preferCanvas: true,
        zoomControl: false,
      });
      leaflet.control.zoom({ position: "topright" }).addTo(map);
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        })
        .addTo(map);

      markersRef.current = positions.map((position) => {
        const marker = leaflet.circleMarker(
          [position.latitude, position.longitude],
          {
            radius: 6,
            color: "#fff7e8",
            weight: 2,
            fillColor: "#c96845",
            fillOpacity: 0.9,
          },
        );
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = position.place;
        const details = document.createElement("small");
        details.textContent = `${dateLabel(position.createdAt)}${
          position.createdByEmail ? ` · ${position.createdByEmail}` : ""
        }`;
        popup.className = "admin-map-popup";
        popup.append(title, details);
        return marker.bindPopup(popup).addTo(map!);
      });

      if (positions.length > 0) {
        const bounds = leaflet.latLngBounds(
          positions.map((position) => [
            position.latitude,
            position.longitude,
          ]),
        );
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
      } else {
        map.setView([49.8175, 15.473], 7);
      }

      const updateVisibleCount = () => {
        if (!map) return;
        const bounds = map.getBounds();
        setVisibleCount(
          markersRef.current.filter((marker) =>
            bounds.contains(marker.getLatLng()),
          ).length,
        );
      };
      map.on("moveend zoomend resize", updateVisibleCount);
      updateVisibleCount();
      mapRef.current = map;
      setReady(true);
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markersRef.current = [];
    };
  }, [positions]);

  useEffect(() => {
    document.body.classList.toggle("admin-map-is-expanded", fullscreen);
    onFullscreenChange(fullscreen);
    const map = mapRef.current;
    const frame = window.requestAnimationFrame(() => map?.invalidateSize());
    const timer = window.setTimeout(() => map?.invalidateSize(), 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      document.body.classList.remove("admin-map-is-expanded");
    };
  }, [fullscreen, onFullscreenChange]);

  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

  return (
    <div
      className={`admin-points-map-shell${fullscreen ? " is-expanded" : ""}`}
    >
      <div className="interactive-map admin-points-map" ref={containerRef} />
      {!ready && <div className="admin-map-loading">Načítám mapu…</div>}
      <div className="admin-map-toolbar">
        <span>
          Ve výřezu <strong>{visibleCount}</strong> z {positions.length} bodů
        </span>
        <button
          aria-pressed={fullscreen}
          disabled={!ready}
          onClick={() => setFullscreen((value) => !value)}
          type="button"
        >
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          {fullscreen ? "Zmenšit mapu" : "Celá obrazovka"}
        </button>
      </div>
      <p className="admin-map-credit">© OpenStreetMap</p>
    </div>
  );
}
