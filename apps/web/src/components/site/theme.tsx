"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "theme";

/**
 * Runs before paint (inlined in <head>) so the chosen theme applies without a flash.
 * Light is the default; only an explicit choice switches to dark.
 */
export const themeInitScript = `try{var t=localStorage.getItem("${KEY}");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

const listeners = new Set<() => void>();
const read = (): Theme => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // private mode: the choice simply isn't remembered
  }
  listeners.forEach((l) => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "light" as Theme,
  );
  return { theme, setTheme };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "حالت روشن" : "حالت تیره"}
      title={dark ? "حالت روشن" : "حالت تیره"}
      className={`relative flex size-10 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 ${className}`}
    >
      <Sun aria-hidden className={`size-[18px] transition-all duration-300 ${dark ? "scale-50 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"}`} />
      <Moon aria-hidden className={`absolute size-[18px] transition-all duration-300 ${dark ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-90 opacity-0"}`} />
    </button>
  );
}
