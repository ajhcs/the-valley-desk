import { createContext, useContext, useMemo, type ReactNode } from "react";

type MentionScopeValue = {
  claimed: Set<string>;
  claim: (id: string) => boolean;
};

const MentionScopeContext = createContext<MentionScopeValue | null>(null);

/** View-scoped first-mention claims. Remount with key={pathname}. */
export function MentionScope({ children }: { children: ReactNode }) {
  const value = useMemo<MentionScopeValue>(() => {
    const claimed = new Set<string>();
    return {
      claimed,
      claim(id: string) {
        if (claimed.has(id)) return false;
        claimed.add(id);
        return true;
      },
    };
  }, []);
  return <MentionScopeContext.Provider value={value}>{children}</MentionScopeContext.Provider>;
}

export function useMentionScope() {
  return useContext(MentionScopeContext);
}
