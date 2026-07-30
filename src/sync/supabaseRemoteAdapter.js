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

    async upsert(table, payload) {
      const clean = stripLocalFields(payload);

      // Staff records need special handling: PINs are never sent as a
      // plain column value — they only ever get set through the
      // set_staff_pin RPC, which hashes them server-side. This means
      // a brand new staff member is created in two steps: the row
      // first (without a pin_hash — see migration 004, which allows
      // this transient state), then the PIN set separately once we
      // have the row's real server-assigned id.
      if (table === "staff") {
        const { pin, ...staffFields } = clean;
        const { data, error } = await supabaseClient
          .from("staff").upsert(staffFields, { onConflict: "school_id,client_id" }).select().single();
        if (error) throw error;
        if (pin) {
          const { error: pinError } = await supabaseClient.rpc("set_staff_pin", { p_staff_id: data.id, p_new_pin: pin });
          if (pinError) throw pinError;
        }
        return;
      }

      // Conflict target is (school_id, client_id), not client_id alone —
      // see migration 003_fix_client_id_scope.sql for why: a global
      // client_id constraint would make two different schools' first-
      // ever record (both commonly "STU00001"-style ids) collide.
      const { error } = await supabaseClient.from(table).upsert(clean, { onConflict: "school_id,client_id" });
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
