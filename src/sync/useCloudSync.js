// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — useCloudSync hook
// ═══════════════════════════════════════════════════════════════
// Wires the sync engine into the app's EXISTING React state without
// replacing how Students/Attendance/Grades/Fees/Staff render or read
// data. Local writes go through writeThrough() alongside the app's
// normal setters (so the UI still updates instantly, unchanged);
// incoming remote/realtime changes get merged into that same state.
// When cloud sync isn't enabled, this hook does nothing and the app
// behaves exactly as it always has.
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from "react";
import { createSyncEngine } from "./syncEngine.js";
import { createSupabaseRemoteAdapter } from "./supabaseRemoteAdapter.js";
import { createSupabaseAuth } from "./supabaseAuth.js";
import { supabase } from "./supabaseClient.js";
import {
  isCloudSyncEnabled, getDeviceLink, getDeviceCredentials,
  setUpNewCloudSchool, linkExistingCloudSchool, migrateLocalDataIntoSync, unlinkDevice,
  joinExistingSchoolAndPullData,
} from "./cloudSyncSetup.js";
import { generateConnectCode, parseConnectCode } from "./connectCode.js";

const SYNCED_TABLES = ["students", "attendance", "grades", "fees", "staff"];
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
  // overwrites a row that has a local edit still waiting to sync.
  // Staff rows never carry a usable local `pin` field from the cloud
  // (PINs are only ever verified via the server, never compared
  // locally once cloud sync is on) — this is deliberate, not a bug;
  // see doLogin()'s cloud-aware branch in the main app.
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
  // setGrades/setFees/setUsers at each save point — a no-op when cloud
  // sync isn't enabled, so every existing call site stays safe to touch.
  const writeThrough = useCallback((table, record) => {
    if (!enabled || !engineRef.current) return;
    engineRef.current.upsertLocal(table, { ...record, client_id: record.client_id || record.id });
  }, [enabled]);

  // For bulk operations — restoring a backup, or anything touching many
  // records at once. Sends a handful of batched network calls (one per
  // table) instead of one call per record; see syncEngine's
  // upsertLocalBatch for why this matters (a few hundred records used
  // to mean a few hundred sequential network round-trips).
  const writeThroughBulk = useCallback((table, records) => {
    if (!enabled || !engineRef.current || !records?.length) return;
    engineRef.current.upsertLocalBatch(table, records.map(r => ({ ...r, client_id: r.client_id || r.id })));
  }, [enabled]);

  // Only meaningful once cloud sync is on — verifies a PIN against the
  // server-side hash rather than comparing plaintext locally. The
  // calling code (doLogin) falls back to local comparison when cloud
  // sync isn't enabled.
  const verifyPin = useCallback(async (staffId, pin) => {
    if (!enabled) return null; // caller should fall back to local comparison
    return remoteRef.current.verifyPin(staffId, pin);
  }, [enabled]);

  const enableNewSchool = useCallback(async ({ schoolName }) => {
    const schoolId = await setUpNewCloudSchool({ auth: authRef.current, storage: window.localStorage, schoolName });
    const engine = createSyncEngine({ storage: window.localStorage, remote: remoteRef.current, schoolId, onChange: () => {} });
    const results = await migrateLocalDataIntoSync({
      engine,
      oldLocalData: {
        students: appState.students, attendance: appState.attendance,
        grades: appState.grades, fees: appState.fees, staff: appState.staff,
      },
    });
    // Push the full school profile too (register_school only set the
    // name) — so a device joining later via Connect Code sees the
    // real address/term/year instead of blank fields.
    try { await remoteRef.current.updateSchoolInfo(schoolId, appState.school); } catch (e) { /* non-fatal — profile can be filled in later from Settings */ }

    const link = getDeviceLink(window.localStorage);
    const connectCode = generateConnectCode(link.deviceEmail, link.devicePassword);
    setEnabled(true);
    return { results, connectCode };
  }, [appState]);

  // The "Add This Device" flow — one code instead of an email+password
  // to invent and remember, and it also pulls down everything needed
  // to populate a brand new device: the school's own profile, staff
  // (so login has real names), students, attendance, grades, fees.
  const joinWithConnectCode = useCallback(async (code) => {
    const decoded = parseConnectCode(code);
    if (!decoded) throw new Error("That doesn't look like a valid Connect Code. Double-check it was copied in full.");
    const { pulled } = await joinExistingSchoolAndPullData({
      auth: authRef.current, storage: window.localStorage, remote: remoteRef.current,
      deviceEmail: decoded.deviceEmail, devicePassword: decoded.devicePassword,
    });
    try {
      const schoolInfo = await remoteRef.current.fetchSchoolInfo();
      appSetters.school(prev => ({ ...prev, ...schoolInfo }));
    } catch (e) { /* non-fatal — school name etc. can be filled in later */ }
    // Populate local state directly (not via mergeIntoAppState's
    // client_id-matching logic, since there's no existing local data
    // to merge against on a brand new device — this is a fresh load).
    if (pulled.staff?.length) appSetters.staff(pulled.staff.map(s => ({ ...s, id: s.client_id })));
    if (pulled.students?.length) appSetters.students(pulled.students.map(s => ({ ...s, id: s.client_id })));
    if (pulled.attendance?.length) appSetters.attendance(pulled.attendance.map(s => ({ ...s, id: s.client_id })));
    if (pulled.grades?.length) appSetters.grades(pulled.grades.map(s => ({ ...s, id: s.client_id })));
    if (pulled.fees?.length) appSetters.fees(pulled.fees.map(s => ({ ...s, id: s.client_id })));
    setEnabled(true);
    return pulled;
  }, [appSetters]);

  const linkToExistingSchool = useCallback(async ({ deviceEmail, devicePassword }) => {
    await linkExistingCloudSchool({ auth: authRef.current, storage: window.localStorage, deviceEmail, devicePassword });
    setEnabled(true);
  }, []);

  const getConnectCode = useCallback(() => {
    const link = getDeviceLink(window.localStorage);
    if (!link) return null;
    return generateConnectCode(link.deviceEmail, link.devicePassword);
  }, []);

  const disable = useCallback(() => {
    unlinkDevice(window.localStorage);
    engineRef.current = null;
    setEnabled(false);
  }, []);

  return {
    enabled, status, writeThrough, writeThroughBulk, verifyPin,
    enableNewSchool, joinWithConnectCode, linkToExistingSchool,
    getConnectCode, disable,
  };
}
