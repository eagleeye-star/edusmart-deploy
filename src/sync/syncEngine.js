// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — Phase B+C: Offline-first sync engine
// ═══════════════════════════════════════════════════════════════
// This is the module that makes Students, Attendance, Grades, and
// Fees work identically whether the device is online or not.
//
// Design in one paragraph: every write goes to local storage first
// (instant, always works) and is queued for upload. A flush attempt
// runs periodically and whenever connectivity returns; it collapses
// multiple offline edits to the same record into a single upload
// (keyed by client_id, which every record gets the moment it's
// created — before it has ever touched the server). Remote changes
// arrive either via an explicit pull or a realtime subscription and
// are merged in using last-write-wins on updated_at, but never
// overwrite a local change that hasn't synced yet.
// ═══════════════════════════════════════════════════════════════

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {object} opts
 * @param {object} opts.storage - localStorage-like: getItem/setItem/removeItem
 * @param {object} opts.remote  - Supabase client wrapper (see remoteAdapter shape below)
 * @param {string} opts.schoolId - the school this device is linked to
 * @param {function} opts.onChange - called with (tableName) whenever local data for that table changes, so the UI can re-render
 */
export function createSyncEngine({ storage, remote, schoolId, onChange, autoFlush = true }) {
  const QUEUE_KEY = "edusmart_sync_queue_v1";
  const dataKey = (table) => `edusmart_sync_data_${table}_v1`;

  function loadTable(table) {
    try { return JSON.parse(storage.getItem(dataKey(table)) || "[]"); }
    catch (e) { return []; }
  }
  function saveTable(table, rows) {
    storage.setItem(dataKey(table), JSON.stringify(rows));
    onChange && onChange(table);
  }
  function loadQueue() {
    try { return JSON.parse(storage.getItem(QUEUE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveQueue(queue) {
    storage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function getAll(table) {
    return loadTable(table);
  }

  // record may or may not have a client_id yet — if not, this is a
  // brand new record and one is assigned right now, on-device.
  function upsertLocal(table, record) {
    const rows = loadTable(table);
    const clientId = record.client_id || uuid();
    const stamped = {
      ...record,
      client_id: clientId,
      school_id: schoolId,               // always stamped from the device's own linked school — never trusted from elsewhere
      _syncStatus: "pending",
      _localUpdatedAt: nowIso(),
    };
    const idx = rows.findIndex(r => r.client_id === clientId);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...stamped };
    else rows.push(stamped);
    saveTable(table, rows);

    // Collapse repeated edits to the same record into one queue entry —
    // five offline edits to the same grade should produce one upload,
    // with the final payload, not five.
    const queue = loadQueue();
    const qIdx = queue.findIndex(q => q.table === table && q.clientId === clientId);
    const entry = { table, clientId, payload: stamped, attempts: 0, queuedAt: nowIso() };
    if (qIdx >= 0) queue[qIdx] = { ...queue[qIdx], payload: stamped };
    else queue.push(entry);
    saveQueue(queue);

    if (autoFlush) flush(); // fire-and-forget; caller doesn't need to await this for the UI to feel instant
    return stamped;
  }

  // navigator.onLine only reflects "is a network interface up", not
  // "can we actually reach Supabase" — a school's router can show
  // connected while the internet itself is down. This does a real,
  // short-timeout check against the actual backend.
  async function isReachable() {
    try { return await remote.ping(); }
    catch (e) { return false; }
  }

  // A flush() call that arrives while one is already running doesn't
  // just no-op — it waits for the in-flight one to finish and returns
  // its result. This matters because upsertLocal() fires a background
  // flush automatically, so a caller doing `await engine.flush()`
  // shortly after a write must never get a false "done, nothing to do"
  // while that earlier attempt is still actually in progress.
  let inFlightFlush = null;
  async function flush() {
    if (inFlightFlush) return inFlightFlush;
    inFlightFlush = (async () => {
      try {
        const reachable = await isReachable();
        if (!reachable) return { pushed: 0, remaining: loadQueue().length, offline: true };

        let queue = loadQueue();
        let pushed = 0;
        const stillQueued = [];

        for (const entry of queue) {
          try {
            await remote.upsert(entry.table, entry.payload);
            const rows = loadTable(entry.table);
            const idx = rows.findIndex(r => r.client_id === entry.clientId);
            if (idx >= 0) rows[idx] = { ...rows[idx], _syncStatus: "synced" };
            saveTable(entry.table, rows);
            pushed++;
          } catch (e) {
            stillQueued.push({ ...entry, attempts: entry.attempts + 1, lastError: String(e?.message || e) });
          }
        }
        saveQueue(stillQueued);
        return { pushed, remaining: stillQueued.length };
      } finally {
        inFlightFlush = null;
      }
    })();
    return inFlightFlush;
  }

  // Never clobbers a local row that has unsynced changes pending —
  // those win locally until they've actually been pushed, so a
  // teacher's not-yet-synced edit can't vanish because a stale
  // remote snapshot arrived in the meantime.
  function mergeRemote(table, remoteRow) {
    const rows = loadTable(table);
    const idx = rows.findIndex(r => r.client_id === remoteRow.client_id);
    if (idx < 0) {
      rows.push({ ...remoteRow, _syncStatus: "synced" });
      saveTable(table, rows);
      return;
    }
    const local = rows[idx];
    if (local._syncStatus === "pending") return;
    const remoteTime = new Date(remoteRow.updated_at || 0).getTime();
    const localTime = new Date(local._localUpdatedAt || 0).getTime();
    if (remoteTime >= localTime) {
      rows[idx] = { ...remoteRow, _syncStatus: "synced" };
      saveTable(table, rows);
    }
  }

  async function pullRemote(table) {
    const rows = await remote.fetchAll(table);
    rows.forEach(r => mergeRemote(table, r));
  }

  function subscribeRealtime(table) {
    return remote.subscribe(table, (row) => mergeRemote(table, row));
  }

  function pendingCount() {
    return loadQueue().length;
  }

  function status() {
    const queue = loadQueue();
    return { pending: queue.length, erroring: queue.filter(q => q.attempts > 0).length };
  }

  return { getAll, upsertLocal, flush, pullRemote, subscribeRealtime, pendingCount, status, isReachable };
}
