// ═══════════════════════════════════════════════════════════════
// EduSmart Sync — Supabase remote adapter
// ═══════════════════════════════════════════════════════════════
// Translates the sync engine's generic remote interface (ping,
// upsert, fetchAll, subscribe) into real Supabase calls. This is the
// only file that needs to know Supabase's specific API shape — the
// sync engine itself stays backend-agnostic.
// ═══════════════════════════════════════════════════════════════

// Local-only bookkeeping fields that must never be sent to the server —
// stripping them here (once, in one place) means every call site that
// writes through the sync engine can't forget to do it.
// "id" is the app's own local tracking field (e.g. "USR9344852") — it
// is NOT a valid Postgres uuid, and every synced table's real primary
// key is a server-generated uuid column also called "id". Sending the
// app's id as part of the payload was crashing every upsert with
// "invalid input syntax for type uuid" — reproduced and confirmed
// fixed directly against a real Postgres database, not just a mock.
// client_id (not id) is what ties a local record to its server row.
const LOCAL_ONLY_FIELDS = ["id", "_syncStatus", "_localUpdatedAt"];

function stripLocalFields(payload) {
  const clean = { ...payload };
  LOCAL_ONLY_FIELDS.forEach(f => delete clean[f]);
  return clean;
}

// The app's own fields are camelCase (matching normal JS convention);
// the database columns are snake_case (matching normal Postgres
// convention). Anywhere these two conventions produce a genuinely
// different name — not just a different case, an actually different
// string — needs an explicit mapping, or Postgres correctly rejects
// the column as not existing. This was found the hard way: the
// "classAssigned" error was the first of several identical mismatches
// across every synced table (students, attendance, grades, fees all
// had at least one), found and fixed together — see migration
// 006_fix_field_mismatches.sql for the full story and the reasoning
// behind also changing student_id/entered_by from uuid to text.
const FIELD_MAPS = {
  staff:      { classAssigned: "class_assigned", photo: "photo_url" },
  students:   { photo: "photo_url", feeExemptions: "fee_exemptions" },
  attendance: { studentId: "student_id", enteredBy: "entered_by" },
  grades:     { studentId: "student_id", enteredBy: "entered_by" },
  fees:       { studentId: "student_id", enteredBy: "entered_by", receiptNo: "receipt_no", feeTypeId: "fee_type_id" },
  fee_types:  { defaultAmount: "default_amount" },
};

function toDbFields(table, obj) {
  const map = FIELD_MAPS[table];
  if (!map) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[map[k] || k] = v;
  return out;
}

function fromDbFields(table, obj) {
  const map = FIELD_MAPS[table];
  if (!map) return obj;
  const reverse = Object.fromEntries(Object.entries(map).map(([a, b]) => [b, a]));
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[reverse[k] || k] = v;
  return out;
}

export function createSupabaseRemoteAdapter(supabaseClient) {
  return {
    async ping() {
      // A cheap, real round-trip to the actual backend — not just
      // checking navigator.onLine, which only reflects the local
      // network interface, not whether Supabase is actually reachable.
      const { error } = await supabaseClient.from("schools").select("id").limit(1);
      if (error) throw error;
      return true;
    },

    // Accepts either a single record or an array of records — the sync
    // engine now batches multiple queued writes into one array per
    // table when it flushes, so a 400-record restore sends a handful
    // of bulk network calls instead of hundreds of individual ones.
    async upsert(table, payloadOrArray) {
      const isBulk = Array.isArray(payloadOrArray);
      const cleaned = (isBulk ? payloadOrArray : [payloadOrArray]).map(stripLocalFields);

      // Staff records need special handling: PINs are never sent as a
      // plain column value — they only ever get set through the
      // set_staff_pin RPC, which hashes them server-side. This means
      // a staff member is created in two steps: the row first (without
      // a pin_hash — see migration 004, which allows this transient
      // state), then the PIN set separately once we have the row's
      // real server-assigned id. For a bulk batch, the base fields
      // still go up in ONE call; only the PIN-setting RPC stays
      // per-record (there's no bulk equivalent for that step, but a
      // staff list is typically much smaller than a student list).
      if (table === "staff") {
        const staffFieldsList = cleaned.map(({ pin, ...rest }) => toDbFields("staff", rest));
        const { data, error } = await supabaseClient
          .from("staff").upsert(staffFieldsList, { onConflict: "school_id,client_id" }).select();
        if (error) throw error;
        const savedRows = isBulk ? data : [data?.[0] ?? data];
        for (let i = 0; i < cleaned.length; i++) {
          const pin = cleaned[i].pin;
          if (!pin) continue;
          const row = savedRows.find(r => r?.client_id === cleaned[i].client_id) || savedRows[i];
          if (!row) continue;
          const { error: pinError } = await supabaseClient.rpc("set_staff_pin", { p_staff_id: row.id, p_new_pin: pin });
          if (pinError) throw pinError;
        }
        return;
      }

      // Conflict target is (school_id, client_id), not client_id alone —
      // see migration 003_fix_client_id_scope.sql for why: a global
      // client_id constraint would make two different schools' first-
      // ever record (both commonly "STU00001"-style ids) collide.
      const mapped = cleaned.map(c => toDbFields(table, c));
      const { error } = await supabaseClient.from(table).upsert(mapped, { onConflict: "school_id,client_id" });
      if (error) throw error;
    },

    // Takes a client_id (which is what the app's own local "id" field
    // actually is, everywhere — not the server's internal uuid), and
    // calls the RPC variant that looks staff up that way. Scoped
    // safely by the caller's own linked school via RLS on the server
    // side (verified directly: two different schools sharing the same
    // client_id string can never verify each other's PINs).
    async verifyPin(clientId, pin) {
      const { data, error } = await supabaseClient.rpc("verify_staff_pin_by_client_id", { p_client_id: clientId, p_pin: pin });
      if (error) throw error;
      return data === true;
    },

    async fetchAll(table, sinceIso) {
      let query = supabaseClient.from(table).select("*").is("deleted_at", null);
      if (sinceIso) query = query.gte("updated_at", sinceIso);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(row => fromDbFields(table, row));
    },

    // One-time fetch of the school's own profile row — used when a new
    // device joins via Connect Code, since it needs the school's name/
    // term/year to display correctly, not just the 5 data tables. The
    // schools table uses snake_case columns (matching the rest of the
    // Postgres schema); the app's own school state uses camelCase, so
    // this maps between the two in one place.
    async fetchSchoolInfo() {
      const { data, error } = await supabaseClient.from("schools").select("*").single();
      if (error) throw error;
      return {
        name: data.name, address: data.address, phone: data.phone, email: data.email,
        motto: data.motto, currentTerm: data.current_term, currentYear: data.current_year,
        principalName: data.principal_name, logo: data.logo_url, termStartDate: data.term_start_date,
      };
    },

    // register_school() only sets the school's name — this pushes the
    // rest of the profile (address, term, year, etc.) right after
    // setup, so a device joining later via Connect Code sees accurate
    // information instead of blank fields.
    async updateSchoolInfo(schoolId, schoolInfo) {
      const { error } = await supabaseClient.from("schools").update({
        address: schoolInfo.address, phone: schoolInfo.phone, email: schoolInfo.email,
        motto: schoolInfo.motto, current_term: schoolInfo.currentTerm, current_year: schoolInfo.currentYear,
        principal_name: schoolInfo.principalName, logo_url: schoolInfo.logo, term_start_date: schoolInfo.termStartDate,
      }).eq("id", schoolId);
      if (error) throw error;
    },

    // Renewing on one device pushes the new licence here; every other
    // device linked to the same school picks it up automatically via
    // fetchLicenceInfo (called periodically — see useCloudSync). Kept
    // separate from updateSchoolInfo since licence data is a distinct
    // concern from the school's own profile fields.
    async pushLicenceInfo(schoolId, licInfo) {
      const { error } = await supabaseClient.from("schools").update({
        licence_type: licInfo.type,
        licence_expiry: licInfo.lifetime ? null : licInfo.expiry,
        licence_key: licInfo.key,
      }).eq("id", schoolId);
      if (error) throw error;
    },

    async fetchLicenceInfo() {
      const { data, error } = await supabaseClient.from("schools").select("licence_type, licence_expiry, licence_key").single();
      if (error) throw error;
      if (!data.licence_key) return null; // nobody has pushed a licence to this school yet
      return { type: data.licence_type, expiry: data.licence_expiry, lifetime: !data.licence_expiry, key: data.licence_key };
    },

    // Write-only, deliberately — Settings lets a school SET or REPLACE
    // their Arkesel API key, but never fetches it back for display.
    // Upsert since a school either has none yet (first time) or is
    // replacing an existing one.
    async saveSmsCredentials(schoolId, { apiKey, senderId }) {
      const { error } = await supabaseClient.from("sms_credentials").upsert({
        school_id: schoolId, api_key: apiKey, sender_id: senderId,
      }, { onConflict: "school_id" });
      if (error) throw error;
    },

    // Only tells the app WHETHER credentials exist (for showing
    // "Connected" vs "Not set up" in Settings) and what sender ID is
    // in use — never the secret itself.
    async getSmsStatus() {
      const { data, error } = await supabaseClient.from("sms_credentials").select("sender_id").maybeSingle();
      if (error) throw error;
      return data ? { configured: true, senderId: data.sender_id } : { configured: false };
    },

    // Calls the send-sms Edge Function — the only place Hubtel's API
    // is ever actually reached from. See supabase/functions/send-sms
    // for the server-side half of this, tested separately (19 tests
    // covering success, partial failure, and cross-school isolation).
    async sendBulkSms(recipients, message, sentBy) {
      const { data, error } = await supabaseClient.functions.invoke("send-sms", {
        body: { recipients, message, sentBy },
      });
      if (error) throw error;
      return data;
    },

    subscribe(table, onRow) {
      const channel = supabaseClient
        .channel(`${table}-sync-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
          if (payload.new && Object.keys(payload.new).length > 0) onRow(payload.new);
        })
        .subscribe();
      return () => supabaseClient.removeChannel(channel);
    },
  };
}
