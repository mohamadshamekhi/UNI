// Server-safe (no "use client"): inlined in <head> so the chosen theme applies before paint.
// Light is the default; only an explicit choice switches to dark.
export const THEME_KEY = "theme";
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_KEY}");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;
