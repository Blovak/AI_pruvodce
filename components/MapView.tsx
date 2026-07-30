"use client";

import {
  Check,
  Crosshair,
  LoaderCircle,
  MapPin,
  MapPinned,
  Move,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import type { Coordinates, Place } from "@/lib/types";

const defaultCenter: [number, number] = [49.8175, 15.473];

export function MapView({
  place,
  mapSelectionRequest,
  onRelocate,
  onSelectionStart,
  onSelectPoint,
}: {
  place: Place | null;
  mapSelectionRequest: number;
  onRelocate: () => void;
  onSelectionStart: () => void;
  onSelectPoint: (coordinates: Coordinates) => Promise<void>;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const pickingRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [draft, setDraft] = useState<Coordinates | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    void import("leaflet").then((leaflet) => {
      if (cancelled || !containerRef.current) return;
      leafletRef.current = leaflet;
      const initialCenter: [number, number] = place
        ? [place.latitude, place.longitude]
        : defaultCenter;

      map = leaflet
        .map(containerRef.current, {
          attributionControl: false,
          zoomControl: false,
        })
        .setView(initialCenter, place ? 15 : 7);

      leaflet.control.zoom({ position: "topright" }).addTo(map);
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        })
        .addTo(map);

      map.on("move", () => {
        if (!pickingRef.current || !map) return;
        const center = map.getCenter();
        setDraft({
          latitude: center.lat,
          longitude: center.lng,
        });
      });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
      leafletRef.current = null;
    };
    // Mapa se vytváří pouze jednou; změny místa řeší samostatný efekt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pickingRef.current = isPicking;
  }, [isPicking]);

  useEffect(() => {
    document.body.classList.toggle("map-is-picking", isPicking);
    const map = mapRef.current;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => map?.invalidateSize());
    });
    const resizeTimer = window.setTimeout(() => map?.invalidateSize(), 250);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      document.body.classList.remove("map-is-picking");
    };
  }, [isPicking]);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!map || !leaflet) return;

    markerRef.current?.remove();
    markerRef.current = null;

    if (place) {
      markerRef.current = leaflet
        .circleMarker([place.latitude, place.longitude], {
          radius: 8,
          color: "#fff7e8",
          weight: 3,
          fillColor: "#c96845",
          fillOpacity: 1,
        })
        .addTo(map);

      if (!pickingRef.current) {
        map.setView([place.latitude, place.longitude], 16);
      }
    }
  }, [place, mapReady]);

  const startPicking = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    onSelectionStart();
    const center = map.getCenter();
    pickingRef.current = true;
    setIsPicking(true);
    setDraft({ latitude: center.lat, longitude: center.lng });
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [onSelectionStart]);

  useEffect(() => {
    if (mapSelectionRequest <= 0 || !mapReady) return;
    startPicking();
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [mapReady, mapSelectionRequest, startPicking]);

  function cancelPicking() {
    pickingRef.current = false;
    setIsPicking(false);
    setDraft(null);
    if (place) {
      mapRef.current?.setView([place.latitude, place.longitude], 16);
    }
  }

  async function confirmPoint() {
    if (!draft || confirming) return;
    const selectedPoint = draft;
    setConfirming(true);
    pickingRef.current = false;
    setIsPicking(false);
    setDraft(null);
    try {
      await onSelectPoint(selectedPoint);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section
      className={`map-panel${isPicking ? " is-picking" : ""}`}
      aria-label="Mapa pro výběr místa"
      aria-modal={isPicking || undefined}
      ref={panelRef}
      role={isPicking ? "dialog" : undefined}
    >
      <div className="interactive-map" ref={containerRef} />

      {!mapReady && (
        <div className="map-placeholder">
          <MapPinned size={40} strokeWidth={1.4} />
          <span>Načítám mapu</span>
        </div>
      )}

      <div className="map-wash" />

      {isPicking && (
        <>
          <div className="map-picker-pin" aria-hidden="true">
            <MapPin size={42} fill="currentColor" />
          </div>
          <div className="map-picker-hint">
            <Move size={16} />
            Posuňte mapu pod pevným bodem
          </div>
        </>
      )}

      <div className="map-controls">
        <button onClick={onRelocate} type="button">
          <Crosshair size={17} />
          Moje poloha
        </button>
        <button disabled={!mapReady} onClick={startPicking} type="button">
          <MapPin size={17} />
          Vybrat bod
        </button>
      </div>

      {isPicking && draft && (
        <div className="map-picker-confirm" role="status">
          <div>
            <strong>Je bod přesně na místě zájmu?</strong>
            <small>
              {draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)}
            </small>
          </div>
          <button
            aria-label="Zrušit výběr bodu"
            className="map-picker-cancel"
            disabled={confirming}
            onClick={cancelPicking}
            type="button"
          >
            <X size={18} />
          </button>
          <button
            className="map-picker-submit"
            disabled={confirming}
            onClick={confirmPoint}
            type="button"
          >
            {confirming ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Check size={17} />
            )}
            Použít tento bod
          </button>
        </div>
      )}

      <p className="map-credit">
        © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
      </p>
    </section>
  );
}
