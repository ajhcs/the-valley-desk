import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { signedFactText, uniqueCitations, type CitableFact } from "../lib/entityFacts";

export type SignedLine = {
  id: string;
  name: string;
  facts: CitableFact[];
};

const GRACE_MS = 160;

type DekInsertValue = {
  canInsert: boolean;
  line: SignedLine | null;
  show: (line: SignedLine, tick: HTMLElement | null) => void;
  hide: () => void;
  close: () => void;
  lineRef: React.RefObject<HTMLSpanElement | null>;
};

const DekInsertContext = createContext<DekInsertValue>({
  canInsert: false,
  line: null,
  show: () => {},
  hide: () => {},
  close: () => {},
  lineRef: { current: null },
});

export function useDekInsert() {
  return useContext(DekInsertContext);
}

/** Home Lead only. Rails and ItemPage do not insert. */
export function LeadDekInsert({ children }: { children: ReactNode }) {
  const [line, setLine] = useState<SignedLine | null>(null);
  const lineRef = useRef<HTMLSpanElement | null>(null);
  const tickRef = useRef<HTMLElement | null>(null);
  const hideTimer = useRef(0);

  const show = (next: SignedLine, tick: HTMLElement | null) => {
    window.clearTimeout(hideTimer.current);
    tickRef.current = tick;
    setLine(next);
  };
  const close = () => {
    window.clearTimeout(hideTimer.current);
    tickRef.current = null;
    setLine(null);
  };
  const hide = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      if (tickRef.current?.contains(active) || lineRef.current?.contains(active)) return;
      close();
    }, GRACE_MS);
  };

  useEffect(() => {
    if (!line) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (tickRef.current?.contains(target) || lineRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [line]);

  const value = useMemo<DekInsertValue>(
    () => ({ canInsert: true, line, show, hide, close, lineRef }),
    [line],
  );
  return <DekInsertContext.Provider value={value}>{children}</DekInsertContext.Provider>;
}

export function LeadSignedLine() {
  const { line, lineRef, show, hide } = useDekInsert();
  if (!line?.facts.length) return null;
  const fact = line.facts[0];
  const cites = uniqueCitations(line.facts);
  return (
    <span
      ref={lineRef}
      className="Lead-signed"
      onMouseEnter={() => show(line, null)}
      onMouseLeave={hide}
    >
      {" "}
      <span className="Lead-signedTick" aria-hidden="true" />
      {line.name} {signedFactText(fact)}
      {cites.map((cite) => (
        <span key={cite.url}>
          {" · "}
          <a href={cite.url} target="_blank" rel="noopener noreferrer">
            {cite.name}
          </a>
        </span>
      ))}
    </span>
  );
}
