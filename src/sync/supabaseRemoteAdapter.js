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
const LOCAL_ONLY_FIELDS = ["_syncStatus", "_localUpdatedAt"];

function stripLocalFields(payload) {
  const clean = { ...payload };
  LOCAL_ONLY_FIELDS.forEach(f => delete clean[f]);
  return clean;
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
        const staffFieldsList = cleaned.map(({ pin, ...rest }) => rest);
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
      const { error } = await supabaseClient.from(table).upsert(cleaned, { onConflict: "school_id,client_id" });
      if (error) throw error;
    },

    async verifyPin(staffId, pin) {
      const { data, error } = await supabaseClient.rpc("verify_staff_pin", { p_staff_id: staffId, p_pin: pin });
      if (error) throw error;
      return data === true;
    },

    async fetchAll(table, sinceIso) {
      let query = supabaseClient.from(table).select("*").is("deleted_at", null);
      if (sinceIso) query = query.gte("updated_at", sinceIso);
      const { data, error } = await query;
      if (error) throw error;
      return data;
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
        principalName: data.principal_name,
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
        principal_name: schoolInfo.principalName,
      }).eq("id", schoolId);
      if (error) throw error;
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
