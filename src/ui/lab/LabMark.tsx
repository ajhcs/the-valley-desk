import { useEffect, useState } from "react";

const SESSION_KEY = "vd-lab-mark-motion";
let playedWithoutStorage = false;

function claimMotion(reduced: boolean) {
  if (reduced) return false;

  try {
    if (window.sessionStorage.getItem(SESSION_KEY)) return false;
    window.sessionStorage.setItem(SESSION_KEY, "1");
    return true;
  } catch {
    // A blocked sessionStorage must not make every Lab route replay the mark.
    if (playedWithoutStorage) return false;
    playedWithoutStorage = true;
    return true;
  }
}

/** Animate the real production mark once per session, then leave it at rest. */
export function LabMark() {
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMotion(claimMotion(reduce.matches));
    const onChange = () => {
      if (reduce.matches) setMotion(false);
    };
    reduce.addEventListener("change", onChange);
    return () => reduce.removeEventListener("change", onChange);
  }, []);

  return (
    <span className={motion ? "LabMark is-motion" : "LabMark"} aria-hidden="true">
      <img src="/mark-a-fold.svg" alt="" width={36} height={36} />
    </span>
  );
}

export function LabLockup() {
  return (
    <div className="LabLockup">
      <LabMark />
      <span className="Wordmark">
        <span className="Wordmark-kicker">The</span>
        <span className="Wordmark-name">Valley Desk</span>
      </span>
    </div>
  );
}
