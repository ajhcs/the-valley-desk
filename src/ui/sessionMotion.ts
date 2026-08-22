import { useState } from "react";

const KEY = "vd-home-session-motion";

/** Session-first homepage motion. Do not restagger on client nav back to /. */
export function useSessionFirstHome() {
  const [play] = useState(() => {
    if (typeof sessionStorage === "undefined") return false;
    try {
      if (sessionStorage.getItem(KEY)) return false;
      sessionStorage.setItem(KEY, "1");
      return true;
    } catch {
      return false;
    }
  });
  return play;
}
