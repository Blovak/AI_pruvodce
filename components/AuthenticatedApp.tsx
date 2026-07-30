"use client";

import {
  ArrowLeft,
  Compass,
  LoaderCircle,
  LockKeyhole,
  Mail,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { GuideApp } from "@/components/GuideApp";
import { apiUrl } from "@/lib/api-url";
import {
  forgetAuthToken,
  getAuthToken,
  getSessionHeaders,
  rememberAuthToken,
} from "@/lib/session";

type AuthStep = "checking" | "email" | "code" | "authenticated";

export function AuthenticatedApp() {
  const [step, setStep] = useState<AuthStep>("checking");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setStep("email");
      return;
    }

    const controller = new AbortController();
    fetch(apiUrl("/api/auth/session"), {
      headers: getSessionHeaders(),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          error?: string;
          user?: { email?: string };
        };
        if (response.status === 401) {
          forgetAuthToken();
          setStep("email");
          return;
        }
        if (!response.ok) {
          throw new Error(data.error || "Relaci se nepodařilo ověřit.");
        }
        if (!data.user?.email) throw new Error("Odpověď serveru není platná.");
        setUserEmail(data.user.email);
        setStep("authenticated");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage(
          "Přihlášení se teď nepodařilo ověřit. Zkontrolujte připojení a zkuste to znovu.",
        );
        setStep("email");
      });
    return () => controller.abort();
  }, []);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiUrl("/api/auth/request-code"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { error?: string; email?: string };
      if (!response.ok) throw new Error(data.error);
      setEmail(data.email || email.trim().toLowerCase());
      setCode("");
      setStep("code");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Přihlašovací kód se nepodařilo odeslat.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code) || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiUrl("/api/auth/verify-code"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await response.json()) as {
        error?: string;
        token?: string;
        user?: { email?: string };
      };
      if (!response.ok || !data.token || !data.user?.email) {
        throw new Error(data.error || "Kód se nepodařilo ověřit.");
      }
      rememberAuthToken(data.token);
      setUserEmail(data.user.email);
      setStep("authenticated");
      setCode("");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Kód se nepodařilo ověřit.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await fetch(apiUrl("/api/auth/logout"), {
        method: "POST",
        headers: getSessionHeaders(),
      });
    } finally {
      forgetAuthToken();
      setUserEmail("");
      setCode("");
      setMessage("");
      setStep("email");
    }
  }

  if (step === "authenticated") {
    return <GuideApp onLogout={logout} userEmail={userEmail} />;
  }

  if (step === "checking") {
    return (
      <main className="auth-shell">
        <div className="auth-checking">
          <LoaderCircle className="spin" size={30} />
          <p>Ověřuji přihlášení…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand" aria-label="Místopis">
          <span><Compass size={24} /></span>
          Místopis
          <em>BETA</em>
        </div>
        <div className="auth-icon">
          {step === "email" ? <Mail size={27} /> : <LockKeyhole size={27} />}
        </div>
        <p className="eyebrow">VÁŠ OSOBNÍ PRŮVODCE</p>
        <h1 id="auth-title">
          {step === "email" ? "Přihlášení e-mailem" : "Zadejte kód z e-mailu"}
        </h1>
        <p className="auth-intro">
          {step === "email"
            ? "Pošleme vám jednorázový šestimístný kód. Heslo nepotřebujete a na tomto zařízení si vás budeme pamatovat."
            : `Šestimístný kód jsme poslali na ${email}. Platí 10 minut.`}
        </p>

        {step === "email" ? (
          <form className="auth-form" onSubmit={requestCode}>
            <label htmlFor="auth-email">E-mailová adresa</label>
            <div className="auth-input">
              <Mail size={18} />
              <input
                autoComplete="email"
                autoFocus
                disabled={busy}
                id="auth-email"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="vas@email.cz"
                required
                type="email"
                value={email}
              />
            </div>
            <button disabled={busy || !email.trim()} type="submit">
              {busy && <LoaderCircle className="spin" size={17} />}
              Poslat přihlašovací kód
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <label htmlFor="auth-code">Přihlašovací kód</label>
            <input
              aria-describedby="code-help"
              autoComplete="one-time-code"
              autoFocus
              className="code-input"
              disabled={busy}
              id="auth-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              pattern="[0-9]{6}"
              placeholder="000000"
              value={code}
            />
            <small id="code-help">Kód obsahuje přesně 6 číslic.</small>
            <button disabled={busy || code.length !== 6} type="submit">
              {busy && <LoaderCircle className="spin" size={17} />}
              Přihlásit se
            </button>
            <div className="auth-secondary-actions">
              <button
                disabled={busy}
                onClick={() => {
                  setMessage("");
                  setStep("email");
                }}
                type="button"
              >
                <ArrowLeft size={15} /> Změnit e-mail
              </button>
              <button disabled={busy} onClick={() => requestCode()} type="button">
                Poslat nový kód
              </button>
            </div>
          </form>
        )}

        {message && (
          <p className="auth-message" role="alert">
            {message}
          </p>
        )}
        <p className="auth-privacy">
          E-mail používáme pouze pro přihlášení. Přihlašovací kód ani token
          zařízení neukládáme v čitelné podobě.
        </p>
      </section>
    </main>
  );
}
