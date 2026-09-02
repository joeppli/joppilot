import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AppMode, isLocalOriginAvailable, readStoredMode, storeMode } from './mode';

/**
 * Developer escape hatch: `?mode=local` on a localhost origin.
 *
 * The gate deliberately offers only operator and demo — a third button would
 * be noise for every real visitor. But the documented local workflow (services
 * + edge + `pnpm dev`) still needs a way into local mode, and burying it behind
 * a query parameter keeps it available without putting it on screen. The
 * origin check is the same one that makes local mode impossible on a public
 * deployment, so this cannot be used to point the hosted console at a
 * visitor's machine.
 */
function readModeFromUrl(): AppMode | null {
  try {
    const q = new URLSearchParams(window.location.search).get('mode');
    if (q === 'local' && isLocalOriginAvailable()) return 'local';
  } catch {
    /* malformed query string — ignore */
  }
  return null;
}

interface ModeValue {
  /** null = nothing chosen yet; the entry gate is showing. */
  mode: AppMode | null;
  select: (mode: AppMode) => void;
  /** Return to the entry gate (also used by sign-out). */
  reset: () => void;
}

const Ctx = createContext<ModeValue | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  // A returning visitor keeps their choice for the browser session, so a page
  // refresh does not throw an operator back to the gate mid-shift.
  const [mode, setMode] = useState<AppMode | null>(() => readModeFromUrl() ?? readStoredMode());

  const select = useCallback((m: AppMode) => {
    storeMode(m);
    setMode(m);
  }, []);

  const reset = useCallback(() => {
    storeMode(null);
    setMode(null);
  }, []);

  return <Ctx.Provider value={{ mode, select, reset }}>{children}</Ctx.Provider>;
}

export function useMode(): ModeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMode must be used inside <ModeProvider>');
  return v;
}
