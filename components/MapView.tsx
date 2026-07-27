"use client";

import { Crosshair, MapPinned } from "lucide-react";
import type { Place } from "@/lib/types";

function mapUrl(place: Place) {
  const span = 0.009;
  const bbox = [
    place.longitude - span,
    place.latitude - span * 0.65,
    place.longitude + span,
    place.latitude + span * 0.65,
  ].join(",");

  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bbox,
  )}&layer=mapnik&marker=${place.latitude}%2C${place.longitude}`;
}

export function MapView({
  place,
  onRelocate,
}: {
  place: Place | null;
  onRelocate: () => void;
}) {
  return (
    <section className="map-panel" aria-label="Mapa aktuální polohy">
      {place ? (
        <iframe
          className="map-frame"
          src={mapUrl(place)}
          title={`Mapa místa ${place.label}`}
          loading="lazy"
        />
      ) : (
        <div className="map-placeholder">
          <MapPinned size={40} strokeWidth={1.4} />
          <span>Čekám na vaši polohu</span>
        </div>
      )}
      <div className="map-wash" />
      {place && (
        <div className="place-pin" aria-hidden="true">
          <span />
        </div>
      )}
      <button className="map-control" onClick={onRelocate} type="button">
        <Crosshair size={17} />
        Moje poloha
      </button>
      <p className="map-credit">
        © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
      </p>
    </section>
  );
}
