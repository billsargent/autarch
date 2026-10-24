"use client";

import { useEffect, useState } from "react";
import ParchmentDialog from "./ParchmentDialog";

// The first visit to the village: a short welcome, once per browser. If no
// model key is set yet, that comes first, since nothing works without it.

const KEY = "autarch-welcome-seen";

export default function WelcomeDialog() {
  const [show, setShow] = useState(false);
  const [keySet, setKeySet] = useState<boolean | null>(null);

  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(KEY) === "yes";
    } catch {
      /* no storage: don't nag */
    }
    if (seen) return;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setKeySet(Boolean(d.settings?.apiKeySet));
        setShow(true);
      })
      .catch(() => {});
  }, []);

  if (!show) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "yes");
    } catch {
      /* it'll show again next time */
    }
    setShow(false);
  };
  return (
    <ParchmentDialog kicker="Autarch" title="Welcome to your village" onClose={close}>
      <div className="space-y-2 text-sm">
        <p>
          The villagers here are AI agents that work on this computer for you. Everything you can do has a place in the village;
          walk around with the arrow keys or WASD, or just click.
        </p>
        {keySet === false && (
          <p className="rounded border-2 border-[#c58a1b] bg-[#fdf3dc] p-2">
            <strong>First:</strong> give the village a model to think with. Go into <strong>your home</strong> (bottom right), use{" "}
            <strong>your computer</strong>, open the Mayor&apos;s ledger and enter a key under <strong>Identity &amp; model</strong>.
          </p>
        )}
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Talk to the Mayor</strong>: click them, or walk up and press T. They look after the village.
          </li>
          <li>
            <strong>Your desk</strong> at home holds what needs you: approvals, hire requests, letters and drafts.
          </li>
          <li>
            Nothing risky runs without your say, and the village has a <strong>daily budget</strong> (Mayor&apos;s ledger → Limits).
          </li>
        </ul>
      </div>
      <button onClick={close} className="village-btn village-btn-primary mt-3 px-4 py-2 text-xs">
        Let&apos;s go
      </button>
    </ParchmentDialog>
  );
}
