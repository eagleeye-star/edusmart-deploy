// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — Cloud sync setup & device linking
// ═══════════════════════════════════════════════════════════════
// Handles turning cloud sync ON for a device that may already have
// real local data (Gilbert's existing Eikwe install, for example).
// This is deliberately separate from the sync engine itself — it's
// a one-time setup flow, not something that runs on every write.
// ═══════════════════════════════════════════════════════════════

const DEVICE_LINK_KEY = "edusmart_cloud_link_v1";

// Auto-generates a device email + password so nobody has to invent
// (or remember) either one — this is what gets packaged into a
// Connect Code. The email needs to pass Supabase's format validator,
// which rejects made-up TLDs like .local (found the hard way earlier
// in this project), so it uses a realistic-looking domain instead —
// it's never actually emailed to anyone.
export function generateDeviceCredentials() {
  const rand = () => Math.random().toString(36).slice(2);
  const email = `edusmart.${rand()}${Date.now().toString(36)}@gmail.com`;
  const password = `${rand()}${rand()}${rand()}`.slice(0, 24);
  return { deviceEmail: email, devicePassword: password };
}

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

  // Auto-generate credentials unless explicitly provided (tests still
  // pass their own for determinism) — the admin never invents or
  // types an email/password; they just get shown a Connect Code
  // afterward that packages these up for other devices to use.
  const creds = (deviceEmail && devicePassword) ? { deviceEmail, devicePassword } : generateDeviceCredentials();

  await auth.signUpAndSignIn(creds.deviceEmail, creds.devicePassword);
  const schoolId = await auth.registerSchool(schoolName);

  saveDeviceLink(storage, { schoolId, deviceEmail: creds.deviceEmail, devicePassword: creds.devicePassword, linkedAt: new Date().toISOString() });
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
  const tables = ["students", "attendance", "grades", "fees", "staff"];

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

// Used by the "Add This Device" first-run path: connects to a school
// that already has Cloud Sync running elsewhere, and pulls down
// everything needed to populate a brand new device from scratch —
// staff (so the login screen has real names to pick from), plus
// students/attendance/grades/fees. No admin account gets created and
// no school details get re-entered — this device just becomes another
// window into the same school.
export async function joinExistingSchoolAndPullData({ auth, storage, remote, deviceEmail, devicePassword }) {
  const schoolId = await linkExistingCloudSchool({ auth, storage, deviceEmail, devicePassword });
  try {
    const pulled = {};
    for (const table of ["staff", "students", "attendance", "grades", "fees"]) {
      pulled[table] = await remote.fetchAll(table);
    }
    return { schoolId, pulled };
  } catch (err) {
    // The device got linked successfully, but pulling the actual data
    // failed partway through — leaving it "linked" with no data would
    // be a dead end (retrying would just say "already linked," with no
    // way back in without knowing to clear browser storage manually).
    // Roll back the link so a retry starts clean and can actually
    // succeed once whatever caused the failure is fixed.
    unlinkDevice(storage);
    throw err;
  }
}

export function unlinkDevice(storage) {
  storage.removeItem(DEVICE_LINK_KEY);
}
