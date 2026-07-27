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
  Pause,
  Play,
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

function requiresDirectAudioTap() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

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
  const [question, setQuestion] = useState("");
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [showNativeAudio, setShowNativeAudio] = useState(false);
  const [systemSpeaking, setSystemSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speechRunRef = useRef(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      audio?.pause();
      audio?.removeAttribute("src");
      audio?.load();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      speechRunRef.current += 1;
      window.speechSynthesis?.cancel();
    };
  }, []);

  async function loadGuide(nextPlace: Place, nextQuestion?: string) {
    setPlace(nextPlace);
    setStatus("loading");
    setMessage("");
    stopAllAudio();
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
        try {
          const response = await fetch(
            apiUrl(
              `/api/geocode?lat=${coordinates.latitude}&lon=${coordinates.longitude}`,
            ),
            { headers: getSessionHeaders() },
          );
          const data = await response.json();
          const nextPlace: Place = {
            ...coordinates,
            label: response.ok
              ? data.label
              : `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`,
          };
          await loadGuide(nextPlace);
        } catch {
          await loadGuide({
            ...coordinates,
            label: `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`,
          });
        }
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

  function stopMp3Audio() {
    const audio = audioRef.current;
    audio?.pause();
    audio?.removeAttribute("src");
    audio?.load();
    setAudioPlaying(false);
    setAudioReady(false);
    setShowNativeAudio(false);
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  function pauseMp3Audio() {
    audioRef.current?.pause();
    setAudioPlaying(false);
  }

  function stopSystemSpeech() {
    speechRunRef.current += 1;
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    setSystemSpeaking(false);
  }

  function stopAllAudio() {
    stopMp3Audio();
    stopSystemSpeech();
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

    pauseMp3Audio();
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

  async function toggleAudio() {
    const audio = audioRef.current;
    if (!audio) {
      setMessage("Přehrávač se nepodařilo připravit.");
      return;
    }

    stopSystemSpeech();
    if (audioReady) {
      if (audioPlaying) {
        audio.pause();
        setAudioPlaying(false);
      } else {
        try {
          audio.muted = false;
          audio.volume = 1;
          await audio.play();
          setAudioPlaying(true);
          setMessage("");
        } catch {
          setShowNativeAudio(true);
          setMessage(
            "Chrome čeká na ruční spuštění. Použijte ovládání přehrávače pod tlačítkem.",
          );
        }
      }
      return;
    }

    setAudioLoading(true);
    setMessage("");
    setShowNativeAudio(false);
    try {
      const spokenText = spokenGuideText();
      const response = await fetch(apiUrl("/api/speech"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
        },
        body: JSON.stringify({
          text: spokenText,
          cacheKey: guide.cache?.key,
          placeName: guide.placeName,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error);
      }
      const url = URL.createObjectURL(await response.blob());
      audioUrlRef.current = url;
      audio.src = url;
      audio.preload = "auto";
      audio.muted = false;
      audio.volume = 1;
      audio.load();
      setAudioReady(true);

      if (requiresDirectAudioTap()) {
        setShowNativeAudio(true);
        setMessage(
          "Zvuk je připravený. Klepněte na „Spustit připravený zvuk“ nebo na přehrát níže.",
        );
        return;
      }

      try {
        await audio.play();
        setAudioPlaying(true);
      } catch {
        setShowNativeAudio(true);
        setMessage(
          "Zvuk je připravený. Prohlížeč vyžaduje ještě jedno klepnutí na přehrát.",
        );
      }
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Zvuk se nepodařilo vytvořit.",
      );
    } finally {
      setAudioLoading(false);
    }
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
        <MapView place={place} onRelocate={locate} />

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
                    disabled={!place || status !== "ready" || audioLoading}
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

                  <button
                    className="listen-button mp3-button"
                    disabled={!place || status !== "ready" || audioLoading}
                    onClick={toggleAudio}
                    type="button"
                  >
                    <span className="listen-icon">
                      {audioLoading ? (
                        <LoaderCircle className="spin" size={21} />
                      ) : audioPlaying ? (
                        <Pause size={21} fill="currentColor" />
                      ) : (
                        <Play size={21} fill="currentColor" />
                      )}
                    </span>
                    <span>
                      <strong>
                        {audioLoading
                          ? "Připravuji MP3…"
                          : audioPlaying
                            ? "Pozastavit MP3"
                            : audioReady
                              ? "Spustit připravené MP3"
                              : "Vygenerovat nebo načíst MP3"}
                      </strong>
                      <small>
                        {audioLoading
                          ? "Vytvoření může trvat několik sekund"
                          : audioReady && !audioPlaying
                            ? "MP3 je načtené · klepněte pro přehrání"
                            : guide.cache?.audioAvailable
                              ? "Uložené MP3 · bez nového generování"
                              : "AI hlas · uloží se na Google Disk"}
                      </small>
                    </span>
                  </button>
                </div>
                <audio
                  className={`native-audio${showNativeAudio ? " is-visible" : ""}`}
                  controls
                  onEnded={() => setAudioPlaying(false)}
                  onPause={() => setAudioPlaying(false)}
                  onPlay={() => {
                    stopSystemSpeech();
                    if (audioReady) setAudioPlaying(true);
                  }}
                  playsInline
                  preload="none"
                  ref={audioRef}
                />

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
