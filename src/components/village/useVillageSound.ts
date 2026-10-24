"use client";

import { useEffect, useRef, useState } from "react";
import type { DayPhase } from "@/lib/agent/daynight";

// Sound in the village: quiet music by day and by night, a chime when
// something waits for your approval, and a coin for a new letter. Off until
// you switch it on (remembered in this browser). Music from the Ninja
// Adventure pack (CC0), see public/village/CREDITS.md.

const KEY = "autarch-sound";
const MUSIC_VOLUME = 0.22;

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function useVillageSound(phase: DayPhase, pending: number, unread: number) {
  const [on, setOn] = useState(false);
  const music = useRef<HTMLAudioElement | null>(null);
  const last = useRef({ pending, unread });

  // Read the saved choice after mounting (no localStorage on the server).
  useEffect(() => {
    const t = setTimeout(() => setOn(stored()), 0);
    return () => clearTimeout(t);
  }, []);

  // The music follows the clock: night music at night, day music otherwise.
  const track = phase === "night" ? "/village/audio/night.ogg" : "/village/audio/day.ogg";
  useEffect(() => {
    if (!on) {
      music.current?.pause();
      return;
    }
    const audio = music.current ?? new Audio();
    music.current = audio;
    if (!audio.src.endsWith(track)) audio.src = track;
    audio.loop = true;
    audio.volume = MUSIC_VOLUME;
    // Browsers only start sound after a click or key; try now, else on the next one.
    const start = () => void audio.play().catch(() => {});
    audio.play().catch(() => {
      window.addEventListener("pointerdown", start, { once: true });
      window.addEventListener("keydown", start, { once: true });
    });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, [on, track]);

  // Little sounds when something new arrives.
  useEffect(() => {
    const before = last.current;
    last.current = { pending, unread };
    if (!on) return;
    const play = (src: string) => {
      const a = new Audio(src);
      a.volume = 0.5;
      void a.play().catch(() => {});
    };
    if (pending > before.pending) play("/village/audio/alert.wav");
    else if (unread > before.unread) play("/village/audio/letter.wav");
  }, [on, pending, unread]);

  useEffect(() => () => music.current?.pause(), []);

  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem(KEY, v ? "off" : "on");
      } catch {
        /* the choice just won't be remembered */
      }
      return !v;
    });
  return { soundOn: on, toggleSound: toggle };
}
