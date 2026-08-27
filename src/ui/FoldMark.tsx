import { useEffect, useState } from "react";
import { persistSessionFold, shouldPlaySessionFold } from "./sessionMotion";

export const FOLD_REST = {
  left: "6,10 34,10 26,54 4,54",
  right: "30,10 58,10 60,54 32,54",
  crease: "30,10 36,10 32,54 26,54",
} as const;

/** Compact production fold. Geometry matches public/mark-a-fold.svg at rest. */
export function FoldMark({ className }: { className?: string } = {}) {
  const [play, setPlay] = useState(() => shouldPlaySessionFold());

  useEffect(() => {
    if (!play) return;
    const persistId = window.setTimeout(() => persistSessionFold(), 0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (reduce.matches) {
        persistSessionFold();
        setPlay(false);
      }
    };
    reduce.addEventListener("change", onChange);
    return () => {
      window.clearTimeout(persistId);
      reduce.removeEventListener("change", onChange);
    };
  }, [play]);

  const classes = ["MarkFold", className, play ? "is-session-fold" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={36} height={36} focusable="false">
        <polygon className="MarkFold-left" fill="#21145F" points={FOLD_REST.left} />
        <polygon className="MarkFold-right" fill="#1E22AA" points={FOLD_REST.right} />
        <polygon className="MarkFold-crease" fill="#54C0E8" points={FOLD_REST.crease} />
      </svg>
    </span>
  );
}
