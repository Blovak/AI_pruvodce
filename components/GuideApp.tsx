"use client";

import {
  ArrowRight,
  ArrowUp,
  BookOpenText,
  ChevronDown,
  CircleStop,
  Compass,
  Headphones,
  Landmark,
  LoaderCircle,
  LocateFixed,
  LogOut,
  MapPin,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Volume2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { welcomeGuide } from "@/lib/fallback";
import type {
  Coordinates,
  GuideContent,
  NearbyPlace,
  Place,
} from "@/lib/types";
import { LocationSearch } from "@/components/LocationSearch";
import { MapView } from "@/components/MapView";
import { AdminPanel } from "@/components/AdminPanel";
import { apiUrl } from "@/lib/api-url";
import { isAdminEmail } from "@/lib/admin";
import { getSessionHeaders } from "@/lib/session";

type Status = "idle" | "locating" | "loading" | "ready" | "error";

type GuideOperation = {
  id: number;
  controller: AbortController;
};

type CompassStatus = "idle" | "active" | "denied" | "unsupported";

type CompassOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
};

type PermissionAwareOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const emptyGuide: GuideContent = {
  placeName: "",
  subtitle: "",
  era: "",
  overview: "",
  story: "",
  facts: [],
  nearby: [],
  question: "",
  sourceUrls: [],
};

const silentAudio =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

function speechChunks(text: string) {
  const chunks: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const next = `${current} ${word}`.trim();
    if (next.length <= 200) {
      current = next;
    } else {
      if (current) chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function bearingDegrees(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const toRadians = Math.PI / 180;
  const toDegrees = 180 / Math.PI;
  const latitudeARadians = latitudeA * toRadians;
  const latitudeBRadians = latitudeB * toRadians;
  const longitudeDelta = (longitudeB - longitudeA) * toRadians;
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeBRadians);
  const x =
    Math.cos(latitudeARadians) * Math.sin(latitudeBRadians) -
    Math.sin(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * toDegrees + 360) % 360;
}

function compassDirection(degrees: number) {
  const directions = ["sever", "severovýchod", "východ", "jihovýchod", "jih", "jihozápad", "západ", "severozápad"];
  return directions[Math.round(degrees / 45) % directions.length];
}

type GuideAppProps = {
  userEmail: string;
  onLogout: () => void;
};

export function GuideApp({ userEmail, onLogout }: GuideAppProps) {
  const [place, setPlace] = useState<Place | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<Coordinates | null>(null);
  const [guide, setGuide] = useState<GuideContent>(welcomeGuide);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [mapSelectionRequest, setMapSelectionRequest] = useState(0);
  const [question, setQuestion] = useState("");
  const [systemSpeaking, setSystemSpeaking] = useState(false);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [compassStatus, setCompassStatus] = useState<CompassStatus>("idle");
  const speechRunRef = useRef(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const operationIdRef = useRef(0);
  const guideControllerRef = useRef<AbortController | null>(null);
  const compassCleanupRef = useRef<(() => void) | null>(null);
  const guideScrollRef = useRef<HTMLDivElement | null>(null);
  const closeAdmin = useCallback(() => setAdminOpen(false), []);

  const handleOrientation = useCallback((rawEvent: Event) => {
    const event = rawEvent as CompassOrientationEvent;
    let heading: number | null = null;
    if (Number.isFinite(event.webkitCompassHeading)) {
      heading = Number(event.webkitCompassHeading);
    } else if (event.absolute && Number.isFinite(event.alpha)) {
      heading = (360 - Number(event.alpha)) % 360;
    }
    if (heading === null) return;

    const legacyOrientation = (window as Window & { orientation?: number })
      .orientation;
    const screenAngle =
      window.screen.orientation?.angle ??
      (Number.isFinite(legacyOrientation) ? Number(legacyOrientation) : 0);
    const correctedHeading = (heading + screenAngle + 360) % 360;
    setCompassHeading((current) => {
      if (current === null) return correctedHeading;
      const difference = Math.abs(
        ((correctedHeading - current + 540) % 360) - 180,
      );
      return difference < 1 ? current : correctedHeading;
    });
    setCompassStatus("active");
  }, []);

  const startCompass = useCallback(() => {
    compassCleanupRef.current?.();
    const listener = handleOrientation as EventListener;
    window.addEventListener("deviceorientationabsolute", listener);
    window.addEventListener("deviceorientation", listener);
    compassCleanupRef.current = () => {
      window.removeEventListener("deviceorientationabsolute", listener);
      window.removeEventListener("deviceorientation", listener);
    };
  }, [handleOrientation]);

  useEffect(() => {
    if (!("DeviceOrientationEvent" in window)) {
      setCompassStatus("unsupported");
    } else {
      const orientationEvent =
        DeviceOrientationEvent as PermissionAwareOrientationEvent;
      if (typeof orientationEvent.requestPermission !== "function") {
        startCompass();
      }
    }

    return () => {
      guideControllerRef.current?.abort();
      compassCleanupRef.current?.();
      speechRunRef.current += 1;
      window.speechSynthesis?.cancel();
    };
  }, [startCompass]);

  async function enableCompass() {
    if (!("DeviceOrientationEvent" in window)) {
      setCompassStatus("unsupported");
      return;
    }

    try {
      const orientationEvent =
        DeviceOrientationEvent as PermissionAwareOrientationEvent;
      if (
        typeof orientationEvent.requestPermission === "function" &&
        (await orientationEvent.requestPermission()) !== "granted"
      ) {
        setCompassStatus("denied");
        return;
      }
      startCompass();
    } catch {
      setCompassStatus("denied");
    }
  }

  const clearPreviousGuide = useCallback(() => {
    guideControllerRef.current?.abort();
    guideControllerRef.current = null;
    operationIdRef.current += 1;
    speechRunRef.current += 1;
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    setSystemSpeaking(false);
    setGuide(welcomeGuide);
    setPlace(null);
    setRouteOrigin(null);
    setStatus("idle");
    setMessage("");
  }, []);

  function beginGuideOperation(
    nextStatus: Extract<Status, "locating" | "loading">,
    nextPlace: Place | null,
  ): GuideOperation {
    guideControllerRef.current?.abort();
    const operation = {
      id: operationIdRef.current + 1,
      controller: new AbortController(),
    };
    operationIdRef.current = operation.id;
    guideControllerRef.current = operation.controller;
    setGuide(emptyGuide);
    setPlace(nextPlace);
    setStatus(nextStatus);
    setMessage("");
    stopSystemSpeech();
    return operation;
  }

  function isCurrentOperation(operation: GuideOperation) {
    return (
      operation.id === operationIdRef.current &&
      !operation.controller.signal.aborted
    );
  }

  async function loadGuide(
    nextPlace: Place,
    nextQuestion?: string,
    existingOperation?: GuideOperation,
  ) {
    const operation =
      existingOperation ?? beginGuideOperation("loading", nextPlace);
    if (!isCurrentOperation(operation)) return;

    setPlace(nextPlace);
    setStatus("loading");
    try {
      const response = await fetch(apiUrl("/api/guide"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
        },
        body: JSON.stringify({
          ...nextPlace,
          question: nextQuestion,
        }),
        signal: operation.controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!isCurrentOperation(operation)) return;
      setGuide(data);
      setStatus("ready");
    } catch (reason) {
      if (
        operation.controller.signal.aborted ||
        operation.id !== operationIdRef.current
      ) {
        return;
      }
      setStatus("error");
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Průvodce se nepodařilo načíst.",
      );
    }
  }

  async function resolvePlace(
    coordinates: Pick<Place, "latitude" | "longitude" | "accuracy">,
    signal?: AbortSignal,
  ): Promise<Place> {
    try {
      const response = await fetch(
        apiUrl(
          `/api/geocode?lat=${coordinates.latitude}&lon=${coordinates.longitude}`,
        ),
        { headers: getSessionHeaders(), signal },
      );
      const data = await response.json();
      if (response.ok && data.label) {
        return { ...coordinates, label: data.label };
      }
    } catch {
      // Souřadnice zůstávají použitelné i bez čitelného názvu místa.
    }

    return {
      ...coordinates,
      label: `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`,
    };
  }

  function locate() {
    if (!navigator.geolocation) {
      setMessage("Tento prohlížeč neumí zjistit polohu. Zadejte místo ručně.");
      setSearchOpen(true);
      return;
    }
    setRouteOrigin(null);
    const operation = beginGuideOperation("locating", null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (!isCurrentOperation(operation)) return;
        const coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        const nextPlace = await resolvePlace(
          coordinates,
          operation.controller.signal,
        );
        if (!isCurrentOperation(operation)) return;
        await loadGuide(nextPlace, undefined, operation);
      },
      () => {
        if (!isCurrentOperation(operation)) return;
        guideControllerRef.current = null;
        setGuide(welcomeGuide);
        setStatus("idle");
        setMessage(
          "Polohu se nepodařilo získat. Můžete ji povolit v prohlížeči nebo zadat místo ručně.",
        );
        setSearchOpen(true);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 },
    );
  }

  function stopSystemSpeech() {
    speechRunRef.current += 1;
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    setSystemSpeaking(false);
  }

  async function selectMapPoint(coordinates: {
    latitude: number;
    longitude: number;
  }) {
    const coordinatePlace: Place = {
      ...coordinates,
      label: `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`,
    };
    const operation = beginGuideOperation("loading", coordinatePlace);
    const nextPlace = await resolvePlace(
      coordinates,
      operation.controller.signal,
    );
    if (!isCurrentOperation(operation)) return;
    await loadGuide(
      { ...nextPlace, exactPoint: true },
      undefined,
      operation,
    );
  }

  function spokenGuideText() {
    return `${guide.placeName}. ${guide.overview} ${guide.story} ${guide.facts
      .map((fact) => `${fact.title}. ${fact.text}`)
      .join(" ")}`;
  }

  function toggleSystemSpeech() {
    if (!("speechSynthesis" in window)) {
      setMessage("Tento prohlížeč systémové čtení nepodporuje.");
      return;
    }
    if (systemSpeaking) {
      stopSystemSpeech();
      setMessage("");
      return;
    }

    const chunks = speechChunks(spokenGuideText());
    const run = speechRunRef.current + 1;
    speechRunRef.current = run;
    const voices = window.speechSynthesis.getVoices();
    const voice =
      voices.find(
        (candidate) =>
          candidate.lang.toLowerCase() === "cs-cz" && candidate.localService,
      ) ??
      voices.find((candidate) => candidate.lang.toLowerCase() === "cs-cz") ??
      voices.find((candidate) => candidate.lang.toLowerCase().startsWith("cs"));

    const speak = (index: number) => {
      if (speechRunRef.current !== run) return;
      if (index >= chunks.length) {
        utteranceRef.current = null;
        setSystemSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = "cs-CZ";
      utterance.rate = 0.95;
      if (voice) utterance.voice = voice;
      utterance.onend = () => speak(index + 1);
      utterance.onerror = (event) => {
        if (speechRunRef.current !== run) return;
        utteranceRef.current = null;
        setSystemSpeaking(false);
        if (event.error !== "canceled" && event.error !== "interrupted") {
          setMessage("Systémový hlas se nepodařilo spustit.");
        }
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };

    setMessage("");
    setSystemSpeaking(true);
    speak(0);
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!place || !question.trim()) return;
    const nextQuestion = question;
    setQuestion("");
    await loadGuide(place, nextQuestion);
  }

  async function exploreNearby(item: NearbyPlace) {
    if (
      !Number.isFinite(item.latitude) ||
      !Number.isFinite(item.longitude)
    ) {
      return;
    }
    if (place) {
      setRouteOrigin({
        latitude: place.latitude,
        longitude: place.longitude,
      });
    }
    guideScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    guideScrollRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    await loadGuide({
      exactPoint: true,
      label: item.name,
      latitude: item.latitude,
      longitude: item.longitude,
    });
  }

  const isBusy = status === "locating" || status === "loading";
  const hasDirectionalNearby = guide.nearby.some(
    (item) =>
      Number.isFinite(item.latitude) && Number.isFinite(item.longitude),
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Místopis domů">
          <span className="brand-mark">
            <Compass size={20} />
          </span>
          <span>Místopis</span>
        </a>
        <nav className="topnav" aria-label="Hlavní navigace">
          <button onClick={() => setSearchOpen(true)} type="button">
            <Search size={16} /> Najít místo
          </button>
          {isAdminEmail(userEmail) && (
            <button
              className="admin-nav-button"
              onClick={() => setAdminOpen(true)}
              type="button"
            >
              <ShieldCheck size={16} /> Administrace
            </button>
          )}
          <span className="signed-in-email" title={userEmail}>
            {userEmail}
          </span>
          <button
            className="icon-button"
            onClick={onLogout}
            type="button"
            aria-label="Odhlásit se"
            title="Odhlásit se"
          >
            <LogOut size={18} />
          </button>
        </nav>
      </header>

      <div className="workspace">
        <MapView
          mapSelectionRequest={mapSelectionRequest}
          onRelocate={locate}
          onSelectionStart={clearPreviousGuide}
          onSelectPoint={selectMapPoint}
          place={place}
          routeOrigin={routeOrigin}
        />

        <section className="guide-panel">
          <div className="guide-scroll" ref={guideScrollRef}>
            <div className="location-line">
              <MapPin size={15} />
              <span>{place?.label ?? "Poloha zatím není určená"}</span>
              {place?.accuracy && (
                <small>přesnost ±{Math.round(place.accuracy)} m</small>
              )}
            </div>

            <p className="eyebrow">{guide.era}</p>
            <h1>{guide.placeName}</h1>
            <p className="subtitle">{guide.subtitle}</p>

            {isBusy ? (
              <div className="loading-story">
                <LoaderCircle className="spin" size={25} />
                <div>
                  <strong>
                    {status === "locating"
                      ? "Hledám vaši polohu…"
                      : "Odkrývám příběh místa…"}
                  </strong>
                  <span>Ověřuji místní souvislosti a zajímavosti.</span>
                </div>
              </div>
            ) : status === "error" ? null : (
              <>
                <p className="overview">{guide.overview}</p>

                <div className="audio-actions">
                  <button
                    className="listen-button system-voice-button"
                    disabled={!place || status !== "ready"}
                    onClick={toggleSystemSpeech}
                    type="button"
                  >
                    <span className="listen-icon">
                      {systemSpeaking ? (
                        <CircleStop size={21} />
                      ) : (
                        <Volume2 size={21} />
                      )}
                    </span>
                    <span>
                      <strong>
                        {systemSpeaking
                          ? "Zastavit systémový hlas"
                          : "Přečíst systémovým hlasem"}
                      </strong>
                      <small>Zdarma · hlas tohoto zařízení</small>
                    </span>
                  </button>
                </div>

                <article className="story">
                  <span className="drop-cap">{guide.story.charAt(0)}</span>
                  {guide.story.slice(1)}
                </article>

                <div className="facts-grid">
                  {guide.facts.map((fact, index) => (
                    <article key={`${fact.title}-${index}`}>
                      <span>
                        {index === 0 ? (
                          <Landmark size={18} />
                        ) : index === 1 ? (
                          <Sparkles size={18} />
                        ) : (
                          <BookOpenText size={18} />
                        )}
                      </span>
                      <h2>{fact.title}</h2>
                      <p>{fact.text}</p>
                    </article>
                  ))}
                </div>

                {guide.nearby.length > 0 && (
                  <section className="nearby">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">JEŠTĚ KOUSEK DÁL</p>
                        <h2>Objevte v okolí</h2>
                      </div>
                      <Compass size={24} />
                    </div>
                    {hasDirectionalNearby && (
                      <div className="compass-control">
                        {compassStatus === "active" ? (
                          <span>
                            <Compass size={14} />
                            Šipky reagují na natočení telefonu
                          </span>
                        ) : compassStatus === "idle" ? (
                          <button onClick={enableCompass} type="button">
                            <Compass size={14} />
                            Zapnout kompas
                          </button>
                        ) : (
                          <span>
                            <Compass size={14} />
                            Šipky zatím ukazují směr vůči severu
                          </span>
                        )}
                      </div>
                    )}
                    <div className="nearby-list">
                      {guide.nearby.map((item) => {
                        const isSelectable =
                          Number.isFinite(item.latitude) &&
                          Number.isFinite(item.longitude);
                        const bearing =
                          place &&
                          isSelectable
                            ? bearingDegrees(
                                place.latitude,
                                place.longitude,
                                item.latitude,
                                item.longitude,
                              )
                            : null;
                        const rotation =
                          bearing === null
                            ? 0
                            : (bearing - (compassHeading ?? 0) + 360) % 360;
                        const content = (
                          <>
                            <span
                              aria-label={
                                bearing === null
                                  ? "Směr není dostupný"
                                  : `Směr: ${compassDirection(bearing)}`
                              }
                              className="nearby-direction"
                              title={
                                bearing === null
                                  ? "Směr není dostupný"
                                  : `Směr k cíli: ${compassDirection(bearing)}`
                              }
                            >
                              <ArrowUp
                                size={19}
                                style={{ transform: `rotate(${rotation}deg)` }}
                              />
                            </span>
                            <span className="nearby-dot" />
                            <span className="nearby-copy">
                              <strong>{item.name}</strong>
                              <small>{item.kind}</small>
                            </span>
                            <em>{item.distance}</em>
                            {isSelectable && (
                              <ArrowRight
                                aria-hidden="true"
                                className="nearby-open"
                                size={16}
                              />
                            )}
                          </>
                        );
                        return isSelectable ? (
                          <button
                            aria-label={`Prozkoumat ${item.name}, ${item.distance}`}
                            className="nearby-item"
                            key={item.name}
                            onClick={() => exploreNearby(item)}
                            type="button"
                          >
                            {content}
                          </button>
                        ) : (
                          <div className="nearby-item" key={item.name}>
                            {content}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {guide.sourceUrls.length > 0 && (
                  <details className="sources">
                    <summary>
                      Zdroje a další čtení <ChevronDown size={16} />
                    </summary>
                    <ul>
                      {guide.sourceUrls.map((url) => (
                        <li key={url}>
                          <a href={url} rel="noreferrer" target="_blank">
                            {new URL(url).hostname.replace("www.", "")}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {place && status === "ready" && (
                  <section className="change-place-card">
                    <div>
                      <p className="eyebrow">DALŠÍ BOD ZÁJMU</p>
                      <h2>Chcete prozkoumat jiné místo?</h2>
                      <p>
                        Vyhledejte konkrétní adresu nebo posuňte mapu pod pevný
                        bod a potvrďte přesnou polohu.
                      </p>
                    </div>
                    <div className="change-place-actions">
                      <button
                        onClick={() => setSearchOpen(true)}
                        type="button"
                      >
                        <Search size={17} />
                        Vyhledat místo
                      </button>
                      <button
                        onClick={() =>
                          setMapSelectionRequest((request) => request + 1)
                        }
                        type="button"
                      >
                        <MapPin size={17} />
                        Vybrat bod na mapě
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}

            {message && (
              <div className="notice" role="status">
                <CircleStop size={18} />
                <span>{message}</span>
                {status === "error" && place && (
                  <button onClick={() => loadGuide(place)} type="button">
                    <RotateCcw size={15} /> Zkusit znovu
                  </button>
                )}
              </div>
            )}

            {!place && !isBusy && (
              <div className="start-card">
                <div className="start-icon">
                  <LocateFixed size={29} />
                </div>
                <div>
                  <h2>Začněte tam, kde právě jste</h2>
                  <p>
                    Poloha se neposílá nikam jinam než službám potřebným pro
                    vytvoření průvodce.
                  </p>
                </div>
                <button onClick={locate} type="button">
                  Použít moji polohu <ArrowRight size={18} />
                </button>
                <button
                  className="text-button"
                  onClick={() => setSearchOpen(true)}
                  type="button"
                >
                  Místo raději zadám ručně
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    setMapSelectionRequest((request) => request + 1)
                  }
                  type="button"
                >
                  Nebo vyberu přesný bod na mapě
                </button>
              </div>
            )}
          </div>

          <form className="ask-bar" onSubmit={ask}>
            <Headphones size={19} />
            <input
              disabled={!place || isBusy}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                place ? "Zeptejte se na toto místo…" : "Nejprve určete místo"
              }
              value={question}
            />
            <button disabled={!place || !question.trim() || isBusy} type="submit">
              <ArrowRight size={18} />
              <span className="sr-only">Odeslat otázku</span>
            </button>
          </form>
        </section>
      </div>

      <LocationSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearchStart={clearPreviousGuide}
        onSelect={(nextPlace) =>
          loadGuide({ ...nextPlace, exactPoint: true })
        }
      />
      {isAdminEmail(userEmail) && (
        <AdminPanel open={adminOpen} onClose={closeAdmin} />
      )}
    </main>
  );
}
