"use client";

import { useCallback, useState } from "react";

// Approval requests the human chose to "decide later". Kept for the browser
// session so walking into another room doesn't bring the same prompt back;
// a new request still pops up.
const KEY = "autarch.deferredApprovals";

function read(): number[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

export function useDeferredApprovals(): [number[], (ids: number[]) => void] {
  const [deferred, setState] = useState<number[]>(() => (typeof window === "undefined" ? [] : read()));
  const setDeferred = useCallback((ids: number[]) => {
    setState(ids);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      /* private mode or storage blocked: remember for this page only */
    }
  }, []);
  return [deferred, setDeferred];
}
