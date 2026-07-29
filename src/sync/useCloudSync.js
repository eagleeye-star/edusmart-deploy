// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — useCloudSync hook
// ═══════════════════════════════════════════════════════════════
// Wires the sync engine into the app's EXISTING React state without
// replacing how Students/Attendance/Grades/Fees render or read data.
// Local writes go through writeThrough() alongside the app's normal
// setStudents/setAttendance/setGrades/setFees calls (so the UI still
// updates instantly, unchanged); incoming remote/realtime changes get
// merged into that same state via the app's own setters. When cloud
// sync isn't enabled, this hook does nothing and the app behaves
// exactly as it always has.
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from "react";
import { createSyncEngine } from "./syncEngine.js";
import { createSupabaseRemoteAdapter } from "./supabaseRemoteAdapter.js";
import { createSupabaseAuth } from "./supabaseAuth.js";
import { supabase } from "./supabaseClient.js";
import {
  isCloudSyncEnabled, getDeviceLink, getDeviceCredentials,
  setUpNewCloudSchool, linkExistingCloudSchool, migrateLocalDataIntoSync, unlinkDevice,
} from "./cloudSyncSetup.js";

const SYNCED_TABLES = ["students", "attendance", "grades", "fees"];
const FLUSH_INTERVAL_MS = 8000;

export function useCloudSync({ appState, appSetters }) {
  const [enabled, setEnabled] = useState(() => isCloudSyncEnabled(window.localStorage));
  const [status, setStatus] = useState({ phase: "disabled", pending: 0, lastError: null });

  const engineRef = useRef(null);
  const authRef = useRef(null);
  const remoteRef = useRef(null);
  if (!authRef.current) authRef.current = createSupabaseAuth(supabase);
  if (!remoteRef.current) remoteRef.current = createSupabaseRemoteAdapter(supabase);

  // Merges rows arriving from the cloud (initial pull or realtime) into
  // the app's existing React state, matched by client_id === id. Never
  // overwrites a row that has a local edit still waiting to sync — see
  // syncEngine.js's own mergeRemote for the same rule at the storage
  // layer; this is the same principle applied to the visible app state.
  const mergeIntoAppState = useCallback((table, rows) => {
    const setter = appSetters[table];
    if (!setter || !rows || rows.length === 0) return;
    setter(prev => {
      const byId = new Map(prev.map(r => [r.id, r]));
      rows.forEach(remoteRow => {
        const key = remoteRow.client_id;
        const existing = byId.get(key);
        if (existing && existing._syncStatus === "pending") return; // local edit not yet synced wins for now
        byId.set(key, { ...existing, ...remoteRow, id: key });
      });
      return Array.from(byId.values());
    });
  }, [appSetters]);

  useEffect(() => {
    if (!enabled) { setStatus({ phase: "disabled", pending: 0, lastError: null }); return; }
    let cancelled = false;
    let unsubs = [];
    let interval = null;

    (async () => {
      setStatus(s => ({ ...s, phase: "connecting" }));
      const link = getDeviceLink(window.localStorage);
      if (!link) { setEnabled(false); return; }

      try {
        const creds = getDeviceCredentials(window.localStorage);
        if (creds) await authRef.current.signIn(creds.email, creds.password);
      } catch (e) {
        // Not fatal — the engine below still works fully offline and
        // will pick up syncing again once reachability returns.
      }
      if (cancelled) return;

      const engine = createSyncEngine({
        storage: window.localStorage,
        remote: remoteRef.current,
        schoolId: link.schoolId,
        onChange: () => setStatus(s => ({ ...s, pending: engine.pendingCount() })),
      });
      engineRef.current = engine;

      for (const table of SYNCED_TABLES) {
        try {
          const rows = await remoteRef.current.fetchAll(table);
          if (!cancelled) mergeIntoAppState(table, rows);
        } catch (e) { /* offline on first launch — local data still shows via existing state */ }
      }
      if (cancelled) return;

      unsubs = SYNCED_TABLES.map(table =>
        remoteRef.current.subscribe(table, (row) => mergeIntoAppState(table, [row]))
      );

      const tick = async () => {
        const reachable = await engine.isReachable();
        if (reachable) await engine.flush();
        if (!cancelled) setStatus({ phase: reachable ? "online" : "offline", pending: engine.pendingCount(), lastError: null });
      };
      await tick();
      interval = setInterval(tick, FLUSH_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      unsubs.forEach(u => u());
      if (interval) clearInterval(interval);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called alongside the app's existing setStudents/setAttendance/
  // setGrades/setFees at each save point — a no-op when cloud sync
  // isn't enabled, so every existing call site stays safe to touch.
  const writeThrough = useCallback((table, record) => {
    if (!enabled || !engineRef.current) return;
    engineRef.current.upsertLocal(table, { ...record, client_id: record.client_id || record.id });
  }, [enabled]);

  const enableNewSchool = useCallback(async ({ schoolName, deviceEmail, devicePassword }) => {
    const schoolId = await setUpNewCloudSchool({ auth: authRef.current, storage: window.localStorage, schoolName, deviceEmail, devicePassword });
    const engine = createSyncEngine({ storage: window.localStorage, remote: remoteRef.current, schoolId, onChange: () => {} });
    const results = await migrateLocalDataIntoSync({
      engine,
      oldLocalData: {
        students: appState.students, attendance: appState.attendance,
        grades: appState.grades, fees: appState.fees,
      },
    });
    setEnabled(true);
    return results;
  }, [appState]);

  const linkToExistingSchool = useCallback(async ({ deviceEmail, devicePassword }) => {
    await linkExistingCloudSchool({ auth: authRef.current, storage: window.localStorage, deviceEmail, devicePassword });
    setEnabled(true);
  }, []);

  const disable = useCallback(() => {
    unlinkDevice(window.localStorage);
    engineRef.current = null;
    setEnabled(false);
  }, []);

  return { enabled, status, writeThrough, enableNewSchool, linkToExistingSchool, disable };
}
