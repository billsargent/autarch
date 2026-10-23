"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import "./village/village.css";
import { villageFonts } from "./village/fonts";

// Only same-site paths, so a crafted link can't bounce you elsewhere after signing in.
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/village";
}

// The town gate: sign in, or on first run choose the owner password using
// the setup code printed in the server's console.
export default function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [mode, setMode] = useState<"loading" | "setup" | "signin">("loading");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((s: { passwordSet: boolean; signedIn: boolean }) => {
        if (s.signedIn) router.replace(next);
        else setMode(s.passwordSet ? "signin" : "setup");
      })
      .catch(() => setError("Couldn't reach the server."));
  }, [next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "setup" && password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "setup" ? { code, password } : { password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        if (res.status === 409) setMode(mode === "setup" ? "signin" : "setup");
        return;
      }
      // A full load, so every page starts with the new cookie.
      window.location.assign(next);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-3 py-2 text-sm text-[#3b2716] outline-none focus:border-[#d9643a]";

  return (
    <div
      className={`${villageFonts} village-root flex min-h-screen items-center justify-center p-4`}
      style={{ background: "#2f4a2a url(/village/scenes/village.png) center / cover", imageRendering: "pixelated" }}
    >
      <form
        onSubmit={submit}
        className="village-panel w-full max-w-sm overflow-hidden rounded-lg border-4 border-[#3b2716] bg-[#f4ead5] text-[#3b2716] shadow-2xl"
        style={{ imageRendering: "auto" }}
      >
        <div className="border-b-4 border-[#3b2716] bg-[#6b4a2e] px-4 py-3 text-[#f4ead5]">
          <p className="village-pixel text-[10px] uppercase tracking-wider text-[#e9d6ae]">The town gate</p>
          <h1 className="village-pixel text-base">{mode === "setup" ? "Choose the owner's password" : "Welcome back"}</h1>
        </div>
        <div className="space-y-3 p-4">
          {mode === "loading" && !error && <p className="text-sm">Checking the gate…</p>}
          {mode === "setup" && (
            <>
              <p className="text-sm">
                No password is set yet. Enter the setup code printed in the server&apos;s console, then choose a password (at
                least 8 characters).
              </p>
              <label className="block text-xs font-semibold">
                Setup code
                <input
                  className={`${input} mt-1 font-mono uppercase`}
                  name="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  autoFocus
                  required
                />
              </label>
            </>
          )}
          {mode !== "loading" && (
            <label className="block text-xs font-semibold">
              Password
              <input
                type="password"
                className={`${input} mt-1`}
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "setup" ? "new-password" : "current-password"}
                autoFocus={mode === "signin"}
                minLength={mode === "setup" ? 8 : undefined}
                required
              />
            </label>
          )}
          {mode === "setup" && (
            <label className="block text-xs font-semibold">
              Password again
              <input
                type="password"
                className={`${input} mt-1`}
                name="confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
          )}
          {error && (
            <p role="alert" className="rounded border-2 border-[#b3261e] bg-[#fbe3df] px-3 py-2 text-xs text-[#7a1a14]">
              {error}
            </p>
          )}
        </div>
        {mode !== "loading" && (
          <div className="flex justify-end border-t-2 border-[#d8c49a] bg-[#ead9b4] px-4 py-3">
            <button type="submit" disabled={busy} className="village-btn village-btn-primary px-4 py-2 text-xs">
              {busy ? "…" : mode === "setup" ? "Set password and enter" : "Enter the village"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
