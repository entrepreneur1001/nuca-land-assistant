"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Snapshot } from "@/data/snapshot";
import type { Profile } from "@/engine/scoring";
import { subscribeSnapshot } from "@/lib/data";
import { Engine, type EngineResult } from "@/lib/engine-client";
import { track } from "@/lib/firebase";
import { loadProfile, sanitize, saveProfile } from "@/lib/profile";

interface AppState {
  snapshot: Snapshot | null;
  result: EngineResult | null;
  profile: Profile;
  setProfile: (p: Profile) => void;
  computing: boolean;
  error: string | null;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const engine = useRef<Engine | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = useRef(0);

  // Load the visitor's profile (URL > localStorage > defaults) after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileState(loadProfile());
  }, []);

  useEffect(() => {
    engine.current = new Engine();
    const unsub = subscribeSnapshot(
      (s) => {
        engine.current?.setSnapshot(s);
        setSnapshot(s);
        setError(null);
      },
      (e) => setError(/quota|resource-exhausted/i.test(e.message) ? "quota" : e.message === "no-data" ? "no-data" : "load"),
    );
    return () => {
      unsub();
      engine.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!snapshot || !profile || !engine.current) return;
    const my = ++job.current;
    const t = setTimeout(() => {
      setComputing(true);
      engine.current!
        .compute(profile)
        .then((r) => {
          if (my === job.current) setResult(r);
        })
        .catch((e) => setError(String(e)))
        .finally(() => my === job.current && setComputing(false));
    }, 250);
    return () => clearTimeout(t);
  }, [snapshot, profile]);

  const setProfile = useCallback((p: Profile) => {
    const clean = sanitize(p);
    setProfileState(clean);
    saveProfile(clean);
    void track("profile_updated", { rank: clean.bookingRank ?? "", paid: clean.moneyPaid ?? "" });
  }, []);

  const value = useMemo<AppState | null>(
    () => (profile ? { snapshot, result, profile, setProfile, computing, error } : null),
    [snapshot, result, profile, setProfile, computing, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState | null {
  return useContext(Ctx);
}
