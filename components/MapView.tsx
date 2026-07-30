"use client";

import {
  Check,
  Crosshair,
  LoaderCircle,
  MapPin,
  MapPinned,
  Maximize2,
  Minimize2,
  Move,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CircleMarker,
  Map as LeafletMap,
  Marker,
  Polyline,
} from "leaflet";
import type { Coordinates, Place } from "@/lib/types";

const defaultCenter: [number, number] = [49.8175, 15.473];
const earthRadiusMeters = 6371008.8;

function bearingDegrees(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const toRadians = Math.PI / 180;
  const latitudeARadians = latitudeA * toRadians;
  const latitudeBRadians = latitudeB * toRadians;
  const longitudeDelta = (longitudeB - longitudeA) * toRadians;
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeBRadians);
  const x =
    Math.cos(latitudeARadians) * Math.sin(latitudeBRadians) -
    Math.sin(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const toRadians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * toRadians;
  const longitudeDelta = (longitudeB - longitudeA) * toRadians;
  const latitudeARadians = latitudeA * toRadians;
  const latitudeBRadians = latitudeB * toRadians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    earthRadiusMeters *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function distanceLabel(meters: number) {
  return meters < 1000
    ? `${Math.max(1, Math.round(meters))} m`
    : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

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
  const currentMarkerRef = useRef<CircleMarker | null>(null);
  const directionMarkerRef = useRef<Marker | null>(null);
  const directionLineRef = useRef<Polyline | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const pickingRef = useRef(false);
  const fittedViewportRef = useRef("");
  const [mapReady, setMapReady] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draft, setDraft] = useState<Coordinates | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<Coordinates | null>(
    null,
  );
  const isMapExpanded = isPicking || isFullscreen;

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setCurrentPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        // Aplikace zůstává použitelná i při zamítnuté nebo nedostupné GPS.
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000,
      },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

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
      currentMarkerRef.current = null;
      directionMarkerRef.current = null;
      directionLineRef.current = null;
      leafletRef.current = null;
    };
    // Mapa se vytváří pouze jednou; změny místa řeší samostatný efekt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pickingRef.current = isPicking;
  }, [isPicking]);

  useEffect(() => {
    document.body.classList.toggle("map-is-expanded", isMapExpanded);
    const map = mapRef.current;
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(() => map?.invalidateSize());
    });
    const resizeTimer = window.setTimeout(() => map?.invalidateSize(), 250);

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nestedFrame);
      window.clearTimeout(resizeTimer);
      document.body.classList.remove("map-is-expanded");
    };
  }, [isMapExpanded]);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!map || !leaflet) return;

    markerRef.current?.remove();
    markerRef.current = null;
    fittedViewportRef.current = "";

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

      if (!pickingRef.current && !currentPosition) {
        map.setView([place.latitude, place.longitude], 16);
      }
    }
    // Aktuální GPS se vykresluje samostatně a nesmí znovu vytvářet cílovou
    // značku ani při každé aktualizaci přepočítávat výřez mapy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!map || !leaflet || !currentPosition) return;

    const currentLatLng: [number, number] = [
      currentPosition.latitude,
      currentPosition.longitude,
    ];
    if (!currentMarkerRef.current) {
      currentMarkerRef.current = leaflet
        .circleMarker(currentLatLng, {
          radius: 8,
          color: "#fff7e8",
          weight: 3,
          fillColor: "#255e53",
          fillOpacity: 1,
        })
        .addTo(map);
    } else {
      currentMarkerRef.current.setLatLng(currentLatLng);
    }

    directionMarkerRef.current?.remove();
    directionMarkerRef.current = null;
    directionLineRef.current?.remove();
    directionLineRef.current = null;

    const targetDistance = place
      ? distanceMeters(
          currentPosition.latitude,
          currentPosition.longitude,
          place.latitude,
          place.longitude,
        )
      : 0;

    if (place && targetDistance >= 3) {
      const bearing = bearingDegrees(
        currentPosition.latitude,
        currentPosition.longitude,
        place.latitude,
        place.longitude,
      );
      directionLineRef.current = leaflet
        .polyline(
          [
            currentLatLng,
            [place.latitude, place.longitude],
          ],
          {
            color: "#c96845",
            weight: 3,
            opacity: 0.72,
            dashArray: "7 9",
          },
        )
        .addTo(map);
      directionLineRef.current.bringToBack();
      directionMarkerRef.current = leaflet
        .marker(currentLatLng, {
          interactive: false,
          keyboard: false,
          icon: leaflet.divIcon({
            className: "map-direction-icon",
            html: `<span class="map-direction-arrow" style="transform:rotate(${bearing}deg)"></span>`,
            iconAnchor: [32, 32],
            iconSize: [64, 64],
          }),
        })
        .addTo(map);
    }

    if (pickingRef.current) return;
    const viewportKey = place
      ? `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`
      : "current-position";
    if (fittedViewportRef.current === viewportKey) return;
    fittedViewportRef.current = viewportKey;

    if (place && targetDistance >= 3) {
      map.fitBounds(
        leaflet.latLngBounds(currentLatLng, [
          place.latitude,
          place.longitude,
        ]),
        {
          paddingTopLeft: [65, 80],
          paddingBottomRight: [65, 95],
          maxZoom: 16,
        },
      );
    } else {
      map.setView(currentLatLng, 16);
    }
  }, [currentPosition, isPicking, mapReady, place]);

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

  const selectedDistance =
    place && currentPosition
      ? distanceMeters(
          currentPosition.latitude,
          currentPosition.longitude,
          place.latitude,
          place.longitude,
        )
      : null;

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

  useEffect(() => {
    if (!isMapExpanded) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (isPicking) {
        pickingRef.current = false;
        setIsPicking(false);
        setDraft(null);
        return;
      }
      setIsFullscreen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMapExpanded, isPicking]);

  return (
    <section
      className={`map-panel${isMapExpanded ? " is-expanded" : ""}${isPicking ? " is-picking" : ""}`}
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
        <button
          aria-pressed={isFullscreen}
          disabled={!mapReady}
          onClick={() => setIsFullscreen((fullscreen) => !fullscreen)}
          type="button"
        >
          {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          {isFullscreen ? "Zmenšit mapu" : "Celá obrazovka"}
        </button>
      </div>

      {currentPosition && (
        <div className="map-location-legend" aria-live="polite">
          <span>
            <i className="current-position-swatch" />
            Vaše poloha
          </span>
          {place && (
            <span>
              <i className="selected-position-swatch" />
              Vybraný bod
              {selectedDistance !== null && selectedDistance >= 3 && (
                <strong>{distanceLabel(selectedDistance)}</strong>
              )}
            </span>
          )}
        </div>
      )}

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
