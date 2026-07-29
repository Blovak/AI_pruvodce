"use client";

import {
  ArrowRight,
  BookOpenText,
  ChevronDown,
  CircleStop,
  Compass,
  Headphones,
  Landmark,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Menu,
  RotateCcw,
  Search,
  Sparkles,
  Volume2,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { welcomeGuide } from "@/lib/fallback";
import type { GuideContent, Place } from "@/lib/types";
import { LocationSearch } from "@/components/LocationSearch";
import { MapView } from "@/components/MapView";
import { apiUrl } from "@/lib/api-url";
import { getSessionHeaders } from "@/lib/session";

type Status = "idle" | "locating" | "loading" | "ready" | "error";

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

export function GuideApp() {
  const [place, setPlace] = useState<Place | null>(null);
  const [guide, setGuide] = useState<GuideContent>(welcomeGuide);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mapSelectionRequest, setMapSelectionRequest] = useState(0);
  const [question, setQuestion] = useState("");
  const [systemSpeaking, setSystemSpeaking] = useState(false);
  const speechRunRef = useRef(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    return () => {
      speechRunRef.current += 1;
      window.speechSynthesis?.cancel();
    };
  }, []);

  async function loadGuide(nextPlace: Place, nextQuestion?: string) {
    setPlace(nextPlace);
    setStatus("loading");
    setMessage("");
    stopSystemSpeech();
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
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setGuide(data);
      setStatus("ready");
    } catch (reason) {
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
  ): Promise<Place> {
    try {
      const response = await fetch(
        apiUrl(
          `/api/geocode?lat=${coordinates.latitude}&lon=${coordinates.longitude}`,
        ),
        { headers: getSessionHeaders() },
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
    setStatus("locating");
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        await loadGuide(await resolvePlace(coordinates));
      },
      () => {
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
    await loadGuide(await resolvePlace(coordinates));
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

  const isBusy = status === "locating" || status === "loading";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Místopis domů">
          <span className="brand-mark">
            <Compass size={20} />
          </span>
          <span>Místopis</span>
          <em>BETA</em>
        </a>
        <nav className="topnav" aria-label="Hlavní navigace">
          <button onClick={() => setSearchOpen(true)} type="button">
            <Search size={16} /> Najít místo
          </button>
          <button className="icon-button" type="button" aria-label="Menu">
            <Menu size={20} />
          </button>
        </nav>
      </header>

      <div className="workspace">
        <MapView
          mapSelectionRequest={mapSelectionRequest}
          onRelocate={locate}
          onSelectPoint={selectMapPoint}
          place={place}
        />

        <section className="guide-panel">
          <div className="guide-scroll">
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
            ) : (
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
                    <div className="nearby-list">
                      {guide.nearby.map((item) => (
                        <div key={item.name}>
                          <span className="nearby-dot" />
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.kind}</small>
                          </span>
                          <em>{item.distance}</em>
                        </div>
                      ))}
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
        onSelect={(nextPlace) => loadGuide(nextPlace)}
      />
    </main>
  );
}
