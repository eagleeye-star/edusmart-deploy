// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — Cloud sync setup & device linking
// ═══════════════════════════════════════════════════════════════
// Handles turning cloud sync ON for a device that may already have
// real local data (Gilbert's existing Eikwe install, for example).
// This is deliberately separate from the sync engine itself — it's
// a one-time setup flow, not something that runs on every write.
// ═══════════════════════════════════════════════════════════════

const DEVICE_LINK_KEY = "edusmart_cloud_link_v1";

export function getDeviceLink(storage) {
  try { return JSON.parse(storage.getItem(DEVICE_LINK_KEY) || "null"); }
  catch (e) { return null; }
}

// Used on every app launch to silently re-authenticate this device
// without the user seeing anything — the visible login screen is
// still just name+PIN, checked against whichever school this
// credential pair is linked to.
export function getDeviceCredentials(storage) {
  const link = getDeviceLink(storage);
  if (!link) return null;
  return { email: link.deviceEmail, password: link.devicePassword };
}

function saveDeviceLink(storage, link) {
  storage.setItem(DEVICE_LINK_KEY, JSON.stringify(link));
}

/**
 * First-time setup: creates a brand new school in the cloud and links
 * this device to it. Used when nobody has enabled cloud sync for this
 * school yet.
 */
export async function setUpNewCloudSchool({ auth, storage, schoolName, deviceEmail, devicePassword }) {
  const existing = getDeviceLink(storage);
  if (existing) throw new Error("This device is already linked to a school. Unlink first if you need to change it.");

  await auth.signUpAndSignIn(deviceEmail, devicePassword);
  const schoolId = await auth.registerSchool(schoolName);

  saveDeviceLink(storage, { schoolId, deviceEmail, devicePassword, linkedAt: new Date().toISOString() });
  return schoolId;
}

/**
 * Links this device to a school that ALREADY has cloud sync enabled
 * (e.g. a teacher's laptop joining after the office PC set it up).
 * Uses the same device credentials the first device created.
 */
export async function linkExistingCloudSchool({ auth, storage, deviceEmail, devicePassword }) {
  const existing = getDeviceLink(storage);
  if (existing) throw new Error("This device is already linked to a school.");

  const session = await auth.signIn(deviceEmail, devicePassword);
  const schoolId = await auth.getLinkedSchoolId();
  if (!schoolId) throw new Error("Signed in, but this login isn't linked to any school yet.");

  saveDeviceLink(storage, { schoolId, deviceEmail, devicePassword, linkedAt: new Date().toISOString() });
  return schoolId;
}

/**
 * One-time migration: takes whatever is currently in the OLD local-only
 * storage (students/attendance/grades/fees from before cloud sync
 * existed) and feeds it into the sync engine so it gets pushed to the
 * cloud as this school's starting dataset. Safe to call on an engine
 * with nothing in it yet (a fresh school) — it just won't find
 * anything to migrate.
 *
 * client_id is set equal to the record's own existing id (not a
 * derived/prefixed value) — this matters because the app's UI keeps
 * its own state keyed by id, and incoming realtime updates need to
 * match back against that same key. If client_id didn't equal id, a
 * remote change to a migrated record would look like a brand new
 * record to the app instead of an update to the existing one.
 *
 * Idempotency: re-running this (e.g. app restarts mid-migration)
 * upserts the same rows again rather than duplicating them, since
 * client_id (= the original id) doesn't change between runs.
 */
export async function migrateLocalDataIntoSync({ engine, oldLocalData }) {
  const results = {};
  const tables = ["students", "attendance", "grades", "fees"];

  for (const table of tables) {
    const oldRows = oldLocalData[table] || [];
    let migrated = 0;
    for (const row of oldRows) {
      engine.upsertLocal(table, { ...row, client_id: row.id });
      migrated++;
    }
    results[table] = migrated;
  }
  return results;
}

export function isCloudSyncEnabled(storage) {
  return !!getDeviceLink(storage);
}

export function unlinkDevice(storage) {
  storage.removeItem(DEVICE_LINK_KEY);
}
