"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Snapshot } from "@/data/snapshot";
import type { Profile } from "@/engine/scoring";
import { Engine, type EngineResult } from "@/lib/engine-client";
import { track } from "@/lib/firebase";
import { useLive } from "@/lib/live";
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

const RECOMPUTE_MS = 5 * 60_000;

export function AppProvider({ children }: { children: ReactNode }) {
  const engine = useRef<Engine | null>(null);
  const live = useLive();
  const snapshot = live.snapshot;
  const [result, setResult] = useState<EngineResult | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  // Bumped periodically so time-dependent estimates (queue batches, booking pace) move on even when the data doesn't.
  const [tick, setTick] = useState(0);
  const job = useRef(0);

  // Load the visitor's profile (URL > localStorage > defaults) after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileState(loadProfile());
  }, []);

  useEffect(() => {
    engine.current = new Engine();
    return () => engine.current?.dispose();
  }, []);

  useEffect(() => {
    const bump = () => document.visibilityState === "visible" && setTick((n) => n + 1);
    const t = setInterval(bump, RECOMPUTE_MS);
    document.addEventListener("visibilitychange", bump);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", bump);
    };
  }, []);

  useEffect(() => {
    if (snapshot) engine.current?.setSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot || !profile || !engine.current) return;
    const my = ++job.current;
    const t = setTimeout(() => {
      setComputing(true);
      engine.current!
        .compute(profile)
        .then((r) => {
          if (my === job.current) {
            setResult(r);
            setComputeError(null);
          }
        })
        .catch((e) => setComputeError(String(e)))
        .finally(() => my === job.current && setComputing(false));
    }, 250);
    return () => clearTimeout(t);
  }, [snapshot, profile, tick]);

  const error = live.error ?? computeError;

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
