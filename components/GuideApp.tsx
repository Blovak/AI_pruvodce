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

type Status = "idle" | "locating" | "loading" | "ready" | "error";

export function GuideApp() {
  const [place, setPlace] = useState<Place | null>(null);
  const [guide, setGuide] = useState<GuideContent>(welcomeGuide);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  async function loadGuide(nextPlace: Place, nextQuestion?: string) {
    setPlace(nextPlace);
    setStatus("loading");
    setMessage("");
    stopAudio();
    try {
      const response = await fetch(apiUrl("/api/guide"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    setAudioPlaying(false);
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  async function toggleAudio() {
    if (audioRef.current) {
      if (audioPlaying) {
        audioRef.current.pause();
        setAudioPlaying(false);
      } else {
        await audioRef.current.play();
        setAudioPlaying(true);
      }
      return;
    }

    setAudioLoading(true);
    setMessage("");
    try {
      const spokenText = `${guide.placeName}. ${guide.overview} ${guide.story} ${guide.facts
        .map((fact) => `${fact.title}. ${fact.text}`)
        .join(" ")}`;
      const response = await fetch(apiUrl("/api/speech"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spokenText }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error);
      }
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.onended = () => setAudioPlaying(false);
      audio.onerror = () => {
        stopAudio();
        setMessage("Zvuk se nepodařilo přehrát.");
      };
      await audio.play();
      setAudioPlaying(true);
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

                <button
                  className="listen-button"
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
                      {audioPlaying ? "Pozastavit vyprávění" : "Poslechnout příběh"}
                    </strong>
                    <small>Čte AI hlas · přibližně 2 minuty</small>
                  </span>
                  <Volume2 size={18} />
                </button>

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
