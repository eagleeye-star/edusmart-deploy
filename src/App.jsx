import { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, AreaChart, ReferenceDot,
} from 'recharts';
import { SEED } from './data/seed';
import ROSS308 from './data/ross308_standard.json';
import {
  pullRemote, pushRemote, isCloudConfigured, getCloudConfig,
  saveCloudConfig, clearCloudConfig, testCloudConfig,
  getUser, signIn, signUp, signOut, resetPassword,
} from './sync';
import './App.css';

const STORAGE_KEY = 'aifarms_poultry_tracker_v1';

/**
 * Bump this whenever the shape of `data` changes in a way old code
 * couldn't safely read (a field renamed, a record type restructured — not
 * just a new optional field, since migrate() already defaults those). Every
 * backup file and cloud save carries the version it was written with, so a
 * restore or sync can tell "this is from a future version of the app" from
 * "this is just old and needs the usual defaults filled in" instead of
 * guessing from a timestamp alone.
 */
const SCHEMA_VERSION = 1;

const STANDARDS = {
  hyline_layer: SEED.feedStandard,
  ross308_broiler: ROSS308,
};

/* ---------------- utils ---------------- */

function todayISO() {
  // Local Y/M/D, not toISOString() (which is always UTC) — otherwise "today"
  // can read as tomorrow or yesterday for anyone west/east of UTC in the
  // evening/early morning. daysBetween() itself doesn't need this fix: ISO
  // date-only strings always parse as UTC regardless of device timezone, so
  // a difference between two of them is timezone-invariant already.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.round((d2 - d1) / 86400000);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  // Force UTC when reading the date back out — the ISO string was parsed as
  // UTC midnight, so rendering in the viewer's *local* zone can silently
  // shift the displayed day by one for anyone west of UTC.
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function num(v, digits = 0) {
  if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function feedPhaseForWeek(week, standard) {
  const list = standard || FEED_STANDARD;
  let phase = null;
  for (const r of list) {
    if (r.week > week) break;
    if (r.feedType) phase = r.feedType;
  }
  return phase;
}

function standardWeightForWeek(week, standard) {
  const list = standard || FEED_STANDARD;
  const exact = list.find((r) => r.week === week);
  if (exact) return exact.estWeightG;
  if (week < list[0].week) return null;
  if (week > list[list.length - 1].week) return list[list.length - 1].estWeightG;
  return null;
}

function polWeek(standard) {
  const list = standard || FEED_STANDARD;
  const layer = list.find((r) => (r.feedType || '').toLowerCase().includes('layer'));
  return layer ? layer.week : 21;
}

function fieldSoilDefaults() {
  // From the soil monitoring workbook — sensible bell-pepper defaults,
  // editable per field since soil and crop needs vary by plot.
  return {
    manureAppliedDate: null, currentBatchLabel: 'Batch 1',
    targetECMin: 1000, targetECMax: 2500,
    targetPHMin: 6.0, targetPHMax: 6.8,
    targetNMin: 150, targetNMax: 200,
    targetPMin: 40, targetPMax: 80,
    targetKMin: 150, targetKMax: 250,
  };
}

function defaultPepper() {
  return {
    fields: [
      { id: 'A', name: 'Field A', variety: '', transplantDate: '', plantCount: null, spacing: '', expectedHarvestDAT: 70, setupCost: null, notes: '', ...fieldSoilDefaults() },
      { id: 'B', name: 'Field B', variety: '', transplantDate: '', plantCount: null, spacing: '', expectedHarvestDAT: 70, setupCost: null, notes: '', ...fieldSoilDefaults() },
    ],
    scouting: [],
    sprays: [],
    harvests: [],
    inputs: [],          // agrochemical / fertiliser stock
    manureReadings: [],  // raw manure pile samples before mixing into soil
    soilReadings: [],    // per-field soil tests after manure mix, over time
    batches: [],         // closed planting cycles per field (history)
    nurseryBatches: [],  // seed-sowing through germination, before transplant
  };
}

function defaultGoats() {
  return {
    animals: [],        // herd registry — does, bucks, wethers, kids once tagged
    heats: [],           // heat/estrus observations per doe
    matings: [],         // buck x doe pairings, with inbreeding check result
    kiddings: [],        // birth records linked to a mating
    kidMortality: [],    // deaths of kids, pre/post weaning, with cause
    health: [],          // dewormings, vaccinations, FAMACHA, BCS, treatments — one shared log, filtered by `type`
    weights: [],         // periodic weight samples per animal
    sales: [],           // goat sales
  };
}

function tagEntries(arr, flockId) {
  // Every record needs BOTH a flock link and a stable id — older entries
  // (and a few record types before this fix) may be missing either, so
  // this repairs both without disturbing anything else about the record.
  return (arr || []).map((e) => {
    const withFlock = e.flockId ? e : { ...e, flockId };
    return withFlock.id ? withFlock : { ...withFlock, id: newId() };
  });
}

function makeLayerFlock(meta) {
  return { type: 'layer', standardKey: 'hyline_layer', setupCost: null, ...(meta || SEED.flock), id: 'layers' };
}

function makeBroilerFlock() {
  return {
    id: 'broilers', flockName: 'Broiler Batch — Ross 308', breed: 'Ross 308 (+ cockerels)', type: 'broiler',
    startDate: '2026-06-15', initialBirds: 69, location: 'Eikwe, Western Region',
    standardKey: 'ross308_broiler', setupCost: null,
  };
}

/** The farm identity shown in headers, invoices, and backups. This is the
    MIGRATION fallback only — it fills in the field for an account that
    already has real farm data saved from before this field existed. A
    brand-new account never hits this default; see freshData() below. */
function defaultFarmProfile() {
  return {
    farmName: 'AI Farms',
    location: 'Eikwe, Western Region',
    email: 'aifarms101@gmail.com',
    phone: '0597147460',
  };
}

/** Genuinely empty starter flocks for a brand-new account — no name, no
    history, no borrowed dates or bird counts. Distinct from makeLayerFlock()
    /makeBroilerFlock() above, which intentionally keep their real defaults
    since those two are also used to recover an existing pre-multi-flock
    save's actual data during migration. */
function starterFlocks() {
  return [
    { id: 'layers', flockName: 'Layer Flock', type: 'layer', standardKey: 'hyline_layer', breed: 'Hy-Line', startDate: todayISO(), initialBirds: 0, location: '', setupCost: null },
    { id: 'broilers', flockName: 'Broiler Batch', type: 'broiler', standardKey: 'ross308_broiler', breed: 'Ross 308', startDate: todayISO(), initialBirds: 0, location: '', setupCost: null },
  ];
}

function freshData() {
  return {
    flocks: starterFlocks(),
    dailyLog: [], meds: [], vax: [], feed: [], weightSamples: [],
    sales: [],
    reminders: [],
    litter: [],       // litter laid / topped up / changed / harvested as manure
    expenses: [],     // whole-farm general costs (labour, transport, utilities) + staff payments
    staff: [],        // farm help roster
    recipes: [],      // saved home-mix feed formulations
    invoices: [],     // invoices/receipts issued to buyers
    bsf: { batches: [] }, // black soldier fly larvae production — manure/waste to poultry protein
    pepper: defaultPepper(),
    goats: defaultGoats(),
    farmProfile: { farmName: '', location: '', email: '', phone: '' },
    updatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Rough count of "real" records across the farm, used to sanity-check sync
 * direction. A device whose local storage was wiped or reinstalled still
 * gets a fresh, later `updatedAt` the moment the app loads — so timestamp
 * comparison ALONE can't tell a genuine edit from a wipe. If local looks
 * dramatically emptier than the cloud, that's the wipe, not real editing,
 * and sync should recover from the cloud rather than overwrite it.
 */
function dataRichness(d) {
  if (!d) return 0;
  const p = d.pepper || {};
  const g = d.goats || {};
  return (
    (d.dailyLog || []).length + (d.feed || []).length + (d.meds || []).length +
    (d.vax || []).length + (d.weightSamples || []).length + (d.sales || []).length +
    (d.litter || []).length + (d.expenses || []).length + (d.staff || []).length +
    (d.reminders || []).length + (d.recipes || []).length + (d.invoices || []).length +
    (d.bsf?.batches || []).length +
    (p.scouting || []).length + (p.sprays || []).length + (p.harvests || []).length +
    (p.manureReadings || []).length + (p.soilReadings || []).length + (p.batches || []).length +
    (p.nurseryBatches || []).length +
    (p.inputs || []).length +
    (g.animals || []).length + (g.heats || []).length + (g.matings || []).length +
    (g.kiddings || []).length + (g.kidMortality || []).length + (g.health || []).length +
    (g.weights || []).length + (g.sales || []).length
  );
}

/* ---------------- CSV export ---------------- */

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // RFC4180: quote a field whenever it contains a comma, quote, or newline,
  // and double up any quotes inside it. A reader (Excel, Sheets) treats an
  // embedded newline inside quotes as part of the cell, not a new row.
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows
    .map((r) => columns.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))
    .join('\n');
  return rows.length ? `${header}\n${body}` : header;
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- Invoices & receipts ---------------- */

/** Next sequential number for this year and doc type, e.g. INV-2026-004.
    Counts existing invoices rather than storing a running counter, so it
    stays correct even after a restore or a sync from another device. */
function nextInvoiceNumber(invoices, kind, date) {
  const prefix = kind === 'receipt' ? 'RCT' : 'INV';
  const year = (date || todayISO()).slice(0, 4);
  const countThisYear = (invoices || []).filter(
    (i) => i.kind === kind && (i.docNumber || '').startsWith(`${prefix}-${year}-`)
  ).length;
  return `${prefix}-${year}-${String(countThisYear + 1).padStart(3, '0')}`;
}

/** True if a saved payload was written by a newer app version than this
    build understands. Never guess at upgrading it — just flag it so the
    caller (restore, sync) can decide whether to proceed. */
function isFromNewerSchema(saved) {
  return Boolean(saved) && Number(saved.schemaVersion) > SCHEMA_VERSION;
}

function migrate(saved) {
  let flocks = saved.flocks;
  if (!flocks || !flocks.length) {
    // Old single-flock save: the existing flock becomes the layer flock.
    flocks = [makeLayerFlock(saved.flock), makeBroilerFlock()];
  }
  flocks = flocks.map((f) => ({ status: 'active', ...f }));
  const pepper = saved.pepper || defaultPepper();
  return {
    flocks,
    dailyLog: tagEntries(saved.dailyLog || SEED.dailyLog, 'layers'),
    meds: tagEntries(saved.meds || SEED.meds, 'layers'),
    vax: tagEntries(saved.vax || SEED.vax, 'layers'),
    feed: tagEntries(saved.feed || SEED.feed, 'layers'),
    weightSamples: tagEntries(saved.weightSamples || [], 'layers'),
    sales: saved.sales || [],
    reminders: saved.reminders || [],
    litter: saved.litter || [],
    expenses: saved.expenses || [],
    staff: (saved.staff || []).map((s) => (s.id ? s : { ...s, id: newId() })),
    recipes: saved.recipes || [],
    invoices: saved.invoices || [],
    bsf: { batches: (saved.bsf && saved.bsf.batches) || [] },
    farmProfile: saved.farmProfile || defaultFarmProfile(),
    pepper: {
      ...defaultPepper(),
      ...pepper,
      fields: (pepper.fields && pepper.fields.length ? pepper.fields : defaultPepper().fields)
        .map((f) => ({ ...fieldSoilDefaults(), ...f })),
      inputs: pepper.inputs || [],
      manureReadings: pepper.manureReadings || [],
      soilReadings: pepper.soilReadings || [],
      batches: pepper.batches || [],
      nurseryBatches: pepper.nurseryBatches || [],
    },
    goats: { ...defaultGoats(), ...(saved.goats || {}) },
    updatedAt: saved.updatedAt || new Date().toISOString(),
    // Always stamped with what THIS build produced, not what was read in —
    // once migrate() has run, the in-memory shape matches the current
    // schema regardless of how old the source file or cloud record was.
    schemaVersion: SCHEMA_VERSION,
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { /* ignore corrupt storage */ }
  return freshData();
}

const FEED_STANDARD = SEED.feedStandard;

/* ---------------- Laying rate & egg tracking ---------------- */

const CRATE_SIZE = 30; // eggs per crate — the common Ghanaian standard; adjust your own count if yours differs
const LAY_DROP_ALERT_PTS = 10; // a week-over-week fall of this many percentage points is worth flagging
const LAY_DROP_MIN_BASELINE = 15; // don't fire the alert during the noisy early ramp-up before a real rate is established

/* A typical commercial Hy-Line Brown production curve, week of age -> hen-day
   %. Published husbandry figures, not a guarantee — every flock's actual
   curve depends on nutrition, health, heat, and light programme. Used only
   as a reference line to compare against, the same way broiler weight is
   already compared to the Ross 308 standard. */
const HYLINE_LAY_STANDARD = [
  { week: 18, layPct: 5 }, { week: 19, layPct: 20 }, { week: 20, layPct: 45 },
  { week: 21, layPct: 65 }, { week: 22, layPct: 78 }, { week: 23, layPct: 85 },
  { week: 24, layPct: 89 }, { week: 25, layPct: 91 }, { week: 26, layPct: 92 },
  { week: 30, layPct: 93 }, { week: 40, layPct: 92 }, { week: 50, layPct: 90 },
  { week: 60, layPct: 87 }, { week: 70, layPct: 83 }, { week: 80, layPct: 78 },
  { week: 90, layPct: 72 },
];

function hylineLayStandardForWeek(week) {
  const rows = HYLINE_LAY_STANDARD;
  if (week < rows[0].week) return null;
  if (week >= rows[rows.length - 1].week) return rows[rows.length - 1].layPct;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (week >= a.week && week < b.week) {
      // straight-line interpolation between the two nearest reference points
      const t = (week - a.week) / (b.week - a.week);
      return Math.round((a.layPct + t * (b.layPct - a.layPct)) * 10) / 10;
    }
  }
  return null;
}

/** The date of the earliest daily-log entry with any eggs recorded — the
    flock's real point-of-lay, not a breed-standard guess. Derived from the
    log itself so it can never drift out of sync with what was actually
    recorded. */
function firstEggDate(dailyLog) {
  const withEggs = dailyLog.filter((r) => (Number(r.eggs) || 0) > 0).sort((a, b) => new Date(a.date) - new Date(b.date));
  return withEggs.length ? withEggs[0].date : null;
}

/** Hen-day % over a date range, weighted by actual eggs and bird-days rather
    than averaging each day's percentage — robust to gaps in logging, where
    a simple average of daily percentages would be skewed by missing days. */
function weightedLayPct(dailyLog, fromDate, toDate) {
  const rows = dailyLog.filter((r) => r.date >= fromDate && r.date <= toDate && r.closing);
  if (!rows.length) return null;
  const eggs = rows.reduce((s, r) => s + (Number(r.eggs) || 0), 0);
  const birdDays = rows.reduce((s, r) => s + r.closing, 0);
  return birdDays ? (eggs / birdDays) * 100 : null;
}

/** The best 7-day-average laying rate the flock has hit so far, and the
    date it ended on — a rolling week rather than a single day, so one
    unusually good (or under-logged) day doesn't get crowned "peak" on its
    own. Matches how peak production is normally talked about in the
    industry: a peak week, not a peak day. */
function layPeakSoFar(dailyLog) {
  let best = null;
  dailyLog.forEach((r) => {
    const rate = weightedLayPct(dailyLog, addDaysISO(r.date, -6), r.date);
    if (rate != null && (!best || rate > best.pct)) best = { pct: rate, date: r.date };
  });
  return best;
}

/** Eggs collected (+), cracked (-), and sold (-) merged chronologically into
    one running stock balance — same "ledger" approach already used for feed,
    just for eggs. Sales logged by the crate are converted to pieces using
    CRATE_SIZE so the balance is always in a single, comparable unit. */
function buildEggLedger(dailyLog, sales) {
  const events = [
    ...dailyLog.filter((r) => (Number(r.eggs) || 0) > 0).map((r) => ({ date: r.date, delta: Number(r.eggs), kind: 'collected', ref: r })),
    ...dailyLog.filter((r) => (Number(r.eggsCracked) || 0) > 0).map((r) => ({ date: r.date, delta: -Number(r.eggsCracked), kind: 'cracked', ref: r })),
    ...sales.filter((s) => s.item === 'Eggs (crates)' || s.item === 'Eggs (pieces)').map((s) => {
      const pieces = s.item === 'Eggs (crates)' ? (Number(s.quantity) || 0) * CRATE_SIZE : (Number(s.quantity) || 0);
      return { date: s.date, delta: -pieces, kind: 'sold', ref: s };
    }),
  ].sort((a, b) => {
    const d = new Date(a.date) - new Date(b.date);
    if (d !== 0) return d;
    // same day: eggs collected before any leave as cracked/sold, so the
    // balance never dips negative purely from same-day ordering
    return a.kind === 'collected' ? -1 : (b.kind === 'collected' ? 1 : 0);
  });
  let running = 0;
  return events.map((e) => { running += e.delta; return { ...e, balance: running }; });
}

const LITTER_CHANGE_DAYS = 42;      // typical deep-litter interval before a full change
const LITTER_MATERIALS = ['Sawdust', 'Wood shavings', 'Rice husk', 'Groundnut shell', 'Other'];
const LITTER_ACTIONS = ['Laid fresh', 'Top-up', 'Turned / stirred', 'Full change', 'Removed to field'];
const LITTER_CONDITIONS = ['Dry', 'Damp', 'Caked', 'Wet'];

/* Standard vaccination programmes. Dates are calculated from the flock start
   date. These are typical Ghanaian schedules — always confirm against your
   hatchery's advice and your vet, since local disease pressure varies. */
const VAX_TEMPLATES = {
  hyline_layer: [
    { day: 7, disease: 'Newcastle + IB', vaccine: 'NDV/IB (Ma5 + Clone30)', route: 'Eye drop' },
    { day: 14, disease: 'Gumboro (IBD)', vaccine: 'IBD intermediate', route: 'Drinking water' },
    { day: 21, disease: 'Gumboro (IBD)', vaccine: 'IBD booster', route: 'Drinking water' },
    { day: 28, disease: 'Newcastle', vaccine: 'Lasota', route: 'Drinking water' },
    { day: 42, disease: 'Fowl Pox', vaccine: 'Fowl pox', route: 'Wing web' },
    { day: 56, disease: 'Newcastle', vaccine: 'Lasota booster', route: 'Drinking water' },
    { day: 70, disease: 'Fowl Typhoid', vaccine: 'Fowl typhoid 9R', route: 'Injection' },
    { day: 112, disease: 'Newcastle', vaccine: 'ND killed (pre-lay)', route: 'Injection' },
  ],
  ross308_broiler: [
    { day: 7, disease: 'Newcastle + IB', vaccine: 'NDV/IB (Ma5 + Clone30)', route: 'Eye drop' },
    { day: 14, disease: 'Gumboro (IBD)', vaccine: 'IBD intermediate', route: 'Drinking water' },
    { day: 21, disease: 'Gumboro (IBD)', vaccine: 'IBD booster', route: 'Drinking water' },
    { day: 28, disease: 'Newcastle', vaccine: 'Lasota booster', route: 'Drinking water' },
  ],
};

/* Feed-mix ingredients. Nutrient values are typical book figures for Ghanaian
   inputs — good enough to compare blends and catch a bad ratio, but the
   concentrate bag's own label always wins. */
const INGREDIENTS = [
  { id: 'maize', name: 'Maize', protein: 8.5, calcium: 0.02, energy: 3350, defaultPrice: 5.5 },
  { id: 'bran', name: 'Wheat bran', protein: 15.0, calcium: 0.14, energy: 1300, defaultPrice: 3.5 },
  { id: 'layerconc', name: 'Layer concentrate', protein: 38.0, calcium: 9.0, energy: 2000, defaultPrice: 14.0 },
  { id: 'broilerconc', name: 'Broiler concentrate', protein: 40.0, calcium: 3.0, energy: 2100, defaultPrice: 15.0 },
  { id: 'soya', name: 'Soya meal', protein: 44.0, calcium: 0.3, energy: 2230, defaultPrice: 9.0 },
  { id: 'fishmeal', name: 'Fish meal', protein: 60.0, calcium: 5.0, energy: 2800, defaultPrice: 18.0 },
  { id: 'oil', name: 'Palm / vegetable oil', protein: 0, calcium: 0, energy: 8800, defaultPrice: 16.0 },
  { id: 'oyster', name: 'Oyster shell / limestone', protein: 0, calcium: 38.0, energy: 0, defaultPrice: 2.0 },
  { id: 'salt', name: 'Salt / premix', protein: 0, calcium: 0, energy: 0, defaultPrice: 6.0 },
];

const RATION_TARGETS = {
  layer: { label: 'Layer (in lay)', protein: [16, 18], calcium: [3.4, 4.2], energy: [2600, 2800] },
  grower: { label: 'Grower / pullet', protein: [14.5, 16.5], calcium: [0.9, 1.3], energy: [2500, 2750] },
  broiler_starter: { label: 'Broiler starter', protein: [21, 23], calcium: [0.8, 1.2], energy: [2800, 3050] },
  broiler_finisher: { label: 'Broiler finisher', protein: [18, 20], calcium: [0.8, 1.2], energy: [2900, 3200] },
};

/* ---------------- small building blocks ---------------- */

function DayRing({ pct, size = 52, color = '#D4A537' }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <svg className="ring" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#423827" strokeWidth="4" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function StatCard({ title, value, tone, foot }) {
  return (
    <div className="card">
      <p className="card-title">{title}</p>
      <div className={`stat-value ${tone || ''}`}>{value}</div>
      {foot && <p className="stat-foot">{foot}</p>}
    </div>
  );
}

function Modal({ title, sub, onClose, children }) {
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{title}</h3>
        {sub && <p className="modal-sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

function Field({ label, span2, children }) {
  return <div className={`field${span2 ? ' span-2' : ''}`}>{label && <label>{label}</label>}{children}</div>;
}

/* ---------------- toast + confirm (replaces alert()/confirm()) ---------------- */

const ToastConfirmContext = createContext(null);

/** In-app replacement for window.alert/confirm — neither freezes the page
    nor looks foreign on mobile. Mounted once at the root; any component
    calls useToastConfirm() to reach it without prop-threading through
    every intermediate table and tab. */
function ToastConfirmProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  const showToast = useCallback((message, tone = 'default') => {
    setToast({ message, tone, key: Date.now() });
  }, []);

  const askConfirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setConfirmState({ message, resolve, danger: opts.danger !== false, confirmLabel: opts.confirmLabel || 'Delete' });
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  function resolveConfirm(result) {
    confirmState?.resolve(result);
    setConfirmState(null);
  }

  return (
    <ToastConfirmContext.Provider value={{ showToast, askConfirm }}>
      {children}
      {toast && (
        <div className={`toast-pop toast-${toast.tone}`} key={toast.key} role="status">
          {toast.message}
        </div>
      )}
      {confirmState && (
        <div className="confirm-overlay" onClick={() => resolveConfirm(false)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p>{confirmState.message}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => resolveConfirm(false)}>Cancel</button>
              <button className={confirmState.danger ? 'btn btn-rust' : 'btn btn-gold'} onClick={() => resolveConfirm(true)}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastConfirmContext.Provider>
  );
}

function useToastConfirm() {
  const ctx = useContext(ToastConfirmContext);
  if (!ctx) throw new Error('useToastConfirm must be used inside ToastConfirmProvider');
  return ctx;
}

/* ---------------- main app ---------------- */

export default function AppRoot() {
  return (
    <ToastConfirmProvider>
      <AppInner />
    </ToastConfirmProvider>
  );
}

function AppInner() {
  const { showToast, askConfirm } = useToastConfirm();
  const [data, setData] = useState(loadData);
  const [workspace, setWorkspace] = useState('poultry');
  const [tab, setTab] = useState('dashboard');
  const [modal, setModal] = useState(null); // 'log' | 'feed' | 'med' | 'vax' | 'flock' | 'sale' | 'reminder' | null
  const [editingLog, setEditingLog] = useState(null); // the Daily Log entry being edited, if any
  const [invoicePrefill, setInvoicePrefill] = useState(null); // opens InvoiceModal when set
  const [showCompletedFlocks, setShowCompletedFlocks] = useState(false);
  const [editingLitter, setEditingLitter] = useState(null); // the litter record being edited, if any
  const [editingFeed, setEditingFeed] = useState(null); // the feed purchase record being edited, if any
  const [activeFlockId, setActiveFlockId] = useState(data.flocks[0].id);
  const restoreInputRef = useRef(null);
  const [sync, setSync] = useState({ status: 'idle', message: '', lastSync: null });
  const [user, setUser] = useState(getUser);
  const [cloudReady, setCloudReady] = useState(isCloudConfigured);
  const [showCloudSetup, setShowCloudSetup] = useState(false);
  const [showProfileForm, setShowProfileForm] = useState(false);

  useEffect(() => {
    // Kept synchronous and un-debounced on purpose: this app's core promise
    // (see the auto-sync safety net) is not losing farm data, and a debounce
    // window is exactly where an edit could vanish if the tab closes before
    // it fires. Only real gap was the missing guard against Safari private
    // mode / storage quota throwing here.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Local save failed (storage full or unavailable):', e);
    }
  }, [data]);

  const activeFlock = data.flocks.find((f) => f.id === activeFlockId) || data.flocks[0];
  const flockStandard = STANDARDS[activeFlock.standardKey] || FEED_STANDARD;
  // A farm's own birds can consistently start laying earlier or later than
  // the generic breed-standard week — once you've seen that a few times,
  // your own figure (set per flock) is worth more than the textbook one.
  const POL_WEEK = activeFlock.polWeekOverride || polWeek(flockStandard);

  const dailyLog = useMemo(
    () => data.dailyLog.filter((r) => r.flockId === activeFlock.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [data.dailyLog, activeFlock.id]
  );
  const feed = useMemo(
    () => data.feed.filter((r) => r.flockId === activeFlock.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [data.feed, activeFlock.id]
  );
  const meds = useMemo(
    () => data.meds.filter((r) => r.flockId === activeFlock.id).sort((a, b) => new Date(b.date) - new Date(a.date)),
    [data.meds, activeFlock.id]
  );
  const vax = useMemo(
    () => data.vax.filter((r) => r.flockId === activeFlock.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [data.vax, activeFlock.id]
  );
  const weightSamples = useMemo(
    () => (data.weightSamples || []).filter((r) => r.flockId === activeFlock.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [data.weightSamples, activeFlock.id]
  );
  const sales = useMemo(
    () => (data.sales || []).filter((r) => r.flockId === activeFlock.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [data.sales, activeFlock.id]
  );
  const litter = useMemo(
    () => (data.litter || []).filter((r) => r.flockId === activeFlock.id).sort((a, b) => new Date(a.date) - new Date(b.date)),
    [data.litter, activeFlock.id]
  );

  const latest = dailyLog[dailyLog.length - 1];
  const currentBirds = latest ? latest.closing : activeFlock.initialBirds;
  const totalMortality = dailyLog.reduce((s, r) => s + (Number(r.mortality) || 0), 0);
  const survivalRate = activeFlock.initialBirds
    ? (currentBirds / activeFlock.initialBirds) * 100
    : null;
  const totalFeed = dailyLog.reduce((s, r) => s + (Number(r.feedGiven) || 0), 0);
  const dayNumber = daysBetween(activeFlock.startDate, todayISO()) + 1;
  const weekNumber = Math.ceil(dayNumber / 7);
  const daysSinceLastEntry = latest ? daysBetween(latest.date, todayISO()) : null;
  const isStale = daysSinceLastEntry !== null && daysSinceLastEntry > 3;

  /* Feed balance as a real running ledger, not a number frozen on each
     record at entry time. It merges every purchase/adjustment with every
     day's "feed given" from the Daily Log, in date order, and carries a
     cumulative total — so entering a purchase always moves stock up, and
     logging the day's usage always moves it down, however the entries were
     typed in. */
  const feedLedger = useMemo(() => {
    const events = [
      ...feed.map((r) => ({
        date: r.date,
        delta: (Number(r.purchased) || 0) - (Number(r.used) || 0) + (Number(r.adjustment) || 0),
        kind: 'purchase', ref: r,
      })),
      ...dailyLog.filter((r) => r.feedGiven != null && r.feedGiven !== '').map((r) => ({
        date: r.date,
        delta: -(Number(r.feedGiven) || 0),
        kind: 'usage', ref: r,
      })),
    ].sort((a, b) => {
      const dateDiff = new Date(a.date) - new Date(b.date);
      if (dateDiff !== 0) return dateDiff;
      if (a.kind === b.kind) return 0; // same date, same kind — order doesn't affect the running total
      return a.kind === 'purchase' ? -1 : 1; // a same-day purchase should still land before that day's usage
    });

    let running = 0;
    return events.map((e) => { running += e.delta; return { ...e, balance: running }; });
  }, [feed, dailyLog]);

  const feedBalance = feedLedger.length ? feedLedger[feedLedger.length - 1].balance : (feed.length || dailyLog.length ? 0 : null);
  const totalFeedCost = feed.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const feedCostPerBird = currentBirds ? totalFeedCost / currentBirds : null;

  const totalEggs = dailyLog.reduce((s, r) => s + (Number(r.eggs) || 0), 0);
  const totalCracked = dailyLog.reduce((s, r) => s + (Number(r.eggsCracked) || 0), 0);
  // Raw egg counts (not the %) for the crates-today/this-week dashboard
  // cards — Ghana packs eggs 30 to a crate, so this is what a farmer
  // actually walks out to the market with.
  const eggsToday = dailyLog.filter((r) => r.date === todayISO()).reduce((s, r) => s + (Number(r.eggs) || 0), 0);
  const eggsThisWeek = dailyLog.filter((r) => r.date >= addDaysISO(todayISO(), -6)).reduce((s, r) => s + (Number(r.eggs) || 0), 0);
  const henDayPct = latest && latest.closing
    ? ((Number(latest.eggs) || 0) / latest.closing) * 100
    : null;
  const weeksToPOL = POL_WEEK - weekNumber;
  // Once real eggs are on record, the feed recommendation should follow
  // what's actually happening, not a generic breed-standard week that may
  // not match this flock — some lines and conditions start laying earlier
  // (or later) than the textbook figure, and the app shouldn't keep
  // recommending Grower feed to a flock that's already laying.
  const standardFeedPhase = feedPhaseForWeek(weekNumber, flockStandard);
  const layerPhaseName = (flockStandard.find((r) => (r.feedType || '').toLowerCase().includes('layer')) || {}).feedType;
  const currentFeedPhase = (activeFlock.type === 'layer' && totalEggs > 0 && layerPhaseName)
    ? layerPhaseName
    : standardFeedPhase;
  const standardWeight = standardWeightForWeek(weekNumber, flockStandard);
  const latestSample = weightSamples[weightSamples.length - 1];

  /* ---- Laying rate, egg cash flow, and egg stock (layer flocks) ---- */
  const actualFirstEggDate = useMemo(() => firstEggDate(dailyLog), [dailyLog]);
  const layPeak = useMemo(() => layPeakSoFar(dailyLog), [dailyLog]);
  const daysSinceFirstEgg = actualFirstEggDate ? daysBetween(actualFirstEggDate, todayISO()) : null;
  const weeklyLayPct = weightedLayPct(dailyLog, addDaysISO(todayISO(), -6), todayISO());
  const monthlyLayPct = weightedLayPct(dailyLog, addDaysISO(todayISO(), -29), todayISO());
  const standardLayPct = hylineLayStandardForWeek(weekNumber);

  const eggLedger = useMemo(() => buildEggLedger(dailyLog, sales), [dailyLog, sales]);
  const eggsInStock = eggLedger.length ? eggLedger[eggLedger.length - 1].balance : 0;

  const eggSales = sales.filter((s) => s.item === 'Eggs (crates)' || s.item === 'Eggs (pieces)');
  const eggRevenue = eggSales.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const eggsSoldPieces = eggSales.reduce((s, r) => s + ((r.item === 'Eggs (crates)' ? (Number(r.quantity) || 0) * CRATE_SIZE : (Number(r.quantity) || 0))), 0);
  const avgEggPrice = eggsSoldPieces ? eggRevenue / eggsSoldPieces : null;
  const eggRevenueToday = eggSales.filter((r) => r.date === todayISO()).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const eggRevenueWeek = eggSales.filter((r) => r.date >= addDaysISO(todayISO(), -6)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const eggRevenueMonth = eggSales.filter((r) => r.date >= addDaysISO(todayISO(), -29)).reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const costPerEgg = totalEggs ? totalFeedCost / totalEggs : null;
  const eggMarginPerEgg = costPerEgg != null && avgEggPrice != null ? avgEggPrice - costPerEgg : null;
  const crackedValueLost = avgEggPrice != null ? totalCracked * avgEggPrice : null;

  // A meaningful week-over-week fall, once the rate has actually established
  // itself past the noisy early ramp-up — not during it.
  const layPrevWeekPct = weightedLayPct(dailyLog, addDaysISO(todayISO(), -13), addDaysISO(todayISO(), -7));
  const layDropAlert = (
    daysSinceFirstEgg != null && daysSinceFirstEgg >= 21 &&
    layPrevWeekPct != null && layPrevWeekPct >= LAY_DROP_MIN_BASELINE &&
    weeklyLayPct != null && (layPrevWeekPct - weeklyLayPct) >= LAY_DROP_ALERT_PTS
  );

  // The app's own feed-phase recommendation now follows real eggs, not the
  // breed-standard week — but that doesn't mean the trough has actually
  // been switched to Layer feed yet. Nudge for the first couple of weeks
  // after laying starts, when it matters most (shell calcium) and is most
  // likely to still be genuinely unresolved.
  const growerLayerMismatch = activeFlock.type === 'layer'
    && daysSinceFirstEgg != null && daysSinceFirstEgg <= 14;

  const layTrendData = useMemo(() => dailyLog.map((r) => {
    const wk = Math.ceil((daysBetween(activeFlock.startDate, r.date) + 1) / 7);
    return {
      date: fmtDate(r.date).slice(0, 6),
      actual: r.closing ? Math.round(((Number(r.eggs) || 0) / r.closing) * 1000) / 10 : null,
      standard: hylineLayStandardForWeek(wk),
    };
  }), [dailyLog, activeFlock.startDate]);

  // Feed conversion ratio — meaningful for broilers: kg feed per kg liveweight to date.
  const fcr = (activeFlock.type === 'broiler' && latestSample && latestSample.avgWeightG && currentBirds && totalFeed)
    ? totalFeed / (currentBirds * (latestSample.avgWeightG / 1000))
    : null;
  const fcrTarget = activeFlock.type === 'broiler' ? 1.6 : null;

  // Sales & simple profit for this flock.
  const totalRevenue = sales.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const litterCost = litter.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  // Coops and other structures charged over their working life, plus running
  // expenses booked against this flock in the Whole Farm view.
  const flockExpenses = (data.expenses || []).filter(
    (e) => e.scope === 'poultry' && (e.target === activeFlock.id || e.target === 'shared')
  );
  const coopCharge = flockExpenses.filter((e) => e.capital).reduce((s, e) => s + chargedToDate(e), 0);
  const coopInvested = flockExpenses.filter((e) => e.capital).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const flockRunning = flockExpenses.filter((e) => !e.capital).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const flockCost = totalFeedCost + litterCost + coopCharge + flockRunning + (Number(activeFlock.setupCost) || 0);
  const flockMargin = totalRevenue - flockCost;

  // Feed run-out projection: average daily use over the last 7 logged days.
  const recentLog = dailyLog.slice(-7);
  const avgDailyFeed = recentLog.length
    ? recentLog.reduce((s, r) => s + (Number(r.feedGiven) || 0), 0) / recentLog.length
    : null;
  const feedDaysLeft = (feedBalance != null && avgDailyFeed > 0)
    ? Math.floor(feedBalance / avgDailyFeed)
    : null;

  // Litter: how long since the house was last laid or fully changed.
  const lastChange = [...litter].reverse().find((r) => r.action === 'Laid fresh' || r.action === 'Full change');
  const daysSinceLitterChange = lastChange ? daysBetween(lastChange.date, todayISO()) : null;
  const litterCondition = litter.length ? litter[litter.length - 1].condition : null;
  const litterDue = daysSinceLitterChange != null && daysSinceLitterChange >= LITTER_CHANGE_DAYS;
  // Manure banked from cleared litter — the reason the poultry exists.
  const manureHarvested = litter
    .filter((r) => r.action === 'Removed to field')
    .reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  const mortalityByCause = useMemo(() => {
    const m = {};
    dailyLog.forEach((r) => {
      if (Number(r.mortality) > 0 && r.mortalityCause) {
        m[r.mortalityCause] = (m[r.mortalityCause] || 0) + Number(r.mortality);
      }
    });
    return m;
  }, [dailyLog]);

  const growthChartData = useMemo(() => {
    const sampleByWeek = {};
    weightSamples.forEach((s) => {
      const wk = Math.ceil((daysBetween(activeFlock.startDate, s.date) + 1) / 7);
      sampleByWeek[wk] = s.avgWeightG;
    });
    return flockStandard.filter((r) => r.week <= Math.max(weekNumber, POL_WEEK)).map((r) => ({
      week: `W${r.week}`,
      standard: r.estWeightG,
      actual: sampleByWeek[r.week] ?? null,
    }));
  }, [weightSamples, weekNumber, activeFlock.startDate, flockStandard, POL_WEEK]);

  // vaccine status: latest occurrence of each vaccine family + its next-due date
  /* Every scheduled shot, with how many days until it's due. `status` is
     what the farmer confirms: 'planned' until they say otherwise, then
     'done' or 'skipped'. Entries logged manually count as done. */
  const vaxSchedule = useMemo(() => vax.map((v) => {
    const status = v.status || (v.planned ? 'planned' : 'done');
    const dueDate = v.dueDate || v.date;
    return { ...v, status, dueDate, daysLeft: dueDate ? daysBetween(todayISO(), dueDate) : null };
  }), [vax]);

  const vaxPending = useMemo(
    () => vaxSchedule.filter((v) => v.status === 'planned'),
    [vaxSchedule]
  );

  // Latest confirmed shot per disease — used in the weekly report and dashboard.
  const vaxStatus = useMemo(() => {
    const map = {};
    vaxSchedule.filter((v) => v.status === 'done').forEach((v) => {
      const key = v.disease || v.vaccine;
      if (!map[key] || new Date(v.date) > new Date(map[key].date)) map[key] = v;
    });
    return Object.values(map);
  }, [vaxSchedule]);

  const chartData = useMemo(() => dailyLog.map((r) => ({
    date: fmtDate(r.date).slice(0, 6),
    closing: r.closing,
    mortality: Number(r.mortality) || 0,
    feedGiven: r.feedGiven ?? null,
    eggs: r.eggs ?? null,
    water: r.waterGiven ?? null,
    henDay: r.closing ? Math.round(((Number(r.eggs) || 0) / r.closing) * 1000) / 10 : null,
  })), [dailyLog]);

  const feedChartData = useMemo(() => feedLedger.map((e) => ({
    date: fmtDate(e.date).slice(0, 6),
    balance: e.balance,
    purchased: e.kind === 'purchase' ? e.ref.purchased : null,
    used: e.kind === 'usage' ? e.ref.feedGiven : e.ref.used,
  })), [feedLedger]);

  /** Stamp any local edit with "now", so sync always knows this device has
      the freshest copy — without this, a local edit could be silently
      overwritten by an older remote copy on the next sync. */
  function touch(obj) {
    return { ...obj, updatedAt: new Date().toISOString() };
  }

  function addDailyLog(entry) {
    setData((d) => touch({ ...d, dailyLog: [...d.dailyLog, { ...entry, flockId: activeFlock.id }] }));
  }
  function updateDailyLog(id, patch) {
    setData((d) => touch({ ...d, dailyLog: d.dailyLog.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }
  function deleteDailyLog(id) {
    setData((d) => touch({ ...d, dailyLog: d.dailyLog.filter((r) => r.id !== id) }));
  }
  function addFeed(entry) {
    setData((d) => touch({ ...d, feed: [...d.feed, { ...entry, flockId: activeFlock.id }] }));
  }
  function updateFeed(id, patch) {
    setData((d) => touch({ ...d, feed: d.feed.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }
  function deleteFeed(id) {
    setData((d) => touch({ ...d, feed: d.feed.filter((r) => r.id !== id) }));
  }
  function addMed(entry) {
    setData((d) => touch({ ...d, meds: [...d.meds, { ...entry, flockId: activeFlock.id }] }));
  }
  /** Confirm or un-confirm a single day of a medication course. */
  function toggleMedDay(medId, dateISO) {
    setData((d) => touch({
      ...d,
      meds: d.meds.map((m) => {
        if (m.id !== medId) return m;
        const given = new Set(m.daysGiven || []);
        if (given.has(dateISO)) given.delete(dateISO); else given.add(dateISO);
        return { ...m, daysGiven: [...given] };
      }),
    }));
  }
  function deleteMed(id) {
    setData((d) => touch({ ...d, meds: d.meds.filter((m) => m.id !== id) }));
  }
  function addVax(entry) {
    setData((d) => touch({ ...d, vax: [...d.vax, { ...entry, flockId: activeFlock.id, status: 'done' }] }));
  }
  /** Farmer confirms a scheduled shot: 'done', 'skipped', or back to 'planned'. */
  function setVaxStatus(id, status) {
    setData((d) => touch({
      ...d,
      vax: d.vax.map((v) => (v.id === id
        ? { ...v, status, date: status === 'done' ? todayISO() : v.date }
        : v)),
    }));
  }
  function deleteVax(id) {
    setData((d) => touch({ ...d, vax: d.vax.filter((v) => v.id !== id) }));
  }
  function addWeightSample(entry) {
    setData((d) => touch({ ...d, weightSamples: [...(d.weightSamples || []), { ...entry, flockId: activeFlock.id }] }));
  }
  function addSale(entry) {
    setData((d) => touch({ ...d, sales: [...(d.sales || []), { ...entry, flockId: activeFlock.id }] }));
  }
  function addLitter(entry) {
    setData((d) => touch({ ...d, litter: [...(d.litter || []), { ...entry, flockId: activeFlock.id }] }));
  }
  function updateLitter(id, patch) {
    setData((d) => touch({ ...d, litter: (d.litter || []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }
  function deleteLitter(id) {
    setData((d) => touch({ ...d, litter: (d.litter || []).filter((r) => r.id !== id) }));
  }
  function addExpense(entry) {
    setData((d) => touch({ ...d, expenses: [...(d.expenses || []), entry] }));
  }
  function updateExpense(id, patch) {
    setData((d) => touch({ ...d, expenses: (d.expenses || []).map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }
  function deleteExpense(id) {
    setData((d) => touch({ ...d, expenses: (d.expenses || []).filter((r) => r.id !== id) }));
  }
  function saveStaff(person) {
    setData((d) => {
      const exists = (d.staff || []).some((s) => s.id === person.id);
      const staff = exists
        ? d.staff.map((s) => (s.id === person.id ? person : s))
        : [...(d.staff || []), person];
      return touch({ ...d, staff });
    });
  }
  function deleteStaff(id) {
    setData((d) => touch({ ...d, staff: (d.staff || []).filter((s) => s.id !== id) }));
  }
  function addInvoice(entry) {
    setData((d) => touch({ ...d, invoices: [...(d.invoices || []), entry] }));
  }
  function deleteInvoice(id) {
    setData((d) => touch({ ...d, invoices: (d.invoices || []).filter((i) => i.id !== id) }));
  }
  function addBsfBatch(entry) {
    setData((d) => touch({ ...d, bsf: { ...d.bsf, batches: [...(d.bsf?.batches || []), entry] } }));
  }
  function updateBsfBatch(id, patch) {
    setData((d) => touch({
      ...d,
      bsf: { ...d.bsf, batches: (d.bsf?.batches || []).map((b) => (b.id === id ? { ...b, ...patch } : b)) },
    }));
  }
  function deleteBsfBatch(id) {
    setData((d) => touch({ ...d, bsf: { ...d.bsf, batches: (d.bsf?.batches || []).filter((b) => b.id !== id) } }));
  }
  function openInvoiceFromSale(sale) {
    setInvoicePrefill({
      kind: 'invoice', date: sale.date, buyerName: sale.buyer || '',
      item: sale.item || 'Poultry sale', quantity: sale.quantity, unitPrice: sale.unitPrice, amount: sale.amount,
    });
  }
  function openInvoiceFromHarvest(harvest, fieldLabel) {
    setInvoicePrefill({
      kind: 'invoice', date: harvest.date, buyerName: harvest.buyer || '',
      item: `Bell peppers${fieldLabel ? ` — ${fieldLabel}` : ''}${harvest.grade ? ` (${harvest.grade})` : ''}`,
      quantity: harvest.weightKg, unitPrice: harvest.pricePerKg,
      amount: (Number(harvest.weightKg) || 0) * (Number(harvest.pricePerKg) || 0),
    });
  }
  function openInvoiceFromGoatSale(sale, goatLabel) {
    setInvoicePrefill({
      kind: 'invoice', date: sale.date, buyerName: sale.buyer || '',
      item: `Goat sale${goatLabel ? ` — ${goatLabel}` : ''}`,
      quantity: sale.weightKg || 1, unitPrice: sale.weightKg ? sale.price / (sale.weightKg || 1) : sale.price,
      amount: Number(sale.price) || 0,
    });
  }
  function saveRecipe(entry) {
    setData((d) => touch({ ...d, recipes: [...(d.recipes || []), entry] }));
  }
  function deleteRecipe(id) {
    setData((d) => touch({ ...d, recipes: (d.recipes || []).filter((r) => r.id !== id) }));
  }
  function addInput(entry) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, inputs: [...(d.pepper.inputs || []), entry] } }));
  }
  function updateInput(id, patch) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, inputs: (d.pepper.inputs || []).map((i) => (i.id === id ? { ...i, ...patch } : i)) } }));
  }
  function deleteInput(id) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, inputs: (d.pepper.inputs || []).filter((i) => i.id !== id) } }));
  }

  /** Load a breed vaccination programme, skipping any shot already recorded. */
  function applyVaxTemplate() {
    const tpl = VAX_TEMPLATES[activeFlock.standardKey] || [];
    // Dedupe on dueDate, not date — confirming a shot as "done" rewrites
    // date to the confirmation day, so date is not stable, but dueDate is
    // never touched after the entry is created.
    const existing = new Set(
      data.vax.filter((v) => v.flockId === activeFlock.id)
        .map((v) => `${v.disease}|${v.dueDate || v.date}`)
    );
    const rows = tpl.map((t) => {
      const date = addDaysISO(activeFlock.startDate, t.day);
      return {
        id: newId(), flockId: activeFlock.id, date, dueDate: date,
        disease: t.disease, vaccine: t.vaccine, method: t.route,
        notes: `Day ${t.day} — from ${activeFlock.type} programme`,
        status: 'planned',
      };
    }).filter((r) => !existing.has(`${r.disease}|${r.date}`));
    if (!rows.length) {
      showToast('This programme is already loaded for this flock.');
      return;
    }
    setData((d) => touch({ ...d, vax: [...d.vax, ...rows] }));
    showToast(`Loaded ${rows.length} vaccination dates for ${activeFlock.flockName} — check them against your vet's advice.`, 'green');
  }

  function saveFlock(flock) {
    setData((d) => {
      const exists = d.flocks.some((f) => f.id === flock.id);
      return touch({ ...d, flocks: exists ? d.flocks.map((f) => (f.id === flock.id ? flock : f)) : [...d.flocks, flock] });
    });
    setActiveFlockId(flock.id);
  }
  function updateFarmProfile(profile) {
    setData((d) => touch({ ...d, farmProfile: profile }));
  }
  function addReminder(entry) {
    setData((d) => touch({ ...d, reminders: [...(d.reminders || []), entry] }));
  }
  function toggleReminder(id) {
    setData((d) => touch({ ...d, reminders: (d.reminders || []).map((r) => (r.id === id ? { ...r, done: !r.done } : r)) }));
  }
  function deleteReminder(id) {
    setData((d) => touch({ ...d, reminders: (d.reminders || []).filter((r) => r.id !== id) }));
  }

  /* ---- cloud sync ---- */

  const lastSyncedAtRef = useRef(null);   // updatedAt value we last confirmed synced — stops auto-sync looping on its own writes
  const firstSyncRef = useRef(true);      // sync sooner right after the app opens, for faster recovery
  const syncNowRef = useRef(null);        // always holds the latest syncNow closure, for stable event listeners
  const syncInFlightRef = useRef(false);  // blocks overlapping syncs — auto-sync now fires from several independent triggers

  async function syncNow(mode = 'auto') {
    if (!user) return;
    if (syncInFlightRef.current) return; // a sync is already running — let it finish rather than overlap
    syncInFlightRef.current = true;
    setSync({ status: 'syncing', message: 'Syncing…', lastSync: sync.lastSync });
    try {
      const remote = await pullRemote();
      const localTime = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
      const remoteTime = remote ? new Date(remote.updatedAt).getTime() : 0;
      const localCount = dataRichness(data);
      const remoteCount = remote ? dataRichness(remote.state) : 0;

      // If the cloud copy was written by a newer version of the app, this
      // build doesn't fully understand its shape — don't pull it in (could
      // drop fields on the next save) and don't push over it either (could
      // discard whatever the newer version added). Surface it and stop.
      if (remote && isFromNewerSchema(remote.state)) {
        setSync({
          status: 'error',
          message: `Cloud data is from a newer app version (v${remote.state.schemaVersion}) — update the app to keep syncing`,
          lastSync: sync.lastSync,
        });
        return;
      }

      // Safety net: local storage getting wiped or reinstalled still produces
      // a fresh "now" timestamp, which would otherwise look newer than the
      // cloud and push an empty farm over a real one. If local is far
      // emptier than a meaningfully-sized cloud copy, always recover from
      // the cloud instead — never push, whatever the timestamps say.
      const looksLikeLocalWipe = mode !== 'pull' && remoteCount >= 5 && localCount < remoteCount * 0.2;

      if (mode === 'pull' || looksLikeLocalWipe || (mode === 'auto' && remote && remoteTime > localTime)) {
        const merged = migrate(remote.state);
        setData(merged);
        setActiveFlockId(merged.flocks[0].id);
        lastSyncedAtRef.current = merged.updatedAt;
        setSync({
          status: 'ok',
          message: looksLikeLocalWipe
            ? 'This device had far less data than your cloud copy — restored automatically'
            : 'Pulled latest from cloud',
          lastSync: new Date().toISOString(),
        });
        return;
      }
      const at = await pushRemote(data);
      lastSyncedAtRef.current = at;
      setData((d) => ({ ...d, updatedAt: at }));
      setSync({ status: 'ok', message: 'Saved to cloud', lastSync: at });
    } catch (err) {
      const msg = err.message || 'Sync failed';
      setSync({ status: 'error', message: msg, lastSync: sync.lastSync });
      if (msg.includes('sign in')) setUser(null);
    } finally {
      syncInFlightRef.current = false;
    }
  }

  syncNowRef.current = syncNow;

  // Auto-save: a few seconds after any local change settles, push it to the
  // cloud without needing a button press. Skips changes that were caused by
  // sync itself, so this can't loop.
  useEffect(() => {
    if (!user || !isCloudConfigured()) return;
    if (data.updatedAt === lastSyncedAtRef.current) return;
    const delay = firstSyncRef.current ? 800 : 4000;
    const t = setTimeout(() => { firstSyncRef.current = false; syncNowRef.current('auto'); }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.updatedAt, user]);

  // Also sync whenever the app comes back to the foreground — the common
  // case on a phone is backgrounding the app rather than closing it, and a
  // debounce timer doesn't run while the tab is suspended.
  useEffect(() => {
    if (!user || !isCloudConfigured()) return;
    function onVisible() {
      if (document.visibilityState === 'visible') syncNowRef.current('auto');
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user]);

  // On sign-in, pull whatever is already in the cloud so a new device
  // starts from the real data rather than the seeded defaults.
  async function handleSignedIn(session) {
    setUser(session.user);
    setSync({ status: 'syncing', message: 'Loading your farm…', lastSync: null });
    try {
      const remote = await pullRemote();
      if (remote && isFromNewerSchema(remote.state)) {
        setSync({
          status: 'error',
          message: `Cloud data is from a newer app version (v${remote.state.schemaVersion}) — update the app to keep syncing`,
          lastSync: null,
        });
        return;
      }
      if (remote) {
        const merged = migrate(remote.state);
        setData(merged);
        setActiveFlockId(merged.flocks[0].id);
        lastSyncedAtRef.current = merged.updatedAt;
        setSync({ status: 'ok', message: 'Loaded from cloud', lastSync: new Date().toISOString() });
      } else {
        const at = await pushRemote(data);
        lastSyncedAtRef.current = at;
        setData((d) => ({ ...d, updatedAt: at }));
        setSync({ status: 'ok', message: 'Farm saved to cloud', lastSync: at });
      }
    } catch (err) {
      setSync({ status: 'error', message: err.message || 'Could not load from cloud', lastSync: null });
    }
  }

  function handleSignOut() {
    signOut();
    setUser(null);
    setSync({ status: 'idle', message: '', lastSync: null });
    lastSyncedAtRef.current = null;
    firstSyncRef.current = true;
  }

  function backupData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-farms-backup-v${SCHEMA_VERSION}-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function restoreData(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        showToast('Could not read that file — it doesn\'t look like valid JSON.', 'rust');
        return;
      }
      // Loose but real shape check — catches "wrong file entirely" before
      // migrate()'s defensive fallbacks turn it into a silently near-empty
      // farm that LOOKS like a successful restore.
      const looksLikeBackup = parsed && typeof parsed === 'object'
        && ['flocks', 'dailyLog', 'pepper', 'expenses'].some((k) => k in parsed);
      if (!looksLikeBackup) {
        showToast('That doesn\'t look like an AI Farms backup file — nothing was changed.', 'rust');
        return;
      }
      if (isFromNewerSchema(parsed)) {
        const proceed = await askConfirm(
          `This backup was saved by a newer version of the app (format v${parsed.schemaVersion} vs this app's v${SCHEMA_VERSION}). ` +
          'Restoring it here may not understand everything in it, or could lose something on the next save. ' +
          'Update the app first if you can. Restore anyway?',
          { confirmLabel: 'Restore anyway' }
        );
        if (!proceed) return;
      }
      const merged = migrate(parsed);
      const recordCount = dataRichness(merged);
      setData(merged);
      setActiveFlockId(merged.flocks[0].id);
      showToast(`Backup restored — ${recordCount} record(s) loaded across the farm.`, 'green');
    };
    reader.onerror = () => showToast('Could not read that file from your device — please try again.', 'rust');
    reader.readAsText(file);
  }

  function exportWeeklyReport() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const recent = dailyLog.filter((r) => new Date(r.date) >= cutoff);
    const weekMortality = recent.reduce((s, r) => s + (Number(r.mortality) || 0), 0);
    const weekFeed = recent.reduce((s, r) => s + (Number(r.feedGiven) || 0), 0);
    const weekEggs = recent.reduce((s, r) => s + (Number(r.eggs) || 0), 0);
    const lines = [
      `${data.farmProfile.farmName || 'Farm'} — ${activeFlock.flockName} — Weekly Report`,
      `Generated ${fmtDate(todayISO())} · Day ${dayNumber} · Week ${weekNumber}`,
      '',
      `Current flock: ${num(currentBirds)} birds (${num(survivalRate, 1)}% survival)`,
      `Mortality (last 7 days logged): ${num(weekMortality)}`,
      `Feed used (last 7 days logged): ${num(weekFeed, 1)} kg`,
      `Eggs collected (last 7 days logged): ${num(weekEggs)}`,
      `Feed store balance: ${feedBalance != null ? num(feedBalance, 1) + ' kg' : '—'}`,
      `Total feed cost to date: ${totalFeedCost ? 'GH₵ ' + num(totalFeedCost, 2) : '—'}`,
      `Current feed phase: ${currentFeedPhase || '—'}`,
      `Weeks to point-of-lay (standard): ${weeksToPOL > 0 ? weeksToPOL : 'reached'}`,
      '',
      'Vaccination status:',
      ...vaxStatus.map((v) => `  - ${v.disease || v.vaccine}: last given ${fmtDate(v.date)}`),
      '',
      `Entries logged this week: ${recent.length}`,
      ...recent.map((r) => `  ${fmtDate(r.date)} — closing ${num(r.closing)}, deaths ${num(r.mortality)}, feed ${r.feedGiven ?? '—'}kg, eggs ${r.eggs ?? '—'}${r.notes ? ' — ' + r.notes : ''}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-farms-weekly-report-${todayISO()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function updateField(id, patch) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, fields: d.pepper.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) } }));
  }
  function addManureReading(entry) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, manureReadings: [...(d.pepper.manureReadings || []), entry] } }));
  }
  function deleteManureReading(id) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, manureReadings: (d.pepper.manureReadings || []).filter((r) => r.id !== id) } }));
  }
  function addSoilReading(entry) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, soilReadings: [...(d.pepper.soilReadings || []), entry] } }));
  }
  function deleteSoilReading(id) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, soilReadings: (d.pepper.soilReadings || []).filter((r) => r.id !== id) } }));
  }
  /** Closes out the field's current planting as a historical batch, then
      starts the new one as the field's live crop-cycle state. */
  function startNewBatch(fieldId, newBatch) {
    setData((d) => {
      const field = d.pepper.fields.find((f) => f.id === fieldId);
      const closedBatches = [...(d.pepper.batches || [])];
      if (field && field.transplantDate) {
        closedBatches.push({
          id: newId(), fieldId,
          batchLabel: field.currentBatchLabel || 'Batch 1',
          variety: field.variety, transplantDate: field.transplantDate,
          plantCount: field.plantCount, spacing: field.spacing,
          expectedHarvestDAT: field.expectedHarvestDAT, setupCost: field.setupCost,
          manureAppliedDate: field.manureAppliedDate, notes: field.notes,
          status: 'closed', closedDate: newBatch.transplantDate,
        });
      }
      const fields = d.pepper.fields.map((f) => (f.id === fieldId ? { ...f, ...newBatch } : f));
      return touch({ ...d, pepper: { ...d.pepper, fields, batches: closedBatches } });
    });
  }
  function deleteBatch(id) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, batches: (d.pepper.batches || []).filter((b) => b.id !== id) } }));
  }
  function addNurseryBatch(entry) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, nurseryBatches: [...(d.pepper.nurseryBatches || []), entry] } }));
  }
  function updateNurseryBatch(id, patch) {
    setData((d) => touch({
      ...d,
      pepper: { ...d.pepper, nurseryBatches: (d.pepper.nurseryBatches || []).map((b) => (b.id === id ? { ...b, ...patch } : b)) },
    }));
  }
  function deleteNurseryBatch(id) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, nurseryBatches: (d.pepper.nurseryBatches || []).filter((b) => b.id !== id) } }));
  }
  /** Moves a nursery batch into the field it's ready for — closes out any
      current planting on that field the same way "+ New Batch" does, and
      marks the nursery batch transplanted so it drops off the active list. */
  function transplantNurseryBatch(nurseryBatchId, fieldId, newBatch) {
    startNewBatch(fieldId, newBatch);
    updateNurseryBatch(nurseryBatchId, {
      status: 'transplanted', transplantedDate: newBatch.transplantDate, transplantedToFieldId: fieldId,
    });
  }
  function addScouting(entry) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, scouting: [...d.pepper.scouting, entry] } }));
  }
  function addSpray(entry) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, sprays: [...d.pepper.sprays, entry] } }));
  }
  function addHarvest(entry) {
    setData((d) => touch({ ...d, pepper: { ...d.pepper, harvests: [...d.pepper.harvests, entry] } }));
  }

  /* ---- Goats ---- */
  function addGoat(entry) {
    setData((d) => touch({ ...d, goats: { ...d.goats, animals: [...(d.goats.animals || []), entry] } }));
  }
  function updateGoat(id, patch) {
    setData((d) => touch({ ...d, goats: { ...d.goats, animals: (d.goats.animals || []).map((a) => (a.id === id ? { ...a, ...patch } : a)) } }));
  }
  function deleteGoat(id) {
    setData((d) => touch({ ...d, goats: { ...d.goats, animals: (d.goats.animals || []).filter((a) => a.id !== id) } }));
  }
  function addHeat(entry) {
    setData((d) => touch({ ...d, goats: { ...d.goats, heats: [...(d.goats.heats || []), entry] } }));
  }
  function deleteHeat(id) {
    setData((d) => touch({ ...d, goats: { ...d.goats, heats: (d.goats.heats || []).filter((r) => r.id !== id) } }));
  }
  function addMating(entry) {
    setData((d) => touch({ ...d, goats: { ...d.goats, matings: [...(d.goats.matings || []), entry] } }));
  }
  function deleteMating(id) {
    setData((d) => touch({ ...d, goats: { ...d.goats, matings: (d.goats.matings || []).filter((r) => r.id !== id) } }));
  }
  function addKidding(entry) {
    setData((d) => touch({ ...d, goats: { ...d.goats, kiddings: [...(d.goats.kiddings || []), entry] } }));
  }
  function deleteKidding(id) {
    setData((d) => touch({ ...d, goats: { ...d.goats, kiddings: (d.goats.kiddings || []).filter((r) => r.id !== id) } }));
  }
  function addKidMortality(entry) {
    setData((d) => touch({ ...d, goats: { ...d.goats, kidMortality: [...(d.goats.kidMortality || []), entry] } }));
  }
  function deleteKidMortality(id) {
    setData((d) => touch({ ...d, goats: { ...d.goats, kidMortality: (d.goats.kidMortality || []).filter((r) => r.id !== id) } }));
  }
  function addGoatHealth(entry) {
    setData((d) => touch({ ...d, goats: { ...d.goats, health: [...(d.goats.health || []), entry] } }));
  }
  function deleteGoatHealth(id) {
    setData((d) => touch({ ...d, goats: { ...d.goats, health: (d.goats.health || []).filter((r) => r.id !== id) } }));
  }
  function addGoatWeight(entry) {
    setData((d) => touch({ ...d, goats: { ...d.goats, weights: [...(d.goats.weights || []), entry] } }));
  }
  function deleteGoatWeight(id) {
    setData((d) => touch({ ...d, goats: { ...d.goats, weights: (d.goats.weights || []).filter((r) => r.id !== id) } }));
  }
  function addGoatSale(entry) {
    setData((d) => touch({ ...d, goats: { ...d.goats, sales: [...(d.goats.sales || []), entry] } }));
    if (entry.animalId) updateGoat(entry.animalId, { status: 'sold' });
  }
  function deleteGoatSale(id) {
    setData((d) => touch({ ...d, goats: { ...d.goats, sales: (d.goats.sales || []).filter((r) => r.id !== id) } }));
  }

  if (showCloudSetup) {
    return (
      <CloudSetupScreen
        onDone={() => { setCloudReady(isCloudConfigured()); setShowCloudSetup(false); }}
        onCancel={() => setShowCloudSetup(false)}
      />
    );
  }

  // Cloud is configured but nobody is signed in — show the login screen.
  if (cloudReady && !user) {
    return <AuthScreen onSignedIn={handleSignedIn} onSetupCloud={() => setShowCloudSetup(true)} />;
  }

  return (
    <div className="app">
      <InstallPrompt />
      <div className="workspace-switch">
        <button
          className={`ws-btn${workspace === 'poultry' ? ' active' : ''}`}
          onClick={() => { setWorkspace('poultry'); setModal(null); }}
        >Poultry</button>
        <button
          className={`ws-btn${workspace === 'pepper' ? ' active pepper' : ''}`}
          onClick={() => { setWorkspace('pepper'); setModal(null); }}
        >Bell Pepper Fields</button>
        <button
          className={`ws-btn${workspace === 'goats' ? ' active goats' : ''}`}
          onClick={() => { setWorkspace('goats'); setModal(null); }}
        >Goats</button>
        <button
          className={`ws-btn${workspace === 'farm' ? ' active' : ''}`}
          onClick={() => { setWorkspace('farm'); setModal(null); }}
        >Whole Farm</button>
      </div>

      <SyncBar
        sync={sync}
        user={user}
        cloudReady={cloudReady}
        onSetupCloud={() => setShowCloudSetup(true)}
        onSync={() => syncNow('auto')}
        onPull={() => syncNow('pull')}
        onSignOut={handleSignOut}
        onEditProfile={() => setShowProfileForm(true)}
      />

      {sync.message && sync.message.includes('restored automatically') && (
        <div className="stale-banner" style={{ marginBottom: 18, borderColor: 'rgba(122, 154, 102, 0.5)' }}>
          🌱 <span>
            This device had far less data than your cloud account, so the app pulled your real data back
            down automatically instead of overwriting it. If anything looks missing, check{' '}
            <strong>Backup</strong> or your Supabase <code>farm_state_history</code> table for older versions.
          </span>
        </div>
      )}

      {workspace === 'poultry' && (<>
      <header className="header">
        <div>
          <p className="brand-eyebrow">{data.farmProfile.farmName || 'My Farm'} · Poultry Operations</p>
          <h1 className="brand-title">{activeFlock.flockName}</h1>
          <p className="brand-sub">
            {activeFlock.breed} · started {fmtDate(activeFlock.startDate)} · {activeFlock.location}
            {' '}<button className="link-btn" onClick={() => setModal(`flock:${activeFlock.id}`)}>Edit flock</button>
          </p>
        </div>
        <div className="day-stamp">
          <DayRing pct={survivalRate ? survivalRate / 100 : 1} />
          <div>
            <div className="num">Day {dayNumber} <span className="week-chip">Wk {weekNumber}</span></div>
            <div className="label">{num(survivalRate, 1)}% survival</div>
          </div>
        </div>
      </header>

      {currentBirds === 0 && activeFlock.status !== 'completed' && (
        <div className="stale-banner" style={{ marginBottom: 18, borderColor: 'rgba(122, 154, 102, 0.5)' }}>
          ✓ <span>
            <strong>{activeFlock.flockName}</strong> shows 0 birds — fully sold, culled, or moved on?
            Its Daily Log, Sales &amp; Profit, and every record stay exactly as they are either way; marking
            it Completed just clears it from your everyday flock switcher.
          </span>
          <button className="btn btn-green" style={{ marginLeft: 12 }} onClick={() => saveFlock({ ...activeFlock, status: 'completed' })}>
            Mark Completed
          </button>
        </div>
      )}

      <div className="seg-row">
        <div className="flock-seg">
          {data.flocks
            .filter((f) => f.status !== 'completed' || showCompletedFlocks || f.id === activeFlockId)
            .map((f) => (
              <button key={f.id} className={activeFlockId === f.id ? 'active' : ''} onClick={() => { setActiveFlockId(f.id); setModal(null); }}>
                {f.flockName}{f.status === 'completed' ? ' ✓' : ''}
              </button>
            ))}
          <button className="seg-add" onClick={() => setModal('flock:new')} title="Add a flock / new batch">+ Flock</button>
          {data.flocks.some((f) => f.status === 'completed') && (
            <button className="seg-add" onClick={() => setShowCompletedFlocks((v) => !v)}>
              {showCompletedFlocks ? 'Hide completed' : 'Show completed'}
            </button>
          )}
        </div>
        <div className="data-tools">
          <button className="btn" onClick={backupData} title="Download all data as a backup file">⤓ Backup</button>
          <button className="btn" onClick={() => restoreInputRef.current && restoreInputRef.current.click()} title="Restore from a backup file">⤒ Restore</button>
          <input
            ref={restoreInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files[0]) restoreData(e.target.files[0]); e.target.value = ''; }}
          />
        </div>
      </div>

      {isStale && (
        <div className="stale-banner">
          ⚠ <span>No daily log entries in <strong>{daysSinceLastEntry} days</strong> (last entry {fmtDate(latest.date)}). Numbers below may be out of date — log today's count to catch up.</span>
        </div>
      )}

      <nav className="tabs">
        {[
          ['dashboard', 'Dashboard'],
          ['log', 'Daily Log'],
          ['feed', 'Feed & Inventory'],
          ['mix', 'Feed Mix'],
          ['litter', 'Litter & Manure'],
          ['growth', 'Growth'],
          ...(activeFlock.type === 'layer' ? [['laying', 'Laying & Eggs']] : []),
          ['sales', 'Sales & Profit'],
          ['health', 'Health'],
          ['reminders', 'Reminders'],
        ].map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'dashboard' && (
        <DashboardTab
          currentBirds={currentBirds}
          totalMortality={totalMortality}
          survivalRate={survivalRate}
          totalFeed={totalFeed}
          feedBalance={feedBalance}
          totalFeedCost={totalFeedCost}
          feedCostPerBird={feedCostPerBird}
          henDayPct={henDayPct}
          totalEggs={totalEggs}
          totalCracked={totalCracked}
          eggsToday={eggsToday}
          eggsThisWeek={eggsThisWeek}
          weeksToPOL={weeksToPOL}
          polWeek={POL_WEEK}
          currentFeedPhase={currentFeedPhase}
          standardWeight={standardWeight}
          latestSample={latestSample}
          flockType={activeFlock.type}
          fcr={fcr}
          fcrTarget={fcrTarget}
          totalRevenue={totalRevenue}
          flockCost={flockCost}
          flockMargin={flockMargin}
          feedDaysLeft={feedDaysLeft}
          avgDailyFeed={avgDailyFeed}
          daysSinceLitterChange={daysSinceLitterChange}
          litterCondition={litterCondition}
          litterDue={litterDue}
          manureHarvested={manureHarvested}
          mortalityByCause={mortalityByCause}
          chartData={chartData}
          feedChartData={feedChartData}
          growthChartData={growthChartData}
          vaxStatus={vaxStatus}
          vaxPending={vaxPending}
          onExport={exportWeeklyReport}
        />
      )}

      {tab === 'log' && (
        <LogTab
          dailyLog={[...dailyLog].reverse()}
          flockStartDate={activeFlock.startDate}
          onAdd={() => { setEditingLog(null); setModal('log'); }}
          onEdit={(entry) => { setEditingLog(entry); setModal('log'); }}
          onDelete={deleteDailyLog}
        />
      )}

      {tab === 'feed' && (
        <FeedTab
          feed={[...feed].reverse()}
          ledger={[...feedLedger].reverse()}
          feedDaysLeft={feedDaysLeft}
          avgDailyFeed={avgDailyFeed}
          feedBalance={feedBalance}
          onAdd={() => { setEditingFeed(null); setModal('feed'); }}
          onEdit={(entry) => { setEditingFeed(entry); setModal('feed'); }}
          onDelete={deleteFeed}
        />
      )}

      {tab === 'mix' && (
        <FeedMixTab
          recipes={data.recipes || []}
          flock={activeFlock}
          onSave={saveRecipe}
          onDelete={deleteRecipe}
        />
      )}

      {tab === 'litter' && (
        <LitterTab
          rows={[...litter].reverse()}
          daysSinceChange={daysSinceLitterChange}
          condition={litterCondition}
          due={litterDue}
          manureHarvested={manureHarvested}
          litterCost={litterCost}
          onAdd={() => { setEditingLitter(null); setModal('litter'); }}
          onEdit={(entry) => { setEditingLitter(entry); setModal('litter'); }}
          onDelete={deleteLitter}
        />
      )}

      {tab === 'growth' && (
        <GrowthTab
          weightSamples={[...weightSamples].reverse()}
          growthChartData={growthChartData}
          feedStandard={flockStandard}
          flockType={activeFlock.type}
          onAdd={() => setModal('weight')}
        />
      )}

      {tab === 'laying' && (
        <LayingEggsTab
          actualFirstEggDate={actualFirstEggDate}
          daysSinceFirstEgg={daysSinceFirstEgg}
          weeksToPOL={weeksToPOL}
          polWeek={POL_WEEK}
          henDayPct={henDayPct}
          weeklyLayPct={weeklyLayPct}
          monthlyLayPct={monthlyLayPct}
          standardLayPct={standardLayPct}
          layTrendData={layTrendData}
          layPeak={layPeak}
          eggLedger={[...eggLedger].reverse()}
          eggsInStock={eggsInStock}
          totalEggs={totalEggs}
          totalCracked={totalCracked}
          eggRevenue={eggRevenue}
          eggRevenueToday={eggRevenueToday}
          eggRevenueWeek={eggRevenueWeek}
          eggRevenueMonth={eggRevenueMonth}
          avgEggPrice={avgEggPrice}
          costPerEgg={costPerEgg}
          eggMarginPerEgg={eggMarginPerEgg}
          crackedValueLost={crackedValueLost}
          layDropAlert={layDropAlert}
          growerLayerMismatch={growerLayerMismatch}
        />
      )}

      {tab === 'sales' && (
        <SalesTab
          sales={[...sales].reverse()}
          flock={activeFlock}
          totalRevenue={totalRevenue}
          flockCost={flockCost}
          flockMargin={flockMargin}
          totalFeedCost={totalFeedCost}
          litterCost={litterCost}
          coopCharge={coopCharge}
          coopInvested={coopInvested}
          flockRunning={flockRunning}
          onAdd={() => setModal('sale')}
          onEditFlock={() => setModal(`flock:${activeFlock.id}`)}
          onInvoice={openInvoiceFromSale}
        />
      )}

      {tab === 'reminders' && (
        <RemindersTab
          reminders={data.reminders || []}
          scope="poultry"
          autoItems={[
            ...vaxPending.map((v) => ({
              id: `vax-${v.id}`,
              title: `${v.disease || v.vaccine} vaccination — confirm in Health`,
              dueDate: v.dueDate,
              daysLeft: v.daysLeft,
              source: activeFlock.flockName,
            })),
            ...(feedDaysLeft != null && feedDaysLeft <= 7 ? [{
              id: 'feed-runout',
              title: `Reorder feed — about ${feedDaysLeft} day(s) left in store`,
              dueDate: addDaysISO(todayISO(), Math.max(feedDaysLeft - 2, 0)),
              source: activeFlock.flockName,
            }] : []),
            ...(litterDue ? [{
              id: 'litter-due',
              title: `Litter change due (${daysSinceLitterChange} days since last)`,
              dueDate: todayISO(),
              source: activeFlock.flockName,
            }] : []),
            ...(litterCondition === 'Wet' || litterCondition === 'Caked' ? [{
              id: 'litter-condition',
              title: `Litter logged as ${litterCondition.toLowerCase()} — turn or top up to avoid ammonia`,
              dueDate: todayISO(),
              source: activeFlock.flockName,
            }] : []),
            ...meds
              .map((m) => ({ med: m, status: medCourseStatus(m) }))
              .filter(({ med, status }) => status.activeToday && !(med.daysGiven || []).includes(todayISO()) && !status.complete)
              .map(({ med, status }) => ({
                id: `med-${med.id}-${todayISO()}`,
                title: `Give ${med.drug} — day ${status.givenCount + 1} of ${status.total}`,
                dueDate: todayISO(),
                source: activeFlock.flockName,
              })),
            ...(layDropAlert ? [{
              id: 'lay-drop',
              title: `Laying rate has dropped this week — now averaging ${num(weeklyLayPct, 1)}%`,
              dueDate: todayISO(),
              source: activeFlock.flockName,
            }] : []),
            ...(growerLayerMismatch ? [{
              id: 'grower-layer-mismatch',
              title: 'Eggs have started — confirm the feeder actually has Layer feed in it',
              dueDate: todayISO(),
              source: activeFlock.flockName,
            }] : []),
          ]}
          onAdd={() => setModal('reminder')}
          onToggle={toggleReminder}
          onDelete={deleteReminder}
        />
      )}

      {tab === 'health' && (
        <HealthTab
          meds={meds}
          vax={[...vaxSchedule].reverse()}
          vaxStatus={vaxStatus}
          vaxPending={vaxPending}
          flock={activeFlock}
          onSetVaxStatus={setVaxStatus}
          onDeleteVax={deleteVax}
          onLoadTemplate={applyVaxTemplate}
          onAddMed={() => setModal('med')}
          onAddVax={() => setModal('vax')}
          onToggleMedDay={toggleMedDay}
          onDeleteMed={deleteMed}
        />
      )}

      {modal === 'log' && (
        <LogForm
          entry={editingLog}
          lastClosing={latest ? latest.closing : activeFlock.initialBirds}
          flockStartDate={activeFlock.startDate}
          onClose={() => { setModal(null); setEditingLog(null); }}
          onSave={(e) => {
            if (editingLog) updateDailyLog(editingLog.id, e);
            else addDailyLog(e);
            setModal(null);
            setEditingLog(null);
          }}
        />
      )}
      {modal === 'feed' && (
        <FeedForm
          entry={editingFeed}
          lastBalance={feedBalance}
          onClose={() => { setModal(null); setEditingFeed(null); }}
          onSave={(e) => {
            if (editingFeed) updateFeed(editingFeed.id, e);
            else addFeed(e);
            setModal(null);
            setEditingFeed(null);
          }}
        />
      )}
      {modal === 'med' && (
        <MedForm onClose={() => setModal(null)} onSave={(e) => { addMed(e); setModal(null); }} />
      )}
      {modal === 'vax' && (
        <VaxForm flockStartDate={activeFlock.startDate} onClose={() => setModal(null)} onSave={(e) => { addVax(e); setModal(null); }} />
      )}
      {modal === 'weight' && (
        <WeightForm onClose={() => setModal(null)} onSave={(e) => { addWeightSample(e); setModal(null); }} />
      )}
      {modal === 'sale' && (
        <SaleForm flock={activeFlock} onClose={() => setModal(null)} onSave={(e) => { addSale(e); setModal(null); }} />
      )}
      {modal === 'litter' && (
        <LitterForm
          entry={editingLitter}
          fields={data.pepper.fields}
          onClose={() => { setModal(null); setEditingLitter(null); }}
          onSave={(e) => {
            if (editingLitter) updateLitter(editingLitter.id, e);
            else addLitter(e);
            setModal(null);
            setEditingLitter(null);
          }}
        />
      )}
      {modal === 'reminder' && (
        <ReminderForm scope="poultry" onClose={() => setModal(null)} onSave={(e) => { addReminder(e); setModal(null); }} />
      )}
      {modal && modal.startsWith('flock:') && (
        <FlockForm
          flock={modal === 'flock:new' ? null : data.flocks.find((f) => f.id === modal.split(':')[1])}
          existingIds={data.flocks.map((f) => f.id)}
          onClose={() => setModal(null)}
          onSave={(f) => { saveFlock(f); setModal(null); }}
        />
      )}
      </>)}

      {workspace === 'pepper' && (
        <PepperWorkspace
          pepper={data.pepper}
          farmProfile={data.farmProfile}
          reminders={data.reminders || []}
          expenses={data.expenses || []}
          onUpdateField={updateField}
          onAddScouting={addScouting}
          onAddSpray={addSpray}
          onAddHarvest={addHarvest}
          onAddInput={addInput}
          onUpdateInput={updateInput}
          onDeleteInput={deleteInput}
          onAddReminder={addReminder}
          onToggleReminder={toggleReminder}
          onDeleteReminder={deleteReminder}
          onAddManureReading={addManureReading}
          onDeleteManureReading={deleteManureReading}
          onAddSoilReading={addSoilReading}
          onDeleteSoilReading={deleteSoilReading}
          onStartNewBatch={startNewBatch}
          onDeleteBatch={deleteBatch}
          onAddNurseryBatch={addNurseryBatch}
          onUpdateNurseryBatch={updateNurseryBatch}
          onDeleteNurseryBatch={deleteNurseryBatch}
          onTransplantNurseryBatch={transplantNurseryBatch}
          onInvoiceHarvest={openInvoiceFromHarvest}
        />
      )}

      {workspace === 'goats' && (
        <GoatWorkspace
          goats={data.goats}
          farmProfile={data.farmProfile}
          reminders={data.reminders || []}
          expenses={data.expenses || []}
          onAddGoat={addGoat}
          onUpdateGoat={updateGoat}
          onDeleteGoat={deleteGoat}
          onAddHeat={addHeat}
          onDeleteHeat={deleteHeat}
          onAddMating={addMating}
          onDeleteMating={deleteMating}
          onAddKidding={addKidding}
          onDeleteKidding={deleteKidding}
          onAddKidMortality={addKidMortality}
          onDeleteKidMortality={deleteKidMortality}
          onAddHealth={addGoatHealth}
          onDeleteHealth={deleteGoatHealth}
          onAddWeight={addGoatWeight}
          onDeleteWeight={deleteGoatWeight}
          onAddSale={addGoatSale}
          onDeleteSale={deleteGoatSale}
          onAddReminder={addReminder}
          onToggleReminder={toggleReminder}
          onDeleteReminder={deleteReminder}
          onInvoiceSale={openInvoiceFromGoatSale}
        />
      )}

      {workspace === 'farm' && (
        <FarmWorkspace
          data={data}
          onAddExpense={addExpense}
          onUpdateExpense={updateExpense}
          onDeleteExpense={deleteExpense}
          onSaveStaff={saveStaff}
          onDeleteStaff={deleteStaff}
          onNewInvoice={() => setInvoicePrefill({ kind: 'invoice', date: todayISO(), buyerName: '', item: '', quantity: '', unitPrice: '', amount: '' })}
          onDeleteInvoice={deleteInvoice}
          onAddBsfBatch={addBsfBatch}
          onUpdateBsfBatch={updateBsfBatch}
          onDeleteBsfBatch={deleteBsfBatch}
        />
      )}

      {modal === 'sync' && null}

      {invoicePrefill && (
        <InvoiceModal
          prefill={invoicePrefill}
          invoices={data.invoices || []}
          farmProfile={data.farmProfile}
          onSave={addInvoice}
          onClose={() => setInvoicePrefill(null)}
        />
      )}

      {showProfileForm && (
        <FarmProfileForm
          profile={data.farmProfile}
          onSave={(p) => { updateFarmProfile(p); setShowProfileForm(false); }}
          onClose={() => setShowProfileForm(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

function DashboardTab({
  currentBirds, totalMortality, survivalRate, totalFeed, feedBalance,
  totalFeedCost, feedCostPerBird, henDayPct, totalEggs, totalCracked, eggsToday, eggsThisWeek,
  weeksToPOL, polWeek, currentFeedPhase, standardWeight, latestSample,
  flockType, fcr, fcrTarget, totalRevenue, flockCost, flockMargin,
  feedDaysLeft, avgDailyFeed, daysSinceLitterChange, litterCondition, litterDue, manureHarvested,
  mortalityByCause, chartData, feedChartData, growthChartData, vaxStatus, vaxPending, onExport,
}) {
  const causeEntries = Object.entries(mortalityByCause);
  const isBroiler = flockType === 'broiler';
  // A layer flock racks up 365+ daily entries a year — plotting all of them
  // slows the charts down for no real benefit, since the last few months
  // are what actually matters day to day. Default to a 90-day window with
  // the option to see everything.
  const [chartWindow, setChartWindow] = useState(90);
  const windowedChart = chartWindow === 0 ? chartData : chartData.slice(-chartWindow);
  const windowedFeedChart = chartWindow === 0 ? feedChartData : feedChartData.slice(-chartWindow);
  const feedTone = feedDaysLeft == null ? undefined : feedDaysLeft <= 3 ? 'rust' : feedDaysLeft <= 7 ? 'gold' : 'green';
  const litterTone = litterCondition === 'Wet' || litterCondition === 'Caked' ? 'rust'
    : litterDue ? 'gold' : litterCondition ? 'green' : undefined;
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Overview</h3>
        <button className="btn" onClick={onExport}>⤓ Export weekly report</button>
      </div>

      <div className="grid grid-4">
        <StatCard title="Current Flock" value={num(currentBirds)} tone="gold" foot="birds on hand" />
        <StatCard title="Total Mortality" value={num(totalMortality)} tone="rust" foot={`${num(survivalRate, 1)}% survival`} />
        <StatCard title="Feed Used" value={`${num(totalFeed, 1)} kg`} foot={totalFeedCost ? `GH₵ ${num(totalFeedCost, 2)} spent` : 'cumulative to date'} />
        <StatCard title="Feed Balance" value={feedBalance !== null ? `${num(feedBalance, 1)} kg` : '—'} tone="green" foot="in store" />
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        {isBroiler ? (
          <StatCard
            title="FCR (to date)"
            value={fcr != null ? num(fcr, 2) : '—'}
            tone={fcr != null ? (fcr <= fcrTarget ? 'green' : 'rust') : undefined}
            foot={fcr != null ? `target ≤ ${num(fcrTarget, 2)} · kg feed / kg bird` : 'log feed + a weight sample'}
          />
        ) : (
          <StatCard
            title="Hen-Day Egg %"
            value={henDayPct !== null ? `${num(henDayPct, 1)}%` : '—'}
            tone="green"
            foot={totalEggs ? `${num(totalEggs)} eggs total, ${num(totalCracked)} cracked` : 'not laying yet'}
          />
        )}
        {isBroiler ? (
          <StatCard
            title="Avg Weight"
            value={latestSample ? `${num(latestSample.avgWeightG)} g` : '—'}
            tone={latestSample && standardWeight ? (latestSample.avgWeightG >= standardWeight ? 'green' : 'rust') : undefined}
            foot={standardWeight ? `target ${num(standardWeight)} g this week` : 'weigh a sample to compare'}
          />
        ) : (
          <StatCard
            title="Point of Lay"
            value={weeksToPOL > 0 ? `${weeksToPOL} wks away` : 'Reached'}
            tone="gold"
            foot={`standard ~week ${polWeek}`}
          />
        )}
        <StatCard
          title="Feed Phase"
          value={currentFeedPhase || '—'}
          foot="per breed feeding standard"
        />
        {isBroiler ? (
          <StatCard title="Feed Cost" value={totalFeedCost ? `GH₵ ${num(totalFeedCost, 2)}` : '—'} tone="rust" foot="total spent, this flock" />
        ) : (
          <StatCard
            title="Weight vs Standard"
            value={latestSample ? `${num(latestSample.avgWeightG)} g` : '—'}
            tone={latestSample && standardWeight ? (latestSample.avgWeightG >= standardWeight ? 'green' : 'rust') : undefined}
            foot={standardWeight ? `target ${num(standardWeight)} g this week` : 'no standard for this week'}
          />
        )}
      </div>

      {!isBroiler && (
        <div className="grid grid-4" style={{ marginTop: 16 }}>
          <StatCard
            title="Crates Today"
            value={num(eggsToday / CRATE_SIZE, 1)}
            tone="green"
            foot={`${num(eggsToday)} egg${eggsToday === 1 ? '' : 's'} · ${CRATE_SIZE}/crate`}
          />
          <StatCard
            title="Crates This Week"
            value={num(eggsThisWeek / CRATE_SIZE, 1)}
            tone="gold"
            foot={`${num(eggsThisWeek)} eggs, last 7 days`}
          />
        </div>
      )}

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <StatCard title="Revenue" value={`GH₵ ${num(totalRevenue, 2)}`} tone="green" foot="sales logged for this flock" />
        <StatCard title="Cost" value={`GH₵ ${num(flockCost, 2)}`} tone="rust" foot="feed + litter + setup" />
        <StatCard title="Margin" value={`GH₵ ${num(flockMargin, 2)}`} tone={flockMargin >= 0 ? 'green' : 'rust'} foot={flockMargin >= 0 ? 'in profit' : 'below break-even'} />
        <StatCard title="Break-even" value={totalRevenue >= flockCost ? 'Reached' : `GH₵ ${num(flockCost - totalRevenue, 2)}`} foot={totalRevenue >= flockCost ? 'sales cover costs' : 'more sales to break even'} />
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <StatCard
          title="Feed Runs Out"
          value={feedDaysLeft != null ? (feedDaysLeft <= 0 ? 'Out of stock' : `${feedDaysLeft} days`) : '—'}
          tone={feedTone}
          foot={avgDailyFeed ? `using ~${num(avgDailyFeed, 1)} kg/day` : 'log feed use to project'}
        />
        <StatCard
          title="Litter Age"
          value={daysSinceLitterChange != null ? `${daysSinceLitterChange} days` : '—'}
          tone={litterTone}
          foot={litterDue ? 'change due' : (litterCondition ? `last logged ${litterCondition.toLowerCase()}` : 'no litter logged')}
        />
        <StatCard
          title="Manure Banked"
          value={manureHarvested ? `${num(manureHarvested, 1)} bags` : '—'}
          tone="green"
          foot="cleared litter sent to fields"
        />
        <StatCard title="Feed / Bird" value={feedCostPerBird ? `GH₵ ${num(feedCostPerBird, 2)}` : '—'} foot="feed cost per bird" />
      </div>

      <div className="panel-head" style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Trends</h3>
        <div className="field-seg" style={{ marginBottom: 0 }}>
          {[[30, '30d'], [90, '90d'], [180, '180d'], [0, 'All']].map(([d, label]) => (
            <button key={d} className={chartWindow === d ? 'active' : ''} onClick={() => setChartWindow(d)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Flock population &amp; daily mortality</h3></div>
        <div className="chart-card">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={windowedChart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#423827' }} />
              <YAxis yAxisId="left" tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#B9AD9A' }} />
              <Area yAxisId="left" type="monotone" dataKey="closing" name="Birds" fill="#D4A53722" stroke="#D4A537" strokeWidth={2} />
              <Bar yAxisId="right" dataKey="mortality" name="Deaths" fill="#C15F41" barSize={10} radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head"><h3>Feed given per day (kg)</h3></div>
          <div className="chart-card">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={windowedChart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#423827' }} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="feedGiven" name="Feed (kg)" fill="#7A9A6622" stroke="#7A9A66" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Feed store balance (kg)</h3></div>
          <div className="chart-card">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={windowedFeedChart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#423827' }} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="balance" name="Balance (kg)" fill="#D4A53722" stroke="#D4A537" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head"><h3>Growth vs. breed standard (g)</h3></div>
          <div className="chart-card">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={growthChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: '#423827' }} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#B9AD9A' }} />
                <Line type="monotone" dataKey="standard" name="Standard" stroke="#83786A" strokeWidth={2} dot={false} strokeDasharray="4 3" />
                <Line type="monotone" dataKey="actual" name="Your sample" stroke="#D4A537" strokeWidth={2} connectNulls dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Mortality by cause</h3></div>
          {causeEntries.length === 0 ? (
            <p className="empty">No cause-of-death tags recorded yet — add one next time you log a death.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Cause</th><th>Birds lost</th></tr></thead>
                <tbody>
                  {causeEntries.map(([cause, n]) => (
                    <tr key={cause}><td>{cause}</td><td className="mono">{num(n)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p className="section-title">Vaccinations</p>
      {vaxPending && vaxPending.length > 0 && (
        <p className="stat-foot" style={{ marginTop: -6, marginBottom: 12 }}>
          <strong style={{ color: 'var(--gold)' }}>{vaxPending.length} scheduled shot(s)</strong> waiting
          for you to confirm whether they were given. Open the Health tab to mark them.
        </p>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Disease</th><th>Status</th><th>Date</th><th>Method</th></tr>
          </thead>
          <tbody>
            {(vaxPending || []).map((v) => (
              <tr key={`p-${v.id}`}>
                <td>{v.disease || v.vaccine}</td>
                <td><span className="tag gold">To confirm</span></td>
                <td className="mono">{fmtDate(v.dueDate)}</td>
                <td>{v.method || '—'}</td>
              </tr>
            ))}
            {vaxStatus.map((v) => (
              <tr key={`d-${v.id}`}>
                <td>{v.disease || v.vaccine}</td>
                <td><span className="tag green">Done</span></td>
                <td className="mono">{fmtDate(v.date)}</td>
                <td>{v.method || '—'}</td>
              </tr>
            ))}
            {vaxStatus.length === 0 && (!vaxPending || vaxPending.length === 0) && (
              <tr><td colSpan={4} className="empty">No vaccination records yet — load a programme from the Health tab.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Daily Log tab ---------------- */

function LogTab({ dailyLog, flockStartDate, onAdd, onEdit, onDelete }) {
  const { askConfirm } = useToastConfirm();
  // A layer flock racks up hundreds of rows a year — render a page at a
  // time instead of the whole table, which gets sluggish to scroll well
  // before it gets genuinely large.
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visible = dailyLog.slice(0, visibleCount);
  const hasMore = dailyLog.length > visibleCount;

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Daily Log</h3>
        <button className="btn btn-gold" onClick={onAdd}>+ Log today's entry</button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th><th>Age (d)</th><th>Opening</th><th>Mortality</th><th>Cause</th><th>Culls</th>
              <th>Closing</th><th>Feed (kg)</th><th>Water (L)</th><th>Light (h)</th><th>Eggs</th><th>Cracked</th><th>Meds/Vax</th><th>Notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              // Bird age is always derived from arrival date + this entry's
              // own date — never trusted from storage, so it's correct even
              // for old records or ones logged after the fact. +1 so arrival
              // day is "Day 1", matching the dashboard's Day/Week ring.
              const age = flockStartDate && r.date ? daysBetween(flockStartDate, r.date) + 1 : null;
              return (
              <tr key={r.id || r.date}>
                <td className="mono">{fmtDate(r.date)}</td>
                <td className="mono">{age != null ? age : '—'}</td>
                <td className="mono">{num(r.opening)}</td>
                <td className="mono">{r.mortality ? <span style={{ color: 'var(--rust)' }}>{num(r.mortality)}</span> : num(r.mortality)}</td>
                <td>{r.mortalityCause ? <span className="tag rust">{r.mortalityCause}</span> : '—'}</td>
                <td className="mono">{num(r.culls)}</td>
                <td className="mono">{num(r.closing)}</td>
                <td className="mono">{r.feedGiven != null ? num(r.feedGiven, 2) : '—'}</td>
                <td className="mono">{r.waterGiven != null ? num(r.waterGiven, 1) : '—'}</td>
                <td className="mono">{r.lightHours != null ? num(r.lightHours, 1) : '—'}</td>
                <td className="mono">{num(r.eggs)}</td>
                <td className="mono">{num(r.eggsCracked)}</td>
                <td>{r.medication || '—'}</td>
                <td className="notes">{r.notes || ''}</td>
                <td>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button className="link-btn" onClick={() => onEdit(r)}>Edit</button>
                    {r.id && onDelete && (
                      <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this entry?')) onDelete(r.id); }}>Delete</button>
                    )}
                  </span>
                </td>
              </tr>
              );
            })}
            {dailyLog.length === 0 && <tr><td colSpan={15} className="empty">No entries yet — log the first day.</td></tr>}
          </tbody>
        </table>
      </div>
      {dailyLog.length > 0 && (
        <p className="stat-foot" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          Showing {visible.length} of {dailyLog.length} entries
          {hasMore && (
            <>
              <button className="link-btn" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>Show 30 more</button>
              <button className="link-btn" onClick={() => setVisibleCount(dailyLog.length)}>Show all</button>
            </>
          )}
          {!hasMore && visibleCount > PAGE_SIZE && (
            <button className="link-btn" onClick={() => setVisibleCount(PAGE_SIZE)}>Show fewer</button>
          )}
        </p>
      )}
    </>
  );
}

function LogForm({ entry, lastClosing, flockStartDate, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const [f, setF] = useState({
    date: entry?.date || todayISO(),
    opening: entry?.opening ?? (lastClosing ?? ''),
    mortality: entry?.mortality ?? 0,
    mortalityCause: entry?.mortalityCause || '',
    culls: entry?.culls ?? 0,
    feedGiven: entry?.feedGiven ?? '',
    waterGiven: entry?.waterGiven ?? '',
    lightHours: entry?.lightHours ?? '',
    eggs: entry?.eggs ?? '',
    eggsCracked: entry?.eggsCracked ?? '',
    medication: entry?.medication || '',
    notes: entry?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const closing = (Number(f.opening) || 0) - (Number(f.mortality) || 0) - (Number(f.culls) || 0);
  // A flock can't have a negative bird count — mortality + culls exceeding
  // opening is always a typo, not a real farm event, so this blocks the
  // save instead of quietly producing a number that poisons every other
  // calculation downstream (survival %, current flock, cost per bird).
  const closingError = closing < 0
    ? `Mortality + culls (${(Number(f.mortality) || 0) + (Number(f.culls) || 0)}) is more than the opening count (${Number(f.opening) || 0}) — closing can't go below 0.`
    : null;
  // Bird age always comes from arrival date + whatever date this entry is
  // for — so a backdated entry gets the right age automatically, and
  // there's nothing to type or get wrong. +1 so arrival day is "Day 1",
  // matching the dashboard's Day/Week ring.
  const birdAge = flockStartDate && f.date ? daysBetween(flockStartDate, f.date) + 1 : null;

  function submit() {
    if (!f.date || f.opening === '' || closingError) return;
    onSave({
      id: entry?.id || newId(),
      date: f.date,
      birdAge,
      opening: Number(f.opening),
      mortality: Number(f.mortality) || 0,
      mortalityCause: Number(f.mortality) > 0 ? (f.mortalityCause || null) : null,
      culls: Number(f.culls) || 0,
      closing,
      feedGiven: f.feedGiven === '' ? null : Number(f.feedGiven),
      waterGiven: f.waterGiven === '' ? null : Number(f.waterGiven),
      lightHours: f.lightHours === '' ? null : Number(f.lightHours),
      eggs: f.eggs === '' ? null : Number(f.eggs),
      eggsCracked: f.eggsCracked === '' ? null : Number(f.eggsCracked),
      medication: f.medication || null,
      notes: f.notes || null,
    });
  }

  return (
    <Modal
      title={isEdit ? `Edit entry — ${fmtDate(f.date)}` : "Log today's entry"}
      sub={isEdit ? 'Editing an existing day does not change any other day\'s opening count.' : "Opening count defaults to yesterday's closing."}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Bird age (auto)"><input value={birdAge != null ? `${birdAge} days` : 'set flock start date'} disabled /></Field>
        <Field label="Opening birds"><input type="number" value={f.opening} onChange={set('opening')} /></Field>
        <Field label="Mortality"><input type="number" value={f.mortality} onChange={set('mortality')} /></Field>
        <Field label="Cause of death">
          <select value={f.mortalityCause} onChange={set('mortalityCause')} disabled={!Number(f.mortality)}>
            <option value="">—</option>
            <option>Disease</option>
            <option>Predator</option>
            <option>Heat/cold stress</option>
            <option>Injury</option>
            <option>Unknown</option>
            <option>Other</option>
          </select>
        </Field>
        <Field label="Culls"><input type="number" value={f.culls} onChange={set('culls')} /></Field>
        <Field label="Closing (auto)">
          <input value={closing} disabled style={closingError ? { color: 'var(--rust)', borderColor: 'var(--rust)' } : undefined} />
        </Field>
        {closingError && (
          <div className="field span-2">
            <p className="stat-foot" style={{ margin: 0, color: 'var(--rust)' }}>⚠ {closingError}</p>
          </div>
        )}
        <Field label="Feed given (kg)"><input type="number" step="0.01" value={f.feedGiven} onChange={set('feedGiven')} /></Field>
        <Field label="Water given (L)"><input type="number" step="0.1" value={f.waterGiven} onChange={set('waterGiven')} /></Field>
        <Field label="Light hours"><input type="number" step="0.5" value={f.lightHours} onChange={set('lightHours')} /></Field>
        <Field label="Eggs collected"><input type="number" value={f.eggs} onChange={set('eggs')} /></Field>
        <Field label="Eggs cracked/broken"><input type="number" value={f.eggsCracked} onChange={set('eggsCracked')} /></Field>
        <Field label="Medication / vaccine given" span2><input value={f.medication} onChange={set('medication')} /></Field>
        <Field label="Notes / observations" span2><textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit} disabled={Boolean(closingError)}>{isEdit ? 'Save changes' : 'Save entry'}</button>
      </div>
    </Modal>
  );
}

/* ---------------- Feed tab ---------------- */

function FeedTab({ feed, ledger, feedDaysLeft, avgDailyFeed, feedBalance, onAdd, onEdit, onDelete }) {
  const { askConfirm } = useToastConfirm();
  const totalCost = feed.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const totalPurchased = feed.reduce((s, r) => s + (Number(r.purchased) || 0), 0);
  return (
    <>
      {feedDaysLeft != null && feedDaysLeft <= 7 && (
        <div className="stale-banner" style={{ marginBottom: 12 }}>
          ⚠ <span>
            Feed store down to <strong>{num(feedBalance, 1)} kg</strong> — about <strong>{feedDaysLeft} day(s)</strong> left
            at ~{num(avgDailyFeed, 1)} kg/day. Reorder now so you don&apos;t run out.
          </span>
        </div>
      )}
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Feed &amp; Inventory</h3>
        <button className="btn btn-gold" onClick={onAdd}>+ Add purchase / adjustment</button>
      </div>

      <div className="grid grid-4">
        <StatCard
          title="In Store"
          value={feedBalance != null ? `${num(feedBalance, 1)} kg` : '—'}
          tone={feedBalance != null && feedBalance < 0 ? 'rust' : 'green'}
          foot={feedBalance != null && feedBalance < 0 ? 'more used than purchased — check entries' : 'live running balance'}
        />
        <StatCard title="Purchased" value={`${num(totalPurchased, 1)} kg`} tone="gold" foot="all-time" />
        <StatCard title="Spent" value={`GH₵ ${num(totalCost, 2)}`} tone="rust" foot="feed purchases" />
        <StatCard title="Used" value={feed.length || ledger.length ? `${num(ledger.reduce((s, e) => s + (e.kind === 'usage' ? -e.delta : 0), 0), 1)} kg` : '—'} foot="from Daily Log entries" />
      </div>

      <p className="stat-foot" style={{ margin: '14px 0' }}>
        The balance below updates automatically from two things: a <strong>purchase</strong> you log
        here, and the <strong>feed given</strong> you log each day in Daily Log. You don&apos;t need to
        enter usage twice — just keep Daily Log up to date and the store balance follows it.
      </p>

      <p className="section-title" style={{ marginTop: 0 }}>Purchases &amp; adjustments</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Feed type</th><th>Purchased (kg)</th><th>Adjustment</th><th>Cost (GH₵)</th><th>Supplier</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {feed.map((r) => (
              <tr key={r.id || r.date}>
                <td className="mono">{fmtDate(r.date)}</td>
                <td>{r.feedType || '—'}</td>
                <td className="mono">{r.purchased != null ? num(r.purchased, 1) : '—'}</td>
                <td className="mono">
                  {r.adjustment ? (
                    <span className={`tag ${r.adjustment < 0 ? 'rust' : 'green'}`}>
                      {r.adjustment > 0 ? '+' : ''}{num(r.adjustment, 1)}
                    </span>
                  ) : '—'}
                </td>
                <td className="mono">{r.cost != null ? num(r.cost, 2) : '—'}</td>
                <td>{r.supplier || '—'}</td>
                <td className="notes">{r.notes || ''}</td>
                <td>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button className="link-btn" onClick={() => onEdit(r)}>Edit</button>
                    {onDelete && r.id && (
                      <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this feed record?')) onDelete(r.id); }}>Delete</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {feed.length === 0 && <tr><td colSpan={8} className="empty">No purchases logged yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="section-title">Running balance (purchases &amp; daily usage combined)</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Event</th><th>Change (kg)</th><th>Balance after (kg)</th></tr>
          </thead>
          <tbody>
            {ledger.map((e, i) => (
              <tr key={i}>
                <td className="mono">{fmtDate(e.date)}</td>
                <td>
                  {e.kind === 'purchase'
                    ? <span className="tag green">Purchase{e.ref.feedType ? ` — ${e.ref.feedType}` : ''}</span>
                    : <span className="tag gold">Daily usage</span>}
                </td>
                <td className="mono">{e.delta > 0 ? '+' : ''}{num(e.delta, 1)}</td>
                <td className="mono"><strong>{num(e.balance, 1)}</strong></td>
              </tr>
            ))}
            {ledger.length === 0 && <tr><td colSpan={4} className="empty">Balance will build up here once you log a purchase or a day's feed given.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FeedForm({ entry, lastBalance, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const [f, setF] = useState({
    date: entry?.date || todayISO(),
    feedType: entry?.feedType || '',
    purchased: entry?.purchased ?? '',
    cost: entry?.cost ?? '',
    adjustment: entry?.adjustment ?? '',
    supplier: entry?.supplier || '',
    notes: entry?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // When editing, the current store balance already includes this record's
  // OLD numbers — back those out first so the preview reflects the correction,
  // not the correction stacked on top of the mistake.
  const oldContribution = isEdit ? (Number(entry.purchased) || 0) + (Number(entry.adjustment) || 0) : 0;
  const baseline = (Number(lastBalance) || 0) - oldContribution;
  const projected = baseline + (Number(f.purchased) || 0) + (Number(f.adjustment) || 0);

  function submit() {
    if (!f.date) return;
    onSave({
      id: entry?.id || newId(),
      date: f.date,
      feedType: f.feedType || null,
      purchased: f.purchased === '' ? null : Number(f.purchased),
      cost: f.cost === '' ? null : Number(f.cost),
      adjustment: f.adjustment === '' ? null : Number(f.adjustment),
      supplier: f.supplier || null,
      notes: f.notes || null,
    });
  }

  return (
    <Modal
      title={isEdit ? `Edit purchase — ${fmtDate(f.date)}` : 'Add purchase / adjustment'}
      sub={isEdit
        ? 'Fix the amount or cost — the store balance recalculates from the correction, not on top of the mistake.'
        : `Current store balance: ${lastBalance != null ? num(lastBalance, 1) : 0} kg. Daily usage is pulled in automatically from Daily Log — no need to enter it here.`}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Feed type"><input value={f.feedType} onChange={set('feedType')} placeholder="e.g. Grower Mash" /></Field>
        <Field label="Purchased (kg)"><input type="number" step="0.1" value={f.purchased} onChange={set('purchased')} /></Field>
        <Field label="Cost (GH₵)"><input type="number" step="0.01" value={f.cost} onChange={set('cost')} placeholder="if purchased today" /></Field>
        <Field label="Adjustment (kg)">
          <input type="number" step="0.1" value={f.adjustment} onChange={set('adjustment')} placeholder="e.g. -3 spillage, +5 recount" />
        </Field>
        <Field label="Supplier"><input value={f.supplier} onChange={set('supplier')} /></Field>
        <Field label="Balance after (auto)"><input value={num(projected, 1)} disabled /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>{isEdit ? 'Save changes' : 'Save record'}</button>
      </div>
    </Modal>
  );
}

/* ---------------- Health tab ---------------- */

/* ---------------- Health tab ---------------- */

function HealthTab({ meds, vax, vaxStatus, vaxPending, flock, onSetVaxStatus, onDeleteVax, onLoadTemplate, onAddMed, onAddVax, onToggleMedDay, onDeleteMed }) {
  const { askConfirm } = useToastConfirm();
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Health</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={onLoadTemplate}>⤓ Load {flock?.type === 'broiler' ? 'Ross 308' : 'Hy-Line'} programme</button>
          <button className="btn" onClick={onAddVax}>+ Vaccination</button>
          <button className="btn btn-gold" onClick={onAddMed}>+ Medication</button>
        </div>
      </div>

      <p className="stat-foot" style={{ marginTop: 0, marginBottom: 14 }}>
        Loading a programme fills in the standard schedule from this flock&apos;s start date. These are typical
        Ghanaian schedules — confirm them with your vet or hatchery, since local disease pressure varies.
      </p>

      {vaxPending && vaxPending.length > 0 && (
        <>
          <p className="section-title" style={{ marginTop: 0 }}>
            To confirm ({vaxPending.length})
          </p>
          <p className="stat-foot" style={{ marginTop: -6, marginBottom: 12 }}>
            These are scheduled, not recorded. Tell the app what actually happened —
            nothing is assumed either way.
          </p>
          <div className="confirm-list">
            {[...vaxPending].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).map((v) => (
              <div className="confirm-row" key={v.id}>
                <div className="confirm-main">
                  <div className="confirm-title">{v.disease || v.vaccine}</div>
                  <div className="confirm-sub">
                    {v.vaccine}{v.method ? ` · ${v.method}` : ''} · scheduled {fmtDate(v.dueDate)}
                    {v.daysLeft != null && (
                      v.daysLeft > 0 ? ` · in ${v.daysLeft}d`
                        : v.daysLeft === 0 ? ' · today'
                        : ` · ${Math.abs(v.daysLeft)}d ago`
                    )}
                  </div>
                </div>
                <div className="confirm-actions">
                  <button className="btn btn-green" onClick={() => onSetVaxStatus(v.id, 'done')}>Done</button>
                  <button className="btn" onClick={() => onSetVaxStatus(v.id, 'skipped')}>Not given</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="section-title">Vaccination schedule</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Status</th><th>Date</th><th>Vaccine</th><th>Disease</th><th>Method</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {vax.map((v) => (
              <tr key={v.id || `${v.disease}-${v.date}`}>
                <td>
                  {v.status === 'done' ? <span className="tag green">Done</span>
                    : v.status === 'skipped' ? <span className="tag rust">Not given</span>
                    : <span className="tag gold">Scheduled</span>}
                </td>
                <td className="mono">{fmtDate(v.status === 'planned' ? v.dueDate : v.date)}</td>
                <td>{v.vaccine}</td>
                <td>{v.disease}</td>
                <td>{v.method || '—'}</td>
                <td className="notes">{v.notes || ''}</td>
                <td>
                  <span style={{ display: 'flex', gap: 8 }}>
                    {v.status !== 'planned' && (
                      <button className="link-btn" onClick={() => onSetVaxStatus(v.id, 'planned')}>Undo</button>
                    )}
                    {onDeleteVax && v.id && (
                      <button className="link-btn rust" onClick={() => onDeleteVax(v.id)}>Delete</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {vax.length === 0 && <tr><td colSpan={7} className="empty">No vaccinations logged yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="section-title">Medications</p>
      {(() => {
        const active = meds
          .map((m) => ({ med: m, status: medCourseStatus(m) }))
          .filter(({ status }) => !status.complete && (status.activeToday || status.overdue));
        return active.length > 0 && (
          <>
            <p className="stat-foot" style={{ marginTop: -6, marginBottom: 12 }}>
              <strong style={{ color: 'var(--gold)' }}>{active.length} course(s) in progress</strong> — tap a day
              once it's actually been given.
            </p>
            <div className="confirm-list" style={{ marginBottom: 18 }}>
              {active.map(({ med, status }) => (
                <div className="confirm-row" key={med.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div className="confirm-main">
                      <div className="confirm-title">{med.drug}{med.purpose ? ` — ${med.purpose}` : ''}</div>
                      <div className="confirm-sub">
                        {med.dosage ? `${med.dosage} · ` : ''}{fmtDate(status.dates[0])}–{fmtDate(status.dates[status.dates.length - 1])}
                        {status.overdue && <span style={{ color: 'var(--rust)' }}> · a day was missed</span>}
                      </div>
                    </div>
                    <span className={`tag ${status.overdue ? 'rust' : 'gold'}`}>{status.givenCount}/{status.total} days</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {status.dates.map((d, i) => {
                      const given = (med.daysGiven || []).includes(d);
                      const missed = !given && d < todayISO();
                      return (
                        <button
                          key={d}
                          className={`day-chip${given ? ' given' : ''}${missed ? ' missed' : ''}`}
                          onClick={() => onToggleMedDay(med.id, d)}
                          title={fmtDate(d)}
                        >
                          {given ? '✓' : missed ? '!' : i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      })()}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Date</th><th>Drug</th><th>Purpose</th><th>Dosage</th><th>Duration</th><th>Progress</th><th>By</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {meds.map((m) => {
              const status = medCourseStatus(m);
              return (
                <tr key={m.id || m.date}>
                  <td className="mono">{fmtDate(m.date)}</td>
                  <td>{m.drug}</td>
                  <td>{m.purpose || '—'}</td>
                  <td>{m.dosage || '—'}</td>
                  <td className="mono">{m.duration ? `${m.duration}d` : '—'}</td>
                  <td>
                    <span className={`tag ${status.complete ? 'green' : status.overdue ? 'rust' : 'gold'}`}>
                      {status.givenCount}/{status.total}
                    </span>
                  </td>
                  <td>{m.by || '—'}</td>
                  <td className="notes">{m.notes || ''}</td>
                  <td>{m.id && onDeleteMed && <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this medication record?')) onDeleteMed(m.id); }}>Delete</button>}</td>
                </tr>
              );
            })}
            {meds.length === 0 && <tr><td colSpan={9} className="empty">No medications logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MedForm({ onClose, onSave }) {
  const [f, setF] = useState({ date: todayISO(), drug: '', purpose: '', dosage: '', duration: '', by: 'Oscar', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const duration = f.duration === '' ? 1 : Math.max(1, Number(f.duration) || 1);
  const end = addDaysISO(f.date, duration - 1);
  function submit() {
    if (!f.date || !f.drug) return;
    onSave({
      id: newId(),
      date: f.date, drug: f.drug, purpose: f.purpose || null, dosage: f.dosage || null,
      duration: f.duration === '' ? null : Number(f.duration), start: f.date, end,
      // Today's dose is being given right now, so Day 1 starts checked —
      // the rest of the course gets confirmed day by day as it happens.
      daysGiven: [f.date],
      by: f.by || null, notes: f.notes || null,
    });
  }
  return (
    <Modal title="Add medication" sub={f.duration !== '' ? `Course runs ${fmtDate(f.date)} through ${fmtDate(end)} (${duration} day${duration > 1 ? 's' : ''}).` : undefined} onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Drug name"><input value={f.drug} onChange={set('drug')} /></Field>
        <Field label="Purpose"><input value={f.purpose} onChange={set('purpose')} /></Field>
        <Field label="Dosage"><input value={f.dosage} onChange={set('dosage')} placeholder="e.g. 3g per 3L water" /></Field>
        <Field label="Duration (days)"><input type="number" min="1" value={f.duration} onChange={set('duration')} placeholder="how many days the course runs" /></Field>
        <Field label="Administered by"><input value={f.by} onChange={set('by')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}

function VaxForm({ flockStartDate, onClose, onSave }) {
  const [f, setF] = useState({ date: todayISO(), vaccine: '', disease: '', method: 'Water', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const birdAge = flockStartDate && f.date ? daysBetween(flockStartDate, f.date) + 1 : null;
  function submit() {
    if (!f.date || !f.vaccine) return;
    onSave({
      id: newId(),
      date: f.date, vaccine: f.vaccine, disease: f.disease || f.vaccine,
      birdAge, method: f.method || null,
      notes: f.notes || null,
    });
  }
  return (
    <Modal title="Add vaccination" onClose={onClose}>
      <div className="form-grid">
        <Field label="Date given"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Vaccine name"><input value={f.vaccine} onChange={set('vaccine')} /></Field>
        <Field label="Disease"><input value={f.disease} onChange={set('disease')} /></Field>
        <Field label="Bird age (auto)"><input value={birdAge != null ? `${birdAge} days` : 'set flock start date'} disabled /></Field>
        <Field label="Method">
          <select value={f.method} onChange={set('method')}>
            <option>Water</option><option>Injection</option><option>Eye drop</option><option>Spray</option>
          </select>
        </Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}

/* ---------------- Growth tab ---------------- */

function GrowthTab({ weightSamples, growthChartData, feedStandard, flockType, onAdd }) {
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Growth &amp; Weight Sampling</h3>
        <button className="btn btn-gold" onClick={onAdd}>+ Add weight sample</button>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Sample average vs. breed standard (g)</h3></div>
        <div className="chart-card">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={growthChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: '#423827' }} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#B9AD9A' }} />
              <Line type="monotone" dataKey="standard" name="Standard" stroke="#83786A" strokeWidth={2} dot={false} strokeDasharray="4 3" />
              <Line type="monotone" dataKey="actual" name="Your sample" stroke="#D4A537" strokeWidth={2} connectNulls dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="section-title">Weight samples logged</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Date</th><th>Sample size</th><th>Avg weight (g)</th><th>Notes</th></tr></thead>
          <tbody>
            {weightSamples.map((s) => (
              <tr key={s.id || s.date}>
                <td className="mono">{fmtDate(s.date)}</td>
                <td className="mono">{num(s.sampleSize)}</td>
                <td className="mono">{num(s.avgWeightG)}</td>
                <td className="notes">{s.notes || ''}</td>
              </tr>
            ))}
            {weightSamples.length === 0 && <tr><td colSpan={4} className="empty">No weight samples yet — weigh 10–20 birds and log the average weekly.</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="section-title">Breed feeding &amp; growth standard ({flockType === 'broiler' ? 'Ross 308' : 'Hy-Line'})</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Week</th><th>Feed type</th><th>Feed intake (g/bird/day)</th><th>Target weight (g)</th></tr></thead>
          <tbody>
            {feedStandard.map((r) => (
              <tr key={r.week}>
                <td className="mono">W{r.week}</td>
                <td>{r.feedType || '—'}</td>
                <td className="mono">{num(r.feedIntakePerBirdG)}</td>
                <td className="mono">{num(r.estWeightG)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Laying rate, egg cash flow & stock ---------------- */

function LayingEggsTab({
  actualFirstEggDate, daysSinceFirstEgg, weeksToPOL, polWeek,
  henDayPct, weeklyLayPct, monthlyLayPct, standardLayPct, layTrendData, layPeak,
  eggLedger, eggsInStock, totalEggs, totalCracked,
  eggRevenue, eggRevenueToday, eggRevenueWeek, eggRevenueMonth,
  avgEggPrice, costPerEgg, eggMarginPerEgg, crackedValueLost,
  layDropAlert, growerLayerMismatch,
}) {
  const [chartWindow, setChartWindow] = useState(90);
  const windowed = chartWindow === 0 ? layTrendData : layTrendData.slice(-chartWindow);
  const vsStandard = standardLayPct != null && henDayPct != null ? henDayPct - standardLayPct : null;

  // The marker sits on the line at the peak week's own end-date, using that
  // day's actual plotted value — so it lands exactly on the curve rather
  // than floating off it, even though the "peak" figure itself (in the stat
  // card) is a smoothed 7-day average, not that one day's raw number.
  const peakLabel = layPeak ? fmtDate(layPeak.date).slice(0, 6) : null;
  const peakPoint = peakLabel ? windowed.find((d) => d.date === peakLabel) : null;

  return (
    <>
      {!actualFirstEggDate ? (
        <>
          <p className="section-title" style={{ marginTop: 0 }}>Point of lay</p>
          <p className="empty" style={{ padding: '18px 0' }}>
            No eggs logged yet. {weeksToPOL > 0
              ? `The Hy-Line standard puts point of lay around week ${polWeek} — about ${weeksToPOL} week(s) away at the current pace.`
              : `This flock is past the standard week-${polWeek} point of lay with nothing logged yet — worth a closer look if that continues.`}
          </p>
        </>
      ) : (
        <div className="stale-banner" style={{ marginBottom: 18, borderColor: 'rgba(122, 154, 102, 0.5)' }}>
          🥚 <span>
            <strong>First egg: {fmtDate(actualFirstEggDate)}</strong> ({daysSinceFirstEgg} day{daysSinceFirstEgg === 1 ? '' : 's'} ago) —
            this flock's real point of lay, recorded from the day eggs actually started, not a breed-standard guess.
          </span>
        </div>
      )}

      {growerLayerMismatch && (
        <div className="stale-banner" style={{ marginBottom: 18 }}>
          ⚠ <span>
            Eggs have started — make sure the feeder actually has <strong>Layer feed</strong> in it, not
            Grower. Layer feed carries the calcium (3.4–4.2%) a laying hen needs for shell strength —
            grower feed alone runs closer to 1%. This nudge only shows for the first two weeks of lay.
          </span>
        </div>
      )}

      {layDropAlert && (
        <div className="stale-banner" style={{ marginBottom: 18 }}>
          ⚠ <span>
            Laying rate has fallen this week (7-day average now {num(weeklyLayPct, 1)}%) compared to the
            week before — worth checking feed, water, heat, and light hours, and watching for any early
            signs of illness. A real drop like this is often the first sign of a problem, before birds
            look sick.
          </span>
        </div>
      )}

      <p className="section-title" style={{ marginTop: 0 }}>Laying rate</p>
      <div className="grid grid-4">
        <StatCard title="Today" value={henDayPct != null ? `${num(henDayPct, 1)}%` : '—'} tone="green" foot="hen-day %" />
        <StatCard title="7-Day Average" value={weeklyLayPct != null ? `${num(weeklyLayPct, 1)}%` : '—'} tone="gold" />
        <StatCard title="30-Day Average" value={monthlyLayPct != null ? `${num(monthlyLayPct, 1)}%` : '—'} />
        <StatCard
          title="vs. Hy-Line Standard"
          value={vsStandard != null ? `${vsStandard >= 0 ? '+' : ''}${num(vsStandard, 1)} pts` : '—'}
          tone={vsStandard != null ? (vsStandard >= -3 ? 'green' : 'rust') : undefined}
          foot={standardLayPct != null ? `standard ~${num(standardLayPct, 1)}% this week` : 'outside reference range'}
        />
        <StatCard
          title="Peak So Far"
          value={layPeak ? `${num(layPeak.pct, 1)}%` : '—'}
          tone="gold"
          foot={layPeak ? `best week, ending ${fmtDate(layPeak.date)}` : 'not enough data yet'}
        />
      </div>

      <div className="panel-head" style={{ marginTop: 18, marginBottom: 0 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Trend</h3>
        <div className="field-seg" style={{ marginBottom: 0 }}>
          {[[30, '30d'], [90, '90d'], [180, '180d'], [0, 'All']].map(([d, label]) => (
            <button key={d} className={chartWindow === d ? 'active' : ''} onClick={() => setChartWindow(d)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Hen-day % — actual vs. Hy-Line standard</h3></div>
        <div className="chart-card">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={windowed} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#423827' }} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#B9AD9A' }} />
              <Line type="monotone" dataKey="actual" name="Actual %" stroke="#D4A537" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="standard" name="Hy-Line standard %" stroke="#7A9A66" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              {peakPoint && peakPoint.actual != null && (
                <ReferenceDot
                  x={peakPoint.date} y={peakPoint.actual} r={6}
                  fill="#D4A537" stroke="#241F18" strokeWidth={2}
                  label={{ value: `Peak ${num(layPeak.pct, 1)}%`, position: 'top', fill: '#D4A537', fontSize: 11 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      {layPeak && !peakPoint && (
        <p className="stat-foot" style={{ marginTop: -8 }}>
          Peak week ({fmtDate(layPeak.date)}) is outside the current {chartWindow === 0 ? 'window' : `${chartWindow}-day window`} — switch to a longer range above to see it marked.
        </p>
      )}

      <p className="section-title">Egg cash flow</p>
      <div className="grid grid-4">
        <StatCard title="Today" value={`GH₵ ${num(eggRevenueToday, 2)}`} tone="green" />
        <StatCard title="This Week" value={`GH₵ ${num(eggRevenueWeek, 2)}`} tone="gold" />
        <StatCard title="This Month" value={`GH₵ ${num(eggRevenueMonth, 2)}`} />
        <StatCard title="All Time" value={`GH₵ ${num(eggRevenue, 2)}`} foot={avgEggPrice != null ? `avg GH₵ ${num(avgEggPrice, 2)}/egg` : ''} />
      </div>

      <p className="section-title">Cost per egg</p>
      <div className="grid grid-4">
        <StatCard title="Feed Cost / Egg" value={costPerEgg != null ? `GH₵ ${num(costPerEgg, 2)}` : '—'} tone="rust" foot="lifetime, this flock" />
        <StatCard title="Avg Sale Price" value={avgEggPrice != null ? `GH₵ ${num(avgEggPrice, 2)}` : '—'} tone="green" />
        <StatCard
          title="Margin / Egg"
          value={eggMarginPerEgg != null ? `GH₵ ${num(eggMarginPerEgg, 2)}` : '—'}
          tone={eggMarginPerEgg != null ? (eggMarginPerEgg >= 0 ? 'green' : 'rust') : undefined}
          foot="feed cost only, not full overhead"
        />
        <StatCard
          title="Lost to Cracked"
          value={crackedValueLost != null ? `GH₵ ${num(crackedValueLost, 2)}` : '—'}
          tone="rust"
          foot={`${num(totalCracked)} cracked, lifetime`}
        />
      </div>

      <p className="section-title">Egg stock</p>
      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <StatCard title="In Stock" value={`${num(eggsInStock)} pieces`} tone={eggsInStock < 0 ? 'rust' : 'green'} foot={`≈ ${num(eggsInStock / CRATE_SIZE, 1)} crates`} />
        <StatCard title="Collected" value={num(totalEggs)} tone="gold" foot="lifetime" />
        <StatCard title="Cracked" value={num(totalCracked)} tone="rust" />
        <StatCard title="Sold" value={num(totalEggs - totalCracked - eggsInStock)} foot="pieces, lifetime" />
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Date</th><th>Event</th><th>Change</th><th>Balance after</th></tr></thead>
          <tbody>
            {eggLedger.map((e, i) => (
              <tr key={i}>
                <td className="mono">{fmtDate(e.date)}</td>
                <td>
                  {e.kind === 'collected' && <span className="tag green">Collected</span>}
                  {e.kind === 'cracked' && <span className="tag rust">Cracked</span>}
                  {e.kind === 'sold' && <span className="tag gold">Sold{e.ref.item === 'Eggs (crates)' ? ` (${num(e.ref.quantity)} crate${e.ref.quantity === 1 ? '' : 's'})` : ''}</span>}
                </td>
                <td className="mono">{e.delta > 0 ? '+' : ''}{num(e.delta)}</td>
                <td className="mono"><strong>{num(e.balance)}</strong></td>
              </tr>
            ))}
            {eggLedger.length === 0 && <tr><td colSpan={4} className="empty">Nothing logged yet — the stock balance builds as you log eggs collected in Daily Log and eggs sold in Sales &amp; Profit.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="stat-foot">
        Sold-by-crate assumes {CRATE_SIZE} eggs per crate — adjust in your own head if your crates run a
        different size. The Hy-Line standard line is a typical published curve, not a target: real flocks
        vary with nutrition, heat, and light.
      </p>
    </>
  );
}

function WeightForm({ onClose, onSave }) {
  const [f, setF] = useState({ date: todayISO(), sampleSize: '', avgWeightG: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.date || f.avgWeightG === '') return;
    onSave({
      id: newId(),
      date: f.date,
      sampleSize: f.sampleSize === '' ? null : Number(f.sampleSize),
      avgWeightG: Number(f.avgWeightG),
      notes: f.notes || null,
    });
  }
  return (
    <Modal title="Add weight sample" sub="Weigh 10–20 birds and enter the average — the more you sample, the more reliable the trend." onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Sample size (birds weighed)"><input type="number" value={f.sampleSize} onChange={set('sampleSize')} /></Field>
        <Field label="Average weight (g)" span2><input type="number" step="1" value={f.avgWeightG} onChange={set('avgWeightG')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save sample</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ==================== PEPPER FIELDS WORKSPACE ================= */
/* ============================================================= */

const PEST_OPTIONS = [
  'Aphids', 'Whitefly', 'CMV symptoms', 'Thrips', 'Spider mites',
  'Fruit / blossom rot', 'Bacterial spot', 'Leaf miner', 'Caterpillars', 'Healthy check', 'Other',
];
const SEVERITY = ['Low', 'Medium', 'High'];
const SPRAY_TYPES = ['Insecticide', 'Fungicide', 'Foliar feed', 'Fertigation', 'Other'];
const GRADES = ['Grade A', 'Grade B', 'Reject / off-grade'];

function sev2num(s) { return s === 'High' ? 3 : s === 'Medium' ? 2 : s === 'Low' ? 1 : 0; }
function addDaysISO(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}
function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

/* ---------------- Medication course helpers ---------------- */

/** Every calendar day a medication course covers, from its start date for
    `duration` days. A course with no duration set is treated as one day. */
function medCourseDates(med) {
  const start = med.start || med.date;
  const duration = Math.max(1, Number(med.duration) || 1);
  const days = [];
  for (let i = 0; i < duration; i++) days.push(addDaysISO(start, i));
  return days;
}

/** Where a course stands today: which days are confirmed given, which are
    still open, and whether it's finished, on track, or has a missed day. */
function medCourseStatus(med, asOf = todayISO()) {
  const dates = medCourseDates(med);
  const given = new Set(med.daysGiven || []);
  const givenCount = dates.filter((d) => given.has(d)).length;
  const complete = givenCount >= dates.length;
  const overdue = !complete && dates.some((d) => d < asOf && !given.has(d));
  const activeToday = dates.includes(asOf);
  return { dates, givenCount, total: dates.length, complete, overdue, activeToday };
}

/* ---------------- Soil monitoring helpers ---------------- */

const SOIL_FIELDS = ['moisture', 'ec', 'ph', 'n', 'p', 'k'];
const MANURE_LOCATIONS = ['Wet section', 'Drier section', 'Centre of pile', 'Edge of pile', 'Other'];

/** N+P+K, matching the workbook's "Fertility (mg/kg)" column. */
function fertility(r) {
  return (Number(r.n) || 0) + (Number(r.p) || 0) + (Number(r.k) || 0);
}

/** Plain average of moisture/EC/pH/N/P/K across a set of readings. */
function averageReading(rows) {
  if (!rows.length) return null;
  const avg = {};
  SOIL_FIELDS.forEach((k) => {
    const vals = rows.map((r) => Number(r[k])).filter((v) => !isNaN(v));
    avg[k] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
  return avg;
}

/** Only the most recent test round for a field — same idea as the workbook's
    "test every spot on the same day, then average" approach. */
function latestFieldRound(soilReadings, fieldId) {
  const rows = soilReadings.filter((r) => r.fieldId === fieldId);
  if (!rows.length) return { date: null, rows: [], avg: null };
  const latestDate = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0].date);
  const round = rows.filter((r) => r.date === latestDate);
  return { date: latestDate, rows: round, avg: averageReading(round) };
}

/** Where a value sits against a min/max target: 'below' | 'ok' | 'above'. */
function bandStatus(value, min, max) {
  if (value == null || min == null || max == null) return null;
  if (min > max) [min, max] = [max, min]; // guards against a mistyped/swapped target range
  if (value < min) return 'below';
  if (value > max) return 'above';
  return 'ok';
}

/**
 * Transplant readiness verdict, following the workbook's own decision guide:
 * EC and pH are the actual gate ("Target transplant: after EC drops below
 * 2,500 and pH reaches 6.0–6.8"); N/P/K are shown for information since the
 * sheet never gates the transplant decision on them.
 */
function readinessVerdict(avg, field) {
  if (!avg) return { overall: 'No data', ec: null, ph: null, n: null, p: null, k: null };
  const ec = bandStatus(avg.ec, field.targetECMin, field.targetECMax);
  const ph = bandStatus(avg.ph, field.targetPHMin, field.targetPHMax);
  const n = bandStatus(avg.n, field.targetNMin, field.targetNMax);
  const p = bandStatus(avg.p, field.targetPMin, field.targetPMax);
  const k = bandStatus(avg.k, field.targetKMin, field.targetKMax);

  let overall = 'Safe';
  if (avg.ec != null && avg.ec > 3500) overall = 'Not safe';
  else if (avg.ph != null && (avg.ph > 7.4 || avg.ph < 5.5)) overall = 'Not safe';
  else if (ec === 'above' || ec === 'below' || ph === 'above' || ph === 'below') overall = 'Caution';

  return { overall, ec, ph, n, p, k };
}

/** The closest soil test (any field) to a given date, within a tolerance —
    used to pair a batch's transplant with the reading that informed it. */
function nearestSoilRound(soilReadings, fieldId, date, toleranceDays = 10) {
  const byDate = {};
  soilReadings.filter((r) => r.fieldId === fieldId).forEach((r) => {
    (byDate[r.date] = byDate[r.date] || []).push(r);
  });
  let best = null, bestDiff = Infinity;
  Object.entries(byDate).forEach(([d, rows]) => {
    const diff = Math.abs(daysBetween(d, date));
    if (diff < bestDiff) { bestDiff = diff; best = { date: d, rows, avg: averageReading(rows) }; }
  });
  return best && bestDiff <= toleranceDays ? best : null;
}

/* ---------------- Nursery helpers ---------------- */

const NURSERY_METHODS = ['Seed trays', 'Seedbed', 'Poly bags', 'Other'];
const NURSERY_DEFAULT_DAYS = 30; // typical bell pepper nursery duration before transplant-ready
const NURSERY_STATUSES = { active: 'Active', transplanted: 'Transplanted', failed: 'Failed / discarded' };

/** Where a nursery batch stands: days since sowing, days until it's expected
    to be transplant-ready, and whether that expected date has passed
    without a germination check ever being logged (worth a nudge). */
function nurseryStatus(batch, asOf = todayISO()) {
  const daysSinceSow = daysBetween(batch.seedSowDate, asOf);
  const expectedReady = addDaysISO(batch.seedSowDate, batch.expectedNurseryDays || NURSERY_DEFAULT_DAYS);
  const daysToReady = daysBetween(asOf, expectedReady);
  const needsGerminationCheck = !batch.germinationDate && daysSinceSow >= 7;
  return { daysSinceSow, expectedReady, daysToReady, needsGerminationCheck };
}

function PepperWorkspace({
  pepper, farmProfile, reminders, expenses, onUpdateField, onAddScouting, onAddSpray, onAddHarvest,
  onAddInput, onUpdateInput, onDeleteInput, onAddReminder, onToggleReminder, onDeleteReminder,
  onAddManureReading, onDeleteManureReading, onAddSoilReading, onDeleteSoilReading,
  onStartNewBatch, onDeleteBatch,
  onAddNurseryBatch, onUpdateNurseryBatch, onDeleteNurseryBatch, onTransplantNurseryBatch,
  onInvoiceHarvest,
}) {
  const [ptab, setPtab] = useState('dashboard');
  const [soilView, setSoilView] = useState('soil'); // 'soil' | 'batches'
  const [scope, setScope] = useState('all');   // 'all' | 'A' | 'B'
  const [modal, setModal] = useState(null);      // 'field:A' | 'scout' | 'spray' | 'harvest' | 'manure' | 'soil' | 'batch:A'
  const [sprayPrefill, setSprayPrefill] = useState(null); // pre-fill data when opening SprayForm from the programme

  const fields = pepper.fields;
  const inScope = (fieldId) => scope === 'all' || fieldId === scope;
  const fieldName = (id) => (fields.find((f) => f.id === id) || {}).name || id;

  const scouting = useMemo(() => [...pepper.scouting].sort((a, b) => new Date(a.date) - new Date(b.date)), [pepper.scouting]);
  const sprays = useMemo(() => [...pepper.sprays].sort((a, b) => new Date(a.date) - new Date(b.date)), [pepper.sprays]);
  const harvests = useMemo(() => [...pepper.harvests].sort((a, b) => new Date(a.date) - new Date(b.date)), [pepper.harvests]);

  const scoutScoped = scouting.filter((s) => inScope(s.fieldId));
  const sprayScoped = sprays.filter((s) => inScope(s.fieldId));
  const harvestScoped = harvests.filter((s) => inScope(s.fieldId));
  const fieldsScoped = fields.filter((f) => inScope(f.id));

  const activeField = scope === 'all' ? null : fields.find((f) => f.id === scope);
  const datOf = (f) => (f && f.transplantDate ? daysBetween(f.transplantDate, todayISO()) : null);
  const headerDat = datOf(activeField);
  const headerRingPct = activeField && headerDat != null && activeField.expectedHarvestDAT
    ? headerDat / activeField.expectedHarvestDAT : 1;

  const totalPlants = fieldsScoped.reduce((s, f) => s + (Number(f.plantCount) || 0), 0);
  const totalKg = harvestScoped.reduce((s, h) => s + (Number(h.weightKg) || 0), 0);
  const revenue = harvestScoped.reduce((s, h) => s + (Number(h.weightKg) || 0) * (Number(h.pricePerKg) || 0), 0);
  const inputCost = sprayScoped.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const setupCost = fieldsScoped.reduce((s, f) => s + (Number(f.setupCost) || 0), 0);
  // Structures (net houses, drip) charged over their life, plus running
  // expenses booked against these fields in the Whole Farm view.
  const scopedExpenses = (expenses || []).filter(
    (e) => e.scope === 'pepper' && (scope === 'all' || e.target === scope || e.target === 'shared')
  );
  const structureCost = scopedExpenses.filter((e) => e.capital).reduce((s, e) => s + chargedToDate(e), 0);
  const structureInvested = scopedExpenses.filter((e) => e.capital).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const otherRunning = scopedExpenses.filter((e) => !e.capital).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalCost = inputCost + setupCost + structureCost + otherRunning;
  const margin = revenue - totalCost;
  const avgPrice = totalKg ? revenue / totalKg : null;

  const latestScout = scoutScoped[scoutScoped.length - 1];
  const pressureTone = latestScout
    ? (latestScout.severity === 'High' ? 'rust' : latestScout.severity === 'Medium' ? 'gold' : 'green')
    : undefined;

  // Pre-harvest interval: is any field still inside its "don't harvest yet" window?
  const phiWindows = fields.map((f) => {
    const fs = sprays.filter((s) => s.fieldId === f.id && s.phiDays);
    if (!fs.length) return null;
    const last = fs[fs.length - 1];
    const safe = addDaysISO(last.date, last.phiDays);
    const daysLeft = daysBetween(todayISO(), safe);
    return daysLeft > 0 ? { field: f, safe, daysLeft, product: last.product } : null;
  }).filter(Boolean);
  const scopePhi = phiWindows.filter((w) => inScope(w.field.id));
  const soonestClear = scopePhi.length ? Math.min(...scopePhi.map((w) => w.daysLeft)) : null;

  // Resistance nudge: last two insecticides on a field sharing the same active ingredient.
  const resistanceFlags = fields.map((f) => {
    const ins = sprays.filter((s) => s.fieldId === f.id && s.type === 'Insecticide' && s.activeIngredient);
    if (ins.length < 2) return null;
    const a = ins[ins.length - 1], b = ins[ins.length - 2];
    if (a.activeIngredient.trim().toLowerCase() === b.activeIngredient.trim().toLowerCase()) {
      return { field: f, ai: a.activeIngredient };
    }
    return null;
  }).filter(Boolean);
  const scopeResistance = resistanceFlags.filter((w) => inScope(w.field.id));

  // Auto reminders for the pepper side: active harvest holds + scouting overdue.
  const lastScoutByField = {};
  scouting.forEach((s) => { lastScoutByField[s.fieldId] = s.date; });
  const soilReadings = pepper.soilReadings || [];
  const manureReadings = pepper.manureReadings || [];
  const soilRetestReminders = fields.map((f) => {
    if (!f.manureAppliedDate) return null;
    const round = latestFieldRound(soilReadings, f.id);
    const verdict = readinessVerdict(round.avg, f);
    if (verdict.overall === 'Safe') return null; // no need to keep nudging once it's ready
    const lastTest = round.date || f.manureAppliedDate;
    const days = daysBetween(lastTest, todayISO());
    if (days < 7) return null;
    return {
      id: `soil-${f.id}`,
      title: `Retest soil — ${f.name} (${days}d since last check, not yet ready)`,
      dueDate: todayISO(),
      source: f.name,
    };
  }).filter(Boolean);
  const nurseryBatches = (pepper.nurseryBatches || []).filter((b) => b.status === 'active');
  const nurseryReminders = nurseryBatches.map((b) => {
    const ns = nurseryStatus(b);
    if (ns.needsGerminationCheck) {
      return { id: `nursery-germ-${b.id}`, title: `Check germination — ${b.batchLabel} (${ns.daysSinceSow}d since sowing)`, dueDate: todayISO(), source: 'Nursery' };
    }
    if (ns.daysToReady <= 3) {
      return { id: `nursery-ready-${b.id}`, title: `${b.batchLabel} nearing transplant-ready (${ns.daysToReady <= 0 ? 'due now' : `in ${ns.daysToReady}d`})`, dueDate: ns.expectedReady, source: 'Nursery' };
    }
    return null;
  }).filter(Boolean);
  const pepperAuto = [
    ...phiWindows.map((w) => ({ id: `phi-${w.field.id}`, title: `${w.field.name}: harvest hold (${w.product || 'spray'})`, dueDate: w.safe, source: w.field.name })),
    ...fields.map((f) => {
      const last = lastScoutByField[f.id];
      const days = last ? daysBetween(last, todayISO()) : null;
      if (last && days <= 4) return null;
      return { id: `scout-${f.id}`, title: `Scout ${f.name}${last ? ` (last ${days}d ago)` : ' (not scouted yet)'}`, dueDate: todayISO(), source: f.name };
    }).filter(Boolean),
    ...soilRetestReminders,
    ...nurseryReminders,
  ];

  const harvestChart = harvestScoped.map((h) => ({
    date: fmtDate(h.date).slice(0, 6),
    kg: Number(h.weightKg) || 0,
    revenue: Math.round((Number(h.weightKg) || 0) * (Number(h.pricePerKg) || 0)),
  }));
  const pressureChart = scoutScoped.map((s) => ({
    date: fmtDate(s.date).slice(0, 6),
    pressure: sev2num(s.severity),
    pest: s.pest,
  }));

  const scopeOptions = [['all', 'Both fields'], ...fields.map((f) => [f.id, f.name])];

  return (
    <>
      <header className="header">
        <div>
          <p className="brand-eyebrow pepper">{farmProfile.farmName || 'My Farm'} · Bell Pepper</p>
          <h1 className="brand-title">Bell Pepper Fields</h1>
          <p className="brand-sub">
            {farmProfile.location || 'Location not set'} · {fields.length} fields
            {activeField ? ` · viewing ${activeField.name}` : ' · all fields combined'}
          </p>
        </div>
        <div className="day-stamp">
          <DayRing pct={headerRingPct} color="#7A9A66" />
          <div>
            <div className="num pepper">
              {activeField
                ? (headerDat != null ? `DAT ${headerDat}` : '—')
                : num(totalPlants)}
              <span className="week-chip">
                {activeField
                  ? (headerDat != null ? `Wk ${Math.ceil((headerDat + 1) / 7)}` : 'set date')
                  : 'plants'}
              </span>
            </div>
            <div className="label">
              {activeField
                ? (activeField.variety || 'no variety set')
                : 'total in ground'}
            </div>
          </div>
        </div>
      </header>

      <div className="field-seg">
        {scopeOptions.map(([id, label]) => (
          <button key={id} className={scope === id ? 'active' : ''} onClick={() => setScope(id)}>{label}</button>
        ))}
      </div>

      <nav className="tabs pepper">
        {[
          ['dashboard', 'Dashboard'],
          ['nursery', 'Nursery'],
          ['cycle', 'Crop Cycle'],
          ['programme', 'Spray Programme'],
          ['soil', 'Soil & Batches'],
          ['scout', 'Scouting'],
          ['spray', 'Spray & Fertigation'],
          ['inputs', 'Input Stock'],
          ['harvest', 'Harvest & Sales'],
          ['reminders', 'Reminders'],
        ].map(([id, label]) => (
          <button key={id} className={`tab${ptab === id ? ' active' : ''}`} onClick={() => setPtab(id)}>{label}</button>
        ))}
      </nav>

      {ptab === 'dashboard' && (
        <PepperDashboard
          scope={scope} fieldsScoped={fieldsScoped} totalPlants={totalPlants} totalKg={totalKg}
          revenue={revenue} totalCost={totalCost} inputCost={inputCost} setupCost={setupCost}
          structureCost={structureCost} structureInvested={structureInvested} otherRunning={otherRunning}
          expenses={expenses}
          margin={margin} avgPrice={avgPrice} latestScout={latestScout} pressureTone={pressureTone}
          scopePhi={scopePhi} soonestClear={soonestClear} scopeResistance={scopeResistance}
          harvestChart={harvestChart} pressureChart={pressureChart} harvestScoped={harvestScoped}
          datOf={datOf}
        />
      )}

      {ptab === 'nursery' && (
        <NurseryTab
          batches={pepper.nurseryBatches || []}
          fields={fields}
          onAdd={() => setModal('nursery')}
          onEdit={(b) => setModal(`nursery:${b.id}`)}
          onDelete={onDeleteNurseryBatch}
          onTransplant={(b) => setModal(`transplant-nursery:${b.id}`)}
        />
      )}

      {ptab === 'cycle' && (
        <CropCycleTab
          fields={fieldsScoped} datOf={datOf}
          onEdit={(id) => setModal(`field:${id}`)}
          onNewBatch={(id) => setModal(`batch:${id}`)}
        />
      )}

      {ptab === 'programme' && (
        <SprayProgrammeTab
          activeField={activeField}
          fields={fields}
          reminders={reminders}
          onAddReminder={onAddReminder}
          onLogNow={(prefill) => { setSprayPrefill(prefill); setModal('spray'); }}
        />
      )}

      {ptab === 'soil' && (
        <SoilBatchesTab
          view={soilView} setView={setSoilView}
          scope={scope} fields={fields} fieldsScoped={fieldsScoped}
          manureReadings={manureReadings} soilReadings={soilReadings}
          batches={pepper.batches || []} harvests={harvests} scouting={scouting} sprays={sprays}
          onAddManure={() => setModal('manure')}
          onDeleteManure={onDeleteManureReading}
          onAddSoil={() => setModal('soil')}
          onDeleteSoil={onDeleteSoilReading}
          onDeleteBatch={onDeleteBatch}
        />
      )}

      {ptab === 'scout' && (
        <ScoutingTab rows={[...scoutScoped].reverse()} fieldName={fieldName} onAdd={() => setModal('scout')} />
      )}

      {ptab === 'spray' && (
        <SprayTab
          rows={[...sprayScoped].reverse()} fieldName={fieldName}
          scopePhi={scopePhi} scopeResistance={scopeResistance} onAdd={() => setModal('spray')}
        />
      )}

      {ptab === 'harvest' && (
        <HarvestTab
          rows={[...harvestScoped].reverse()} fieldName={fieldName} totalKg={totalKg} revenue={revenue}
          onAdd={() => setModal('harvest')}
          onInvoice={(h) => onInvoiceHarvest(h, fieldName(h.fieldId))}
        />
      )}

      {ptab === 'inputs' && (
        <InputsTab
          inputs={pepper.inputs || []}
          onAdd={() => setModal('input')}
          onUpdate={onUpdateInput}
          onDelete={onDeleteInput}
        />
      )}

      {ptab === 'reminders' && (
        <RemindersTab
          reminders={reminders}
          scope="pepper"
          accent="green"
          autoItems={[
            ...pepperAuto,
            ...(pepper.inputs || [])
              .filter((i) => i.reorderAt != null && Number(i.quantity) <= Number(i.reorderAt))
              .map((i) => ({
                id: `input-${i.id}`,
                title: `Restock ${i.name} — ${num(i.quantity, 1)} ${i.unit} left`,
                dueDate: todayISO(),
                source: 'Input stock',
              })),
          ]}
          onAdd={() => setModal('reminder')}
          onToggle={onToggleReminder}
          onDelete={onDeleteReminder}
        />
      )}

      {modal && modal.startsWith('field:') && (
        <FieldForm
          field={fields.find((f) => f.id === modal.split(':')[1])}
          onClose={() => setModal(null)}
          onSave={(patch) => { onUpdateField(modal.split(':')[1], patch); setModal(null); }}
        />
      )}
      {modal === 'scout' && (
        <ScoutForm fields={fields} defaultField={scope === 'all' ? fields[0].id : scope}
          onClose={() => setModal(null)} onSave={(e) => { onAddScouting(e); setModal(null); }} />
      )}
      {modal === 'spray' && (
        <SprayForm
          fields={fields}
          defaultField={sprayPrefill?.fieldId || (scope === 'all' ? fields[0].id : scope)}
          prefill={sprayPrefill}
          onClose={() => { setModal(null); setSprayPrefill(null); }}
          onSave={(e) => { onAddSpray(e); setModal(null); setSprayPrefill(null); }}
        />
      )}
      {modal === 'harvest' && (
        <HarvestForm fields={fields} defaultField={scope === 'all' ? fields[0].id : scope}
          onClose={() => setModal(null)} onSave={(e) => { onAddHarvest(e); setModal(null); }} />
      )}
      {modal === 'reminder' && (
        <ReminderForm scope="pepper" onClose={() => setModal(null)} onSave={(e) => { onAddReminder(e); setModal(null); }} />
      )}
      {modal === 'input' && (
        <InputForm onClose={() => setModal(null)} onSave={(e) => { onAddInput(e); setModal(null); }} />
      )}
      {modal === 'manure' && (
        <ManureReadingForm onClose={() => setModal(null)} onSave={(e) => { onAddManureReading(e); setModal(null); }} />
      )}
      {modal === 'soil' && (
        <SoilReadingForm fields={fields} defaultField={scope === 'all' ? fields[0].id : scope}
          onClose={() => setModal(null)} onSave={(e) => { onAddSoilReading(e); setModal(null); }} />
      )}
      {modal && modal.startsWith('batch:') && (
        <NewBatchForm
          field={fields.find((f) => f.id === modal.split(':')[1])}
          onClose={() => setModal(null)}
          onSave={(patch) => { onStartNewBatch(modal.split(':')[1], patch); setModal(null); }}
        />
      )}
      {(modal === 'nursery' || (typeof modal === 'string' && modal.startsWith('nursery:'))) && (
        <NurseryBatchForm
          entry={modal.startsWith('nursery:') ? (pepper.nurseryBatches || []).find((b) => b.id === modal.split(':')[1]) : null}
          onClose={() => setModal(null)}
          onSave={(e) => {
            if (modal.startsWith('nursery:')) onUpdateNurseryBatch(e.id, e);
            else onAddNurseryBatch(e);
            setModal(null);
          }}
        />
      )}
      {modal && modal.startsWith('transplant-nursery:') && (
        <TransplantNurseryForm
          batch={(pepper.nurseryBatches || []).find((b) => b.id === modal.split(':')[1])}
          fields={fields}
          onClose={() => setModal(null)}
          onSave={(fieldId, patch) => {
            onTransplantNurseryBatch(modal.split(':')[1], fieldId, patch);
            setModal(null);
          }}
        />
      )}
    </>
  );
}

/* ---------------- Pepper dashboard ---------------- */

function PepperDashboard({
  fieldsScoped, totalPlants, totalKg, revenue, totalCost, inputCost, setupCost,
  structureCost, structureInvested, otherRunning, expenses, scope,
  margin, avgPrice, latestScout, pressureTone, scopePhi, soonestClear, scopeResistance,
  harvestChart, pressureChart, harvestScoped, datOf,
}) {
  // Structures assigned to one field, so Field A and Field B compare fairly.
  const fieldCapex = (id) => {
    const rows = (expenses || []).filter((e) => e.capital && e.scope === 'pepper' && e.target === id);
    return {
      invested: rows.reduce((s, e) => s + (Number(e.amount) || 0), 0),
      charged: rows.reduce((s, e) => s + chargedToDate(e), 0),
    };
  };
  const alerts = [];
  scopePhi.forEach((w) => alerts.push({ tone: 'rust', text: `${w.field.name}: don't harvest for ${w.daysLeft} more day(s) — pre-harvest interval after ${w.product || 'last spray'} clears ${fmtDate(w.safe)}.` }));
  scopeResistance.forEach((w) => alerts.push({ tone: 'gold', text: `${w.field.name}: last two insecticides both used "${w.ai}". Rotate to a different active ingredient to slow resistance.` }));
  if (latestScout && latestScout.severity === 'High') {
    alerts.push({ tone: 'rust', text: `High pest pressure last logged (${latestScout.pest}) on ${fmtDate(latestScout.date)}. Act before it spreads — aphids/whitefly drive CMV.` });
  }

  return (
    <>
      <div className="grid grid-4">
        <StatCard title="Plant Stand" value={num(totalPlants)} tone="green" foot={scope === 'all' ? 'both fields' : 'in this field'} />
        <StatCard
          title="Pest Pressure"
          value={latestScout ? latestScout.severity : 'None yet'}
          tone={pressureTone}
          foot={latestScout ? `${latestScout.pest} · ${fmtDate(latestScout.date)}` : 'log a scouting round'}
        />
        <StatCard
          title="Harvest Hold"
          value={soonestClear != null ? `${soonestClear}d` : 'Clear'}
          tone={soonestClear != null ? 'rust' : 'green'}
          foot={soonestClear != null ? 'within pre-harvest interval' : 'safe to pick'}
        />
        <StatCard title="Harvested" value={`${num(totalKg, 1)} kg`} tone="gold" foot={`${harvestScoped.length} pick(s) logged`} />
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <StatCard title="Revenue" value={`GH₵ ${num(revenue, 2)}`} tone="green" foot="from harvest sales" />
        <StatCard title="Cost" value={`GH₵ ${num(totalCost, 2)}`} tone="rust" foot={`inputs ${num(inputCost, 0)} + structures ${num(structureCost, 0)}`} />
        <StatCard title="Margin" value={`GH₵ ${num(margin, 2)}`} tone={margin >= 0 ? 'green' : 'rust'} foot={margin >= 0 ? 'in profit' : 'below break-even'} />
        <StatCard title="Avg Price" value={avgPrice != null ? `GH₵ ${num(avgPrice, 2)}` : '—'} foot="per kg sold" />
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head"><h3>Alerts &amp; actions</h3></div>
        {alerts.length === 0 ? (
          <p className="empty" style={{ padding: '18px 0' }}>All clear — no active harvest holds, resistance nudges, or high-pressure flags in this view.</p>
        ) : (
          <div style={{ paddingBottom: 10 }}>
            {alerts.map((a, i) => (
              <div className="alert-row" key={i}>
                <span className={`tag ${a.tone}`}>{a.tone === 'rust' ? '!' : '•'}</span>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head"><h3>Harvest (kg) &amp; revenue (GH₵)</h3></div>
          <div className="chart-card">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={harvestChart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#423827' }} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#B9AD9A' }} />
                <Bar yAxisId="left" dataKey="kg" name="Harvest (kg)" fill="#7A9A66" barSize={12} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue (GH₵)" stroke="#D4A537" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Pest pressure trend</h3></div>
          <div className="chart-card">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pressureChart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#423827' }} />
                <YAxis domain={[0, 3]} ticks={[0, 1, 2, 3]} tickFormatter={(v) => ['–', 'Low', 'Med', 'High'][v]} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, n, p) => [['–', 'Low', 'Medium', 'High'][v], p.payload.pest]}
                />
                <Area type="monotone" dataKey="pressure" name="Pressure" fill="#C15F4122" stroke="#C15F41" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <p className="section-title">Field snapshot</p>
      {structureInvested > 0 && (
        <p className="stat-foot" style={{ marginTop: -6, marginBottom: 12 }}>
          Structures on {scope === 'all' ? 'these fields' : 'this field'}: <strong>GH₵ {num(structureInvested, 2)}</strong> invested,
          of which <strong>GH₵ {num(structureCost, 2)}</strong> is charged to the crop so far
          (the rest sits as remaining value). Running expenses booked here: GH₵ {num(otherRunning, 2)}.
        </p>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Field</th><th>Variety</th><th>DAT</th><th>Plants</th><th>Structures</th><th>Charged so far</th><th>Expected 1st harvest</th></tr>
          </thead>
          <tbody>
            {fieldsScoped.map((f) => {
              const dat = datOf(f);
              const firstHarvest = f.transplantDate && f.expectedHarvestDAT ? addDaysISO(f.transplantDate, f.expectedHarvestDAT) : null;
              return (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.variety || '—'}</td>
                  <td className="mono">{dat != null ? dat : '—'}</td>
                  <td className="mono">{num(f.plantCount)}</td>
                  <td className="mono">{fieldCapex(f.id).invested ? `GH₵ ${num(fieldCapex(f.id).invested, 2)}` : '—'}</td>
                  <td className="mono">{fieldCapex(f.id).charged ? `GH₵ ${num(fieldCapex(f.id).charged, 2)}` : '—'}</td>
                  <td className="mono">{firstHarvest ? fmtDate(firstHarvest) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Crop cycle ---------------- */

function CropCycleTab({ fields, datOf, onEdit, onNewBatch }) {
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Crop Cycle</h3>
      </div>
      <div className="field-card-grid">
        {fields.map((f) => {
          const dat = datOf(f);
          const week = dat != null ? Math.ceil((dat + 1) / 7) : null;
          const firstHarvest = f.transplantDate && f.expectedHarvestDAT ? addDaysISO(f.transplantDate, f.expectedHarvestDAT) : null;
          const toHarvest = firstHarvest ? daysBetween(todayISO(), firstHarvest) : null;
          return (
            <div className="panel" key={f.id} style={{ marginBottom: 0 }}>
              <div className="panel-head">
                <h3>{f.name}{f.currentBatchLabel ? <span className="tag gold" style={{ marginLeft: 8 }}>{f.currentBatchLabel}</span> : null}</h3>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => onEdit(f.id)}>Edit</button>
                  <button className="btn btn-green" onClick={() => onNewBatch(f.id)}>+ New Batch</button>
                </span>
              </div>
              <div style={{ padding: '4px 0 10px' }}>
                <div className="kv"><span className="k">Variety</span><span className="v">{f.variety || '—'}</span></div>
                <div className="kv"><span className="k">Transplanted</span><span className="v">{f.transplantDate ? fmtDate(f.transplantDate) : '—'}</span></div>
                <div className="kv"><span className="k">Days after transplant</span><span className="v">{dat != null ? `${dat} (Wk ${week})` : '—'}</span></div>
                <div className="kv"><span className="k">Plants in ground</span><span className="v">{num(f.plantCount)}</span></div>
                <div className="kv"><span className="k">Spacing</span><span className="v">{f.spacing || '—'}</span></div>
                <div className="kv"><span className="k">Expected 1st harvest</span><span className="v">{firstHarvest ? `${fmtDate(firstHarvest)}${toHarvest != null ? (toHarvest > 0 ? ` (${toHarvest}d)` : ' (due)') : ''}` : '—'}</span></div>
                <div className="kv"><span className="k">Setup cost</span><span className="v">{f.setupCost != null ? `GH₵ ${num(f.setupCost, 2)}` : '—'}</span></div>
                <div className="kv"><span className="k">Manure applied</span><span className="v">{f.manureAppliedDate ? fmtDate(f.manureAppliedDate) : '—'}</span></div>
                {f.notes && <div className="kv"><span className="k">Notes</span><span className="v" style={{ textAlign: 'right' }}>{f.notes}</span></div>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="stat-foot" style={{ marginTop: 14 }}>
        Bell peppers usually reach first harvest around 60–90 days after transplant; the default is set to 70. Adjust per field once you see how your crop runs.
        Starting a <strong>New Batch</strong> archives the current planting to Soil &amp; Batches → Batch Performance and begins the next one.
      </p>
    </>
  );
}

/* ============================================================= */
/* =================== BELL PEPPER SPRAY PROGRAMME =============== */
/* ============================================================= */

/* Day offsets are relative to transplant (Day 0). Dates shown in the app are
   computed live from each field's own transplant date — this is the same
   14-week nutrition/pest/disease regimen, just not locked to one calendar. */
const PEPPER_PROGRAMME = [
  { day: 0, week: 1, title: 'Transplant Day — Imidacloprid Drench + Vital 05 + Algua', cat: 'transplant', time: '6am' },
  { day: 4, week: 1, title: 'Omex Starter + Algua + Vital 05 + OFA', cat: 'nutrition', time: '6am' },
  { day: 7, week: 1, title: 'Omex Starter + Algua + OFA', cat: 'nutrition', time: '6am' },
  { day: 8, week: 2, title: 'Omex Starter + Algua + OFA', cat: 'nutrition', time: '6am' },
  { day: 11, week: 2, title: 'Omex Starter + Algua + OFA', cat: 'nutrition', time: '6am' },
  { day: 14, week: 2, title: 'Neem Oil (EVENING ONLY)', cat: 'neem', time: '5pm' },
  { day: 15, week: 3, title: 'Omex Starter + Vital 05 + Algua + OFA', cat: 'nutrition', time: '6am' },
  { day: 18, week: 3, title: 'Konmidor (systemic insecticide)', cat: 'pesticide', time: '6am' },
  { day: 21, week: 3, title: 'CYDIM SUPER (preventive fungicide)', cat: 'fungicide', time: '6am' },
  { day: 22, week: 4, title: 'Urea Foliar + Omex Starter + Algua + OFA', cat: 'nutrition', time: '6am' },
  { day: 25, week: 4, title: 'Emamectin Benzoate + CYDIM SUPER', cat: 'pesticide', time: '6am' },
  { day: 28, week: 4, title: 'Omex Starter + Algua + OFA', cat: 'nutrition', time: '6am' },
  { day: 29, week: 5, title: 'Alt Sulfur (MORNING — check temp <30°C)', cat: 'fungicide', time: '6am' },
  { day: 32, week: 5, title: 'Omex Starter + Algua + OFA + Vital 05', cat: 'nutrition', time: '6am' },
  { day: 35, week: 5, title: 'Neem Oil (EVENING ONLY)', cat: 'neem', time: '5pm' },
  { day: 36, week: 6, title: 'FINAL UREA + Algua + OFA', cat: 'nutrition', time: '6am' },
  { day: 39, week: 6, title: 'Konmidor (2nd rotation)', cat: 'pesticide', time: '6am' },
  { day: 42, week: 6, title: 'SWITCH: Boom Boost begins + Algua + OFA', cat: 'transition', time: '6am' },
  { day: 43, week: 7, title: 'Boom Boost + CalMag + Algua + Vital 05 + BORON', cat: 'flowering', time: '6am' },
  { day: 46, week: 7, title: 'Emamectin + CYDIM SUPER + CalMag', cat: 'pesticide', time: '6am' },
  { day: 49, week: 7, title: 'Boom Boost + CalMag + Algua + Boron (2nd & final)', cat: 'flowering', time: '6am' },
  { day: 50, week: 8, title: 'Boom Boost + CalMag + Algua + OFA', cat: 'flowering', time: '6am' },
  { day: 53, week: 8, title: 'Neem Oil (EVENING ONLY)', cat: 'neem', time: '5pm' },
  { day: 56, week: 8, title: 'Boom Boost + CalMag + OFA', cat: 'flowering', time: '6am' },
  { day: 57, week: 9, title: 'Alt Sulfur (MORNING — check temp <30°C)', cat: 'fungicide', time: '6am' },
  { day: 60, week: 9, title: 'Boom Boost + CalMag 3ml + Vital 05 + Algua', cat: 'flowering', time: '6am' },
  { day: 63, week: 9, title: 'Konmidor + Boom Boost + CalMag 3ml', cat: 'pesticide', time: '6am' },
  { day: 64, week: 10, title: 'Boom Boost + Finisher Pro (BEGINS) + CalMag', cat: 'fruiting', time: '6am' },
  { day: 67, week: 10, title: 'Emamectin + CalMag + Algua', cat: 'pesticide', time: '6am' },
  { day: 70, week: 10, title: 'CYDIM SUPER + Finisher Pro + CalMag', cat: 'fungicide', time: '6am' },
  { day: 71, week: 11, title: 'Finisher Pro + CalMag + Algua + OFA', cat: 'fruiting', time: '6am' },
  { day: 74, week: 11, title: 'Neem Oil (EVENING ONLY)', cat: 'neem', time: '5pm' },
  { day: 77, week: 11, title: 'Alt Sulfur MORNING — 48hrs after Neem', cat: 'fungicide', time: '6am' },
  { day: 78, week: 12, title: 'Finisher Pro + CalMag + Vital 05 + Algua', cat: 'fruiting', time: '6am' },
  { day: 81, week: 12, title: 'Konmidor + Finisher Pro + CalMag (PHI 7d)', cat: 'pesticide', time: '6am' },
  { day: 84, week: 12, title: 'CYDIM SUPER + Finisher Pro + CalMag (PHI 7d)', cat: 'fungicide', time: '6am' },
  { day: 85, week: 13, title: 'Finisher Pro + CalMag 2ml + OFA', cat: 'fruiting', time: '6am' },
  { day: 88, week: 13, title: 'Emamectin IF needed (PHI 3d)', cat: 'pesticide', time: '6am' },
  { day: 91, week: 13, title: 'FINAL FOLIAR SPRAY — Finisher Pro + CalMag + OFA', cat: 'fruiting', time: '6am' },
  { day: 92, week: 14, title: 'OFA DRIP ONLY', cat: 'harvest', time: '6am' },
  { day: 95, week: 14, title: 'OFA DRIP ONLY — Monitor harvest readiness', cat: 'harvest', time: '6am' },
  { day: 98, week: 14, title: 'HARVEST — Inspect and begin picking', cat: 'harvest', time: '6am' },
];

const PEPPER_STAGES = [
  { weeks: [1, 2], label: 'Establishment' },
  { weeks: [3, 4, 5], label: 'Vegetative' },
  { weeks: [6], label: 'Pre-flower Transition' },
  { weeks: [7, 8, 9], label: 'Flowering' },
  { weeks: [10, 11, 12], label: 'Fruiting' },
  { weeks: [13, 14], label: 'Harvest Approach' },
];

const PEPPER_CAT_TONE = {
  transplant: 'gold', nutrition: 'green', pesticide: 'rust', fungicide: 'gold',
  neem: 'green', transition: 'gold', flowering: 'gold', fruiting: 'rust', harvest: 'green',
};

const PEPPER_CAT_LABEL = {
  transplant: 'Transplant', nutrition: 'Nutrition', pesticide: 'Pesticide', fungicide: 'Fungicide',
  neem: 'Neem Oil (5pm)', transition: 'Transition', flowering: 'Flowering', fruiting: 'Fruiting', harvest: 'Harvest',
};

// What each category becomes in the Spray & Fertigation log's own Type field.
const PEPPER_CAT_SPRAY_TYPE = {
  transplant: 'Insecticide', nutrition: 'Foliar feed', pesticide: 'Insecticide', fungicide: 'Fungicide',
  neem: 'Insecticide', transition: 'Foliar feed', flowering: 'Foliar feed', fruiting: 'Foliar feed', harvest: 'Other',
};

const PEPPER_RATES = {
  transplant: 'Imidacloprid 70WG: 1g/1000L drip (ONE TIME ONLY) · Vital 05: 10ml/15L · Algua: 10ml/15L · OFA drip: 60ml/1000L',
  nutrition: 'Omex Starter: 4–5ml/15L · Algua: 10ml/15L · OFA: 10ml/15L · Urea (if applicable): 5g/15L dissolved first · OFA drip: 60ml/1000L',
  pesticide: 'Konmidor: 5ml/15L OR Emamectin: 5ml/15L · Algua: 10ml/15L · OFA: 10ml/15L · Rotate between the two every 2–3 weeks',
  fungicide: 'CYDIM SUPER: 25–30g/15L OR Alt Sulfur: 30–35g/15L (spray alone, temp <30°C) · Apply before rain as preventive',
  neem: 'Neem Oil: 25ml/15L + 2ml dish soap · SPRAY ALONE — mix with nothing · APPLY AFTER 5PM ONLY · Never on same day as Sulfur',
  transition: 'Omex Boom Boost: 5ml/15L · Algua: 10ml/15L · OFA: 10ml/15L · STOP Omex Starter from today',
  flowering: 'Boom Boost: 5ml/15L · CalMag: 2–3ml/15L (never stop once started) · Algua: 10ml/15L · Boron (Solubor): 1–2g/15L (Wk7 only)',
  fruiting: 'Finisher Pro: 5ml/15L · CalMag: 2–3ml/15L · Algua: 10ml/15L · OFA: 10ml/15L · Check PHI for any pesticides',
  harvest: 'OFA drip only: 30ml/1000L · NO foliar spray · Monitor fruit colour — harvest at 70–80% colour change · Early morning 5–8am',
};

function pepperStageForWeek(week) {
  return (PEPPER_STAGES.find((s) => s.weeks.includes(week)) || PEPPER_STAGES[0]).label;
}

const PEPPER_PROGRAMME_CATS = ['transplant', 'nutrition', 'pesticide', 'fungicide', 'neem', 'transition', 'flowering', 'fruiting', 'harvest'];

function SprayProgrammeTab({ activeField, fields, reminders, onAddReminder, onLogNow }) {
  const { showToast } = useToastConfirm();
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);

  const field = activeField || fields[0];
  const hasTransplant = Boolean(field && field.transplantDate);

  const events = PEPPER_PROGRAMME.map((ev) => ({
    ...ev,
    date: hasTransplant ? addDaysISO(field.transplantDate, ev.day) : null,
    daysLeft: hasTransplant ? daysBetween(todayISO(), addDaysISO(field.transplantDate, ev.day)) : null,
  }));
  const filtered = filter === 'all' ? events : events.filter((e) => e.cat === filter);
  const weeks = [...new Set(events.map((e) => e.week))];

  const counts = {};
  PEPPER_PROGRAMME.forEach((e) => { counts[e.cat] = (counts[e.cat] || 0) + 1; });

  const harvestEvent = events.find((e) => e.day === 98);

  function generateReminders() {
    if (!hasTransplant) return;
    const existingIds = new Set((reminders || []).map((r) => r.id));
    let added = 0;
    events.forEach((ev) => {
      if (ev.daysLeft < 0) return; // don't clutter reminders with the past
      const id = `prog-${field.id}-${ev.day}`;
      if (existingIds.has(id)) return;
      onAddReminder({
        id, title: `${field.name}: ${ev.title}`, dueDate: ev.date,
        repeatDays: null, scope: 'pepper', notes: PEPPER_RATES[ev.cat] || null, done: false,
      });
      added += 1;
    });
    showToast(added ? `Added ${added} reminder(s) for ${field.name}'s remaining programme.` : 'All upcoming events already have reminders.', added ? 'green' : 'default');
  }

  if (!field) {
    return <p className="empty" style={{ padding: '18px 0' }}>Add a field first to plan its spray programme.</p>;
  }

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <h3 style={{ fontSize: 18 }}>{field.name} — 14-week Spray &amp; Nutrition Programme</h3>
        <button className="btn btn-green" onClick={generateReminders} disabled={!hasTransplant}>
          ⤓ Generate reminders
        </button>
      </div>
      <p className="stat-foot" style={{ marginTop: 0, marginBottom: 14 }}>
        {hasTransplant
          ? <>Transplant {fmtDate(field.transplantDate)} · estimated harvest {fmtDate(harvestEvent.date)} (Day 98). Dates below are computed from this field&apos;s transplant date — switch fields above to see another field&apos;s schedule.</>
          : <>Set a transplant date for {field.name} in Crop Cycle to see actual dates — showing day offsets only until then.</>}
        {' '}This is a plan, not a log — record what you actually spray in <strong>Spray &amp; Fertigation</strong> as you go.
      </p>

      <div className="field-seg" style={{ marginBottom: 18 }}>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All events</button>
        {PEPPER_PROGRAMME_CATS.map((c) => (
          <button key={c} className={filter === c ? 'active' : ''} onClick={() => setFilter(c)}>{PEPPER_CAT_LABEL[c]}</button>
        ))}
      </div>

      {weeks.map((wk) => {
        const wkEvents = filtered.filter((e) => e.week === wk);
        if (!wkEvents.length) return null;
        return (
          <div key={wk} style={{ marginBottom: 16 }}>
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 14 }}>Week {wk} · {pepperStageForWeek(wk)}</h3>
              <span className="stat-foot" style={{ margin: 0 }}>{wkEvents.length} event{wkEvents.length > 1 ? 's' : ''}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wkEvents.map((ev) => {
                const id = `${ev.day}-${ev.title}`;
                const isOpen = openId === id;
                const overdue = ev.daysLeft != null && ev.daysLeft < 0;
                return (
                  <div className="panel" key={id} style={{ marginBottom: 0, cursor: 'pointer' }} onClick={() => setOpenId(isOpen ? null : id)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span className={`tag ${PEPPER_CAT_TONE[ev.cat] || ''}`} style={{ flexShrink: 0 }}>
                        {PEPPER_CAT_LABEL[ev.cat]}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{ev.title}</div>
                        <div className="stat-foot" style={{ margin: '3px 0 0' }}>
                          Day {ev.day} · {ev.time}
                          {ev.date && ` · ${fmtDate(ev.date)}`}
                          {ev.daysLeft != null && (
                            overdue ? ` · ${Math.abs(ev.daysLeft)}d ago` : ev.daysLeft === 0 ? ' · today' : ` · in ${ev.daysLeft}d`
                          )}
                        </div>
                        {isOpen && (
                          <div className="stat-foot" style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-alt)', borderRadius: 6, borderLeft: '3px solid var(--gold-dim)' }}>
                            {PEPPER_RATES[ev.cat] || 'See spray programme for full rates.'}
                          </div>
                        )}
                        {isOpen && hasTransplant && (
                          <button
                            className="btn btn-green"
                            style={{ marginTop: 8 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onLogNow({
                                fieldId: field.id,
                                product: ev.title,
                                rate: PEPPER_RATES[ev.cat] || '',
                                type: PEPPER_CAT_SPRAY_TYPE[ev.cat] || 'Other',
                                notes: `From spray programme — Day ${ev.day}, Week ${ev.week}`,
                              });
                            }}
                          >
                            ⤓ Log this spray now
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="section-title">Programme summary</p>
      <div className="grid grid-4">
        <StatCard title="Total Events" value={String(PEPPER_PROGRAMME.length)} tone="gold" foot="over 14 weeks" />
        <StatCard title="Nutrition Sprays" value={String(counts.nutrition || 0)} tone="green" />
        <StatCard title="Pesticide Events" value={String(counts.pesticide || 0)} tone="rust" />
        <StatCard title="Fungicide Events" value={String((counts.fungicide || 0))} tone="gold" />
      </div>

      <div className="stale-banner" style={{ marginTop: 18 }}>
        ⚠ <span>
          Key rules: never mix Neem with Sulfur · stop Urea after Day 36 (the final Urea foliar) ·
          CalMag joins every spray from Day 42 onward · check temperature is under 30°C before any
          Alt Sulfur application.
        </span>
      </div>
    </>
  );
}

function FieldForm({ field, onClose, onSave }) {
  const [section, setSection] = useState('crop'); // 'crop' | 'soil'
  const [f, setF] = useState({
    variety: field.variety || '', transplantDate: field.transplantDate || '',
    plantCount: field.plantCount ?? '', spacing: field.spacing || '',
    expectedHarvestDAT: field.expectedHarvestDAT ?? 70, setupCost: field.setupCost ?? '', notes: field.notes || '',
    manureAppliedDate: field.manureAppliedDate || '',
    targetECMin: field.targetECMin ?? '', targetECMax: field.targetECMax ?? '',
    targetPHMin: field.targetPHMin ?? '', targetPHMax: field.targetPHMax ?? '',
    targetNMin: field.targetNMin ?? '', targetNMax: field.targetNMax ?? '',
    targetPMin: field.targetPMin ?? '', targetPMax: field.targetPMax ?? '',
    targetKMin: field.targetKMin ?? '', targetKMax: field.targetKMax ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const num2 = (v) => (v === '' ? null : Number(v));
  function submit() {
    onSave({
      variety: f.variety || '', transplantDate: f.transplantDate || '',
      plantCount: f.plantCount === '' ? null : Number(f.plantCount),
      spacing: f.spacing || '',
      expectedHarvestDAT: f.expectedHarvestDAT === '' ? null : Number(f.expectedHarvestDAT),
      setupCost: f.setupCost === '' ? null : Number(f.setupCost),
      notes: f.notes || '',
      manureAppliedDate: f.manureAppliedDate || null,
      targetECMin: num2(f.targetECMin), targetECMax: num2(f.targetECMax),
      targetPHMin: num2(f.targetPHMin), targetPHMax: num2(f.targetPHMax),
      targetNMin: num2(f.targetNMin), targetNMax: num2(f.targetNMax),
      targetPMin: num2(f.targetPMin), targetPMax: num2(f.targetPMax),
      targetKMin: num2(f.targetKMin), targetKMax: num2(f.targetKMax),
    });
  }
  return (
    <Modal title={`Edit ${field.name}`} sub="Crop cycle details and soil targets for this field." onClose={onClose}>
      <div className="kind-toggle">
        <button className={section === 'crop' ? 'active' : ''} onClick={() => setSection('crop')}>Crop cycle</button>
        <button className={section === 'soil' ? 'active' : ''} onClick={() => setSection('soil')}>Soil targets</button>
      </div>

      {section === 'crop' ? (
        <div className="form-grid">
          <Field label="Variety"><input value={f.variety} onChange={set('variety')} placeholder="e.g. California Wonder" /></Field>
          <Field label="Transplant date"><input type="date" value={f.transplantDate} onChange={set('transplantDate')} /></Field>
          <Field label="Plants in ground"><input type="number" value={f.plantCount} onChange={set('plantCount')} /></Field>
          <Field label="Spacing"><input value={f.spacing} onChange={set('spacing')} placeholder="e.g. 45cm × 60cm" /></Field>
          <Field label="Expected 1st harvest (DAT)"><input type="number" value={f.expectedHarvestDAT} onChange={set('expectedHarvestDAT')} /></Field>
          <Field label="Setup cost (GH₵)"><input type="number" step="0.01" value={f.setupCost} onChange={set('setupCost')} placeholder="seedlings, land prep, drip, labour" /></Field>
          <Field label="Manure applied date"><input type="date" value={f.manureAppliedDate} onChange={set('manureAppliedDate')} /></Field>
          <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        </div>
      ) : (
        <>
          <p className="stat-foot" style={{ marginTop: 0 }}>
            What Soil &amp; Batches checks readings against for this field. Defaults come from typical
            bell pepper ranges — adjust to whatever your agronomy calls for.
          </p>
          <div className="form-grid">
            <Field label="EC min (µs/cm)"><input type="number" value={f.targetECMin} onChange={set('targetECMin')} /></Field>
            <Field label="EC max (µs/cm)"><input type="number" value={f.targetECMax} onChange={set('targetECMax')} /></Field>
            <Field label="pH min"><input type="number" step="0.1" value={f.targetPHMin} onChange={set('targetPHMin')} /></Field>
            <Field label="pH max"><input type="number" step="0.1" value={f.targetPHMax} onChange={set('targetPHMax')} /></Field>
            <Field label="Nitrogen min (mg/kg)"><input type="number" value={f.targetNMin} onChange={set('targetNMin')} /></Field>
            <Field label="Nitrogen max (mg/kg)"><input type="number" value={f.targetNMax} onChange={set('targetNMax')} /></Field>
            <Field label="Phosphorus min (mg/kg)"><input type="number" value={f.targetPMin} onChange={set('targetPMin')} /></Field>
            <Field label="Phosphorus max (mg/kg)"><input type="number" value={f.targetPMax} onChange={set('targetPMax')} /></Field>
            <Field label="Potassium min (mg/kg)"><input type="number" value={f.targetKMin} onChange={set('targetKMin')} /></Field>
            <Field label="Potassium max (mg/kg)"><input type="number" value={f.targetKMax} onChange={set('targetKMax')} /></Field>
          </div>
        </>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Save field</button>
      </div>
    </Modal>
  );
}

/* ---------------- Scouting ---------------- */

function ScoutingTab({ rows, fieldName, onAdd }) {
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Scouting — Pest &amp; Disease</h3>
        <button className="btn btn-green" onClick={onAdd}>+ Log scouting round</button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Field</th><th>Pest / issue</th><th>Severity</th><th>% affected</th><th>Action taken</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtDate(r.date)}</td>
                <td>{fieldName(r.fieldId)}</td>
                <td>{r.pest}</td>
                <td>
                  <span className={`tag ${r.severity === 'High' ? 'rust' : r.severity === 'Medium' ? 'gold' : 'green'}`}>{r.severity}</span>
                </td>
                <td className="mono">{r.pctAffected != null ? `${num(r.pctAffected)}%` : '—'}</td>
                <td>{r.action || '—'}</td>
                <td className="notes">{r.notes || ''}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">No scouting logged yet — walk the rows and record what you see, even a clean check.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="stat-foot">Scout at least twice a week. Catching aphids and whitefly early is your best defence against CMV — the trend chart on the dashboard shows whether pressure is building.</p>
    </>
  );
}

function ScoutForm({ fields, defaultField, onClose, onSave }) {
  const [f, setF] = useState({ date: todayISO(), fieldId: defaultField, pest: PEST_OPTIONS[0], severity: 'Low', pctAffected: '', action: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.date || !f.fieldId) return;
    onSave({
      id: newId(), date: f.date, fieldId: f.fieldId, pest: f.pest, severity: f.severity,
      pctAffected: f.pctAffected === '' ? null : Number(f.pctAffected),
      action: f.action || null, notes: f.notes || null,
    });
  }
  return (
    <Modal title="Log scouting round" sub="What you saw walking the field today." onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Field">
          <select value={f.fieldId} onChange={set('fieldId')}>
            {fields.map((fl) => <option key={fl.id} value={fl.id}>{fl.name}</option>)}
          </select>
        </Field>
        <Field label="Pest / issue">
          <select value={f.pest} onChange={set('pest')}>
            {PEST_OPTIONS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Severity">
          <select value={f.severity} onChange={set('severity')}>
            {SEVERITY.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="% plants affected"><input type="number" value={f.pctAffected} onChange={set('pctAffected')} /></Field>
        <Field label="Action taken"><input value={f.action} onChange={set('action')} placeholder="e.g. sprayed, rogued plants" /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}

/* ---------------- Spray & fertigation ---------------- */

function SprayTab({ rows, fieldName, scopePhi, scopeResistance, onAdd }) {
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Spray &amp; Fertigation</h3>
        <button className="btn btn-green" onClick={onAdd}>+ Log spray / feed</button>
      </div>

      {scopePhi.map((w) => (
        <div className="stale-banner" key={`phi-${w.field.id}`} style={{ marginBottom: 10 }}>
          ⚠ <span><strong>{w.field.name}</strong> — hold harvest {w.daysLeft} more day(s). Pre-harvest interval clears {fmtDate(w.safe)}.</span>
        </div>
      ))}
      {scopeResistance.map((w) => (
        <div className="stale-banner" key={`res-${w.field.id}`} style={{ marginBottom: 10 }}>
          ⚠ <span><strong>{w.field.name}</strong> — last two insecticides both "{w.ai}". Rotate the active ingredient to slow resistance.</span>
        </div>
      ))}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Field</th><th>Type</th><th>Product</th><th>Active ingredient</th><th>Rate</th><th>Cost (GH₵)</th><th>PHI (d)</th><th>Safe to harvest</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const safe = r.phiDays ? addDaysISO(r.date, r.phiDays) : null;
              const held = safe && daysBetween(todayISO(), safe) > 0;
              return (
                <tr key={r.id}>
                  <td className="mono">{fmtDate(r.date)}</td>
                  <td>{fieldName(r.fieldId)}</td>
                  <td>{r.type}</td>
                  <td>{r.product || '—'}</td>
                  <td>{r.activeIngredient || '—'}</td>
                  <td className="mono">{r.rate || '—'}</td>
                  <td className="mono">{r.cost != null ? num(r.cost, 2) : '—'}</td>
                  <td className="mono">{r.phiDays != null ? r.phiDays : '—'}</td>
                  <td className="mono">{safe ? <span className={held ? 'tag rust' : 'tag green'}>{fmtDate(safe)}</span> : '—'}</td>
                  <td className="notes">{r.notes || ''}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={10} className="empty">No sprays or feeds logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="stat-foot">Log the pre-harvest interval (PHI) from the product label — the app then blocks that field from "safe to harvest" until enough days have passed.</p>
    </>
  );
}

function SprayForm({ fields, defaultField, prefill, onClose, onSave }) {
  const [f, setF] = useState({
    date: todayISO(), fieldId: defaultField, type: prefill?.type || 'Insecticide',
    product: prefill?.product || '', activeIngredient: '', rate: prefill?.rate || '',
    cost: '', phiDays: '', notes: prefill?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const safePreview = f.phiDays !== '' ? addDaysISO(f.date, f.phiDays) : null;
  function submit() {
    if (!f.date || !f.fieldId) return;
    onSave({
      id: newId(), date: f.date, fieldId: f.fieldId, type: f.type,
      product: f.product || null, activeIngredient: f.activeIngredient || null, rate: f.rate || null,
      cost: f.cost === '' ? null : Number(f.cost),
      phiDays: f.phiDays === '' ? null : Number(f.phiDays), notes: f.notes || null,
    });
  }
  return (
    <Modal
      title={prefill ? 'Log spray — from programme' : 'Log spray / feed'}
      sub={prefill
        ? 'Pre-filled from the spray programme — check the rate and add cost before saving.'
        : (safePreview ? `Safe to harvest from ${fmtDate(safePreview)}.` : 'Set a PHI to auto-flag the harvest hold.')}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Field">
          <select value={f.fieldId} onChange={set('fieldId')}>
            {fields.map((fl) => <option key={fl.id} value={fl.id}>{fl.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={f.type} onChange={set('type')}>
            {SPRAY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Product"><input value={f.product} onChange={set('product')} placeholder="e.g. Imida Super" /></Field>
        <Field label="Active ingredient"><input value={f.activeIngredient} onChange={set('activeIngredient')} placeholder="e.g. Imidacloprid" /></Field>
        <Field label="Rate"><input value={f.rate} onChange={set('rate')} placeholder="e.g. 5ml / 15L" /></Field>
        <Field label="Cost (GH₵)"><input type="number" step="0.01" value={f.cost} onChange={set('cost')} /></Field>
        <Field label="Pre-harvest interval (days)"><input type="number" value={f.phiDays} onChange={set('phiDays')} placeholder="from label" /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}

/* ---------------- Harvest & sales ---------------- */

function HarvestTab({ rows, fieldName, totalKg, revenue, onAdd, onInvoice }) {
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Harvest &amp; Sales</h3>
        <button className="btn btn-green" onClick={onAdd}>+ Log harvest</button>
      </div>
      {rows.length > 0 && (
        <p className="stat-foot" style={{ marginBottom: 10 }}>
          Totals in view: <strong style={{ color: 'var(--green)' }}>{num(totalKg, 1)} kg</strong> ·
          revenue <strong style={{ color: 'var(--gold)' }}>GH₵ {num(revenue, 2)}</strong>
        </p>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Field</th><th>Weight (kg)</th><th>Grade</th><th>Price/kg</th><th>Revenue</th><th>Buyer</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rev = (Number(r.weightKg) || 0) * (Number(r.pricePerKg) || 0);
              return (
                <tr key={r.id}>
                  <td className="mono">{fmtDate(r.date)}</td>
                  <td>{fieldName(r.fieldId)}</td>
                  <td className="mono">{num(r.weightKg, 1)}</td>
                  <td>{r.grade ? <span className={`tag ${r.grade.startsWith('Grade A') ? 'green' : r.grade.startsWith('Grade B') ? 'gold' : 'rust'}`}>{r.grade}</span> : '—'}</td>
                  <td className="mono">{r.pricePerKg != null ? num(r.pricePerKg, 2) : '—'}</td>
                  <td className="mono">{rev ? `GH₵ ${num(rev, 2)}` : '—'}</td>
                  <td>{r.buyer || '—'}</td>
                  <td className="notes">{r.notes || ''}</td>
                  <td><button className="link-btn" onClick={() => onInvoice(r)}>Invoice</button></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={9} className="empty">No harvest logged yet — record each pick to build your yield and revenue picture.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function HarvestForm({ fields, defaultField, onClose, onSave }) {
  const [f, setF] = useState({ date: todayISO(), fieldId: defaultField, weightKg: '', grade: GRADES[0], pricePerKg: '', buyer: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const rev = (Number(f.weightKg) || 0) * (Number(f.pricePerKg) || 0);
  function submit() {
    if (!f.date || !f.fieldId || f.weightKg === '') return;
    onSave({
      id: newId(), date: f.date, fieldId: f.fieldId, weightKg: Number(f.weightKg),
      grade: f.grade || null, pricePerKg: f.pricePerKg === '' ? null : Number(f.pricePerKg),
      buyer: f.buyer || null, notes: f.notes || null,
    });
  }
  return (
    <Modal title="Log harvest" sub={rev ? `Revenue: GH₵ ${num(rev, 2)}.` : 'Enter weight and price to see revenue.'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Field">
          <select value={f.fieldId} onChange={set('fieldId')}>
            {fields.map((fl) => <option key={fl.id} value={fl.id}>{fl.name}</option>)}
          </select>
        </Field>
        <Field label="Weight (kg)"><input type="number" step="0.1" value={f.weightKg} onChange={set('weightKg')} /></Field>
        <Field label="Grade">
          <select value={f.grade} onChange={set('grade')}>
            {GRADES.map((g) => <option key={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Price per kg (GH₵)"><input type="number" step="0.01" value={f.pricePerKg} onChange={set('pricePerKg')} /></Field>
        <Field label="Buyer"><input value={f.buyer} onChange={set('buyer')} placeholder="market, aggregator, etc." /></Field>
        <Field label="Revenue (auto)"><input value={rev ? `GH₵ ${num(rev, 2)}` : '—'} disabled /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Save harvest</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ============= FLOCK / SALES / REMINDERS COMPONENTS ========== */
/* ============================================================= */

const SALE_ITEMS = ['Eggs (crates)', 'Eggs (pieces)', 'Spent hens', 'Broilers', 'Cockerels', 'Other'];

function FarmProfileForm({ profile, onClose, onSave }) {
  const [f, setF] = useState({
    farmName: profile?.farmName || '', location: profile?.location || '',
    email: profile?.email || '', phone: profile?.phone || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.farmName) return;
    onSave({ farmName: f.farmName, location: f.location || '', email: f.email || '', phone: f.phone || '' });
  }
  return (
    <Modal
      title="Farm Profile"
      sub="Shown across the app's headers, invoices, and backups — this is what makes it your farm, not a copy of someone else's."
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Farm name" span2><input value={f.farmName} onChange={set('farmName')} placeholder="e.g. Green Valley Farms" /></Field>
        <Field label="Location"><input value={f.location} onChange={set('location')} placeholder="e.g. Kasoa, Central Region" /></Field>
        <Field label="Contact email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Contact phone / WhatsApp" span2><input value={f.phone} onChange={set('phone')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit} disabled={!f.farmName}>Save profile</button>
      </div>
    </Modal>
  );
}

function FlockForm({ flock, onClose, onSave }) {
  const isNew = !flock;
  const [f, setF] = useState({
    flockName: flock?.flockName || '', type: flock?.type || 'broiler',
    breed: flock?.breed || '', startDate: flock?.startDate || todayISO(),
    initialBirds: flock?.initialBirds ?? '', location: flock?.location || 'Eikwe, Western Region',
    setupCost: flock?.setupCost ?? '', notes: flock?.notes || '',
    polWeekOverride: flock?.polWeekOverride ?? '', status: flock?.status || 'active',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.flockName || f.initialBirds === '') return;
    onSave({
      id: flock?.id || newId(),
      flockName: f.flockName,
      type: f.type,
      breed: f.breed || (f.type === 'broiler' ? 'Ross 308' : 'Layers'),
      startDate: f.startDate,
      initialBirds: Number(f.initialBirds),
      location: f.location || '',
      standardKey: f.type === 'broiler' ? 'ross308_broiler' : 'hyline_layer',
      setupCost: f.setupCost === '' ? null : Number(f.setupCost),
      notes: f.notes || '',
      polWeekOverride: f.polWeekOverride === '' ? null : Number(f.polWeekOverride),
      status: isNew ? 'active' : f.status,
    });
  }
  return (
    <Modal title={isNew ? 'Add flock / new batch' : `Edit ${flock.flockName}`} sub={isNew ? 'Start a new broiler batch or layer flock — each keeps its own log and standard.' : 'Flock details and setup cost.'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Flock name" span2><input value={f.flockName} onChange={set('flockName')} placeholder="e.g. Broilers — Aug batch" /></Field>
        <Field label="Type">
          <select value={f.type} onChange={set('type')}>
            <option value="broiler">Broiler (Ross 308 standard)</option>
            <option value="layer">Layer (Hy-Line standard)</option>
          </select>
        </Field>
        <Field label="Breed"><input value={f.breed} onChange={set('breed')} placeholder={f.type === 'broiler' ? 'Ross 308' : 'Hy-Line'} /></Field>
        <Field label="Start / arrival date"><input type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="Birds placed"><input type="number" value={f.initialBirds} onChange={set('initialBirds')} /></Field>
        <Field label="Location"><input value={f.location} onChange={set('location')} /></Field>
        <Field label="Setup cost (GH₵)"><input type="number" step="0.01" value={f.setupCost} onChange={set('setupCost')} placeholder="chicks, brooding, etc." /></Field>
        {f.type === 'layer' && (
          <Field label="Expected point of lay (week)">
            <input type="number" value={f.polWeekOverride} onChange={set('polWeekOverride')} placeholder="21 (Hy-Line standard) — set your own if different" />
          </Field>
        )}
        {!isNew && (
          <Field label="Status">
            <select value={f.status} onChange={set('status')}>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </Field>
        )}
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {!isNew && f.status === 'completed' && (
        <p className="stat-foot" style={{ marginTop: 0 }}>
          Marking this flock Completed just moves it out of the everyday flock switcher — nothing is
          deleted, and its full Daily Log, Sales &amp; Profit, and history stay exactly as they are.
          You can switch it back to Active anytime, or find it under "Show completed" in the switcher.
        </p>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>{isNew ? 'Create flock' : 'Save flock'}</button>
      </div>
    </Modal>
  );
}

/* ---------------- Sales & profit ---------------- */

function SalesTab({ sales, flock, totalRevenue, flockMargin, totalFeedCost, litterCost, coopCharge, coopInvested, flockRunning, onAdd, onEditFlock, onInvoice }) {
  const setup = Number(flock.setupCost) || 0;
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Sales &amp; Profit — {flock.flockName}</h3>
        <button className="btn btn-gold" onClick={onAdd}>+ Log sale</button>
      </div>

      <div className="grid grid-4">
        <StatCard title="Revenue" value={`GH₵ ${num(totalRevenue, 2)}`} tone="green" foot={`${sales.length} sale(s)`} />
        <StatCard title="Feed Cost" value={`GH₵ ${num(totalFeedCost, 2)}`} tone="rust" foot="from feed records" />
        <StatCard title="Housing + Setup" value={`GH₵ ${num((litterCost || 0) + setup + (coopCharge || 0), 2)}`} foot={`litter ${num(litterCost || 0, 0)} + coop ${num(coopCharge || 0, 0)} + setup ${num(setup, 0)}`} />
        <StatCard title="Margin" value={`GH₵ ${num(flockMargin, 2)}`} tone={flockMargin >= 0 ? 'green' : 'rust'} foot={flockMargin >= 0 ? 'in profit' : 'below break-even'} />
      </div>

      <p className="stat-foot" style={{ margin: '12px 0 18px' }}>
        Profit = revenue − (feed GH₵ {num(totalFeedCost, 2)} + litter GH₵ {num(litterCost || 0, 2)}
        + coop share GH₵ {num(coopCharge || 0, 2)} + other GH₵ {num(flockRunning || 0, 2)} + setup GH₵ {num(setup, 2)}).
        {' '}<button className="link-btn" onClick={onEditFlock}>Edit setup cost</button> for chicks and brooding.
        {coopInvested > 0 && (
          <> Coops and housing: GH₵ {num(coopInvested, 2)} invested, charged over their working life
          so one build doesn&apos;t swallow a single batch.</>
        )}
      </p>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th><th>Buyer</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {sales.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtDate(r.date)}</td>
                <td>{r.item}</td>
                <td className="mono">{num(r.quantity)}</td>
                <td className="mono">{r.unitPrice != null ? num(r.unitPrice, 2) : '—'}</td>
                <td className="mono">GH₵ {num(r.amount, 2)}</td>
                <td>{r.buyer || '—'}</td>
                <td className="notes">{r.notes || ''}</td>
                <td><button className="link-btn" onClick={() => onInvoice(r)}>Invoice</button></td>
              </tr>
            ))}
            {sales.length === 0 && <tr><td colSpan={8} className="empty">No sales logged yet — record egg or bird sales to build your profit picture.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SaleForm({ flock, onClose, onSave }) {
  const layer = flock.type === 'layer';
  const [f, setF] = useState({ date: todayISO(), item: layer ? 'Eggs (crates)' : 'Broilers', quantity: '', unitPrice: '', amount: '', buyer: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const autoAmount = (Number(f.quantity) || 0) * (Number(f.unitPrice) || 0);
  const amount = f.amount !== '' ? Number(f.amount) : autoAmount;
  function submit() {
    if (!f.date || (f.quantity === '' && f.amount === '')) return;
    onSave({
      id: newId(), date: f.date, item: f.item,
      quantity: f.quantity === '' ? null : Number(f.quantity),
      unitPrice: f.unitPrice === '' ? null : Number(f.unitPrice),
      amount, buyer: f.buyer || null, notes: f.notes || null,
    });
  }
  return (
    <Modal title="Log sale" sub={amount ? `Amount: GH₵ ${num(amount, 2)}.` : 'Enter quantity × unit price, or type the amount directly.'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Item">
          <select value={f.item} onChange={set('item')}>
            {SALE_ITEMS.map((i) => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Quantity"><input type="number" step="0.01" value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Unit price (GH₵)"><input type="number" step="0.01" value={f.unitPrice} onChange={set('unitPrice')} /></Field>
        <Field label="Amount (GH₵)"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} placeholder={autoAmount ? `auto ${num(autoAmount, 2)}` : 'or type total'} /></Field>
        <Field label="Buyer"><input value={f.buyer} onChange={set('buyer')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save sale</button>
      </div>
    </Modal>
  );
}

/* ---------------- Reminders ---------------- */

function reminderStatusTag(d) {
  if (d == null) return <span className="tag">no date</span>;
  if (d < 0) return <span className="tag rust">Overdue {Math.abs(d)}d</span>;
  if (d === 0) return <span className="tag gold">Today</span>;
  if (d <= 5) return <span className="tag gold">In {d}d</span>;
  return <span className="tag green">In {d}d</span>;
}

function RemindersTab({ reminders, scope, autoItems, onAdd, onToggle, onDelete, accent }) {
  const withDays = (iso) => (iso ? daysBetween(todayISO(), iso) : null);
  const custom = (reminders || []).filter((r) => r.scope === scope || r.scope === 'general');
  const items = [
    ...(autoItems || []).map((a) => ({ ...a, kind: 'auto', done: false, daysLeft: a.daysLeft != null ? a.daysLeft : withDays(a.dueDate) })),
    ...custom.map((c) => ({ ...c, kind: 'custom', daysLeft: withDays(c.dueDate) })),
  ];
  const active = items.filter((i) => !i.done).sort((a, b) => {
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
  const done = items.filter((i) => i.done);
  const btnClass = accent === 'green' ? 'btn btn-green' : 'btn btn-gold';

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Reminders</h3>
        <button className={btnClass} onClick={onAdd}>+ Add reminder</button>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Status</th><th>Task</th><th>Due</th><th>Source / repeat</th><th></th></tr>
          </thead>
          <tbody>
            {active.map((i) => (
              <tr key={i.id}>
                <td>{reminderStatusTag(i.daysLeft)}</td>
                <td>{i.title}</td>
                <td className="mono">{i.dueDate ? fmtDate(i.dueDate) : '—'}</td>
                <td>{i.kind === 'auto' ? <span className="tag">{i.source || 'auto'}</span> : (i.repeatDays ? `every ${i.repeatDays}d` : (i.source || 'one-off'))}</td>
                <td>
                  {i.kind === 'custom' ? (
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button className="link-btn" onClick={() => onToggle(i.id)}>Done</button>
                      <button className="link-btn rust" onClick={() => onDelete(i.id)}>Delete</button>
                    </span>
                  ) : <span className="stat-foot" style={{ margin: 0 }}>auto</span>}
                </td>
              </tr>
            ))}
            {active.length === 0 && <tr><td colSpan={5} className="empty">Nothing due — add a reminder, or vaccinations and harvest holds will show here automatically.</td></tr>}
          </tbody>
        </table>
      </div>

      {done.length > 0 && (
        <>
          <p className="section-title">Completed</p>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {done.map((i) => (
                  <tr key={i.id}>
                    <td style={{ width: 90 }}><span className="tag green">Done</span></td>
                    <td style={{ textDecoration: 'line-through', color: 'var(--text-faint)' }}>{i.title}</td>
                    <td className="mono">{i.dueDate ? fmtDate(i.dueDate) : '—'}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button className="link-btn" onClick={() => onToggle(i.id)}>Undo</button>
                        <button className="link-btn rust" onClick={() => onDelete(i.id)}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function ReminderForm({ scope, onClose, onSave }) {
  const [f, setF] = useState({ title: '', dueDate: todayISO(), repeatDays: '', scope: scope || 'general', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.title) return;
    onSave({
      id: newId(), title: f.title, dueDate: f.dueDate || null,
      repeatDays: f.repeatDays === '' ? null : Number(f.repeatDays),
      scope: f.scope, notes: f.notes || null, done: false,
    });
  }
  return (
    <Modal title="Add reminder" sub="A one-off or repeating task — it shows up here when due." onClose={onClose}>
      <div className="form-grid">
        <Field label="Task" span2><input value={f.title} onChange={set('title')} placeholder="e.g. Fertigate Field A, deworm layers" /></Field>
        <Field label="Due date"><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Repeat every (days)"><input type="number" value={f.repeatDays} onChange={set('repeatDays')} placeholder="optional" /></Field>
        <Field label="Applies to">
          <select value={f.scope} onChange={set('scope')}>
            <option value="poultry">Poultry</option>
            <option value="pepper">Bell pepper</option>
            <option value="goats">Goats</option>
            <option value="general">General / whole farm</option>
          </select>
        </Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save reminder</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ======================== CLOUD SYNC UI ====================== */
/* ============================================================= */

function SyncBar({ sync, user, cloudReady, onSetupCloud, onSync, onPull, onSignOut, onEditProfile }) {
  const configured = cloudReady;
  const when = sync.lastSync ? new Date(sync.lastSync) : null;
  const label = !configured
    ? 'Saved on this device only'
    : sync.status === 'syncing' ? (sync.message || 'Auto-saving…')
    : sync.status === 'error' ? sync.message
    : when ? `${sync.message || 'Auto-saved to cloud'} · ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : (user ? 'Auto-sync on — saving shortly' : 'Not synced yet this session');

  return (
    <div className={`sync-bar${sync.status === 'error' ? ' error' : ''}`}>
      <span className={`sync-dot ${configured ? sync.status : 'off'}`} />
      <span className="sync-label">
        {label}
        {user && <span className="sync-user"> · {user.email}</span>}
      </span>
      <span className="sync-actions">
        <button className="link-btn" onClick={onEditProfile}>Farm Profile</button>
        {!configured && (
          <button className="link-btn" onClick={onSetupCloud}>Set up cloud sync</button>
        )}
        {configured && user && (
          <>
            <button className="link-btn" onClick={onSync} disabled={sync.status === 'syncing'}>Sync now</button>
            <button className="link-btn" onClick={onPull} disabled={sync.status === 'syncing'}>Pull from cloud</button>
            <button className="link-btn" onClick={onSetupCloud}>Settings</button>
            <button className="link-btn" onClick={onSignOut}>Sign out</button>
          </>
        )}
      </span>
    </div>
  );
}

/* ---------------- Login screen ---------------- */

function AuthScreen({ onSignedIn, onSetupCloud }) {
  const [mode, setMode] = useState('signin');   // 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(e) {
    if (e) e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'reset') {
        await resetPassword(email.trim());
        setNotice('If that email has an account, a reset link is on its way.');
        setMode('signin');
      } else if (mode === 'signup') {
        const session = await signUp(email.trim(), password);
        if (session) onSignedIn(session);
        else {
          setNotice('Account created. Check your email to confirm, then sign in.');
          setMode('signin');
        }
      } else {
        const session = await signIn(email.trim(), password);
        onSignedIn(session);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'signup' ? 'Create your account'
    : mode === 'reset' ? 'Reset your password'
    : 'Sign in';

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <p className="brand-eyebrow">AI Farms</p>
        <h1 className="brand-title" style={{ fontSize: 26, marginBottom: 4 }}>Farm Tracker</h1>
        <p className="brand-sub" style={{ marginBottom: 22 }}>
          Poultry &amp; bell pepper · Eikwe, Western Region
        </p>

        <h2 className="auth-title">{title}</h2>

        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" placeholder="you@example.com" required
            />
          </div>

          {mode !== 'reset' && (
            <div className="field">
              <label>Password</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? 'at least 6 characters' : ''}
                required minLength={6}
              />
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}
          {notice && <p className="auth-notice">{notice}</p>}

          <button className="btn btn-gold auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…'
              : mode === 'signup' ? 'Create account'
              : mode === 'reset' ? 'Send reset link'
              : 'Sign in'}
          </button>
        </form>

        <div className="auth-links">
          {mode === 'signin' && (
            <>
              <button className="link-btn" onClick={() => { setMode('signup'); setError(''); }}>Create an account</button>
              <button className="link-btn" onClick={() => { setMode('reset'); setError(''); }}>Forgot password?</button>
            </>
          )}
          {mode !== 'signin' && (
            <button className="link-btn" onClick={() => { setMode('signin'); setError(''); }}>← Back to sign in</button>
          )}
        </div>

        <p className="auth-foot">
          Signing in keeps your farm data in step across your phone and PC.
          Your records are private to your account.
          {onSetupCloud && (
            <> <button className="link-btn" onClick={onSetupCloud}>Change cloud connection</button></>
          )}
        </p>
      </div>
    </div>
  );
}

/* ============================================================= */
/* ==================== LITTER & MANURE ======================== */
/* ============================================================= */

function LitterTab({ rows, daysSinceChange, condition, due, manureHarvested, litterCost, onAdd, onEdit, onDelete }) {
  const { askConfirm } = useToastConfirm();
  const conditionTone = condition === 'Wet' || condition === 'Caked' ? 'rust' : condition === 'Damp' ? 'gold' : 'green';
  const toManure = rows.filter((r) => r.action === 'Removed to field');
  const byField = {};
  toManure.forEach((r) => {
    const key = r.toField || 'Unassigned';
    byField[key] = (byField[key] || 0) + (Number(r.quantity) || 0);
  });
  // Batches marked "Stored / composting" haven't gone to a field yet —
  // surface them so it's obvious there's manure waiting to be assigned.
  const awaitingField = toManure.filter((r) => r.toField === 'Stored / composting' || !r.toField);
  const awaitingBags = awaitingField.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Litter &amp; Manure</h3>
        <button className="btn btn-gold" onClick={onAdd}>+ Log litter</button>
      </div>

      <div className="grid grid-4">
        <StatCard
          title="Litter Age"
          value={daysSinceChange != null ? `${daysSinceChange} days` : '—'}
          tone={due ? 'rust' : daysSinceChange != null ? 'green' : undefined}
          foot={due ? `change overdue (${LITTER_CHANGE_DAYS}d guide)` : `guide: change by ${LITTER_CHANGE_DAYS} days`}
        />
        <StatCard
          title="Condition"
          value={condition || '—'}
          tone={condition ? conditionTone : undefined}
          foot={condition === 'Wet' || condition === 'Caked' ? 'ammonia / footpad risk' : 'last logged condition'}
        />
        <StatCard title="Manure to Fields" value={manureHarvested ? `${num(manureHarvested, 1)} bags` : '—'} tone="green" foot="cleared litter used as manure" />
        <StatCard title="Litter Cost" value={`GH₵ ${num(litterCost, 2)}`} tone="rust" foot="counts toward flock cost" />
      </div>

      {(condition === 'Wet' || condition === 'Caked') && (
        <div className="stale-banner" style={{ marginTop: 16 }}>
          ⚠ <span>
            Litter last logged as <strong>{condition.toLowerCase()}</strong>. Wet or caked litter drives ammonia,
            footpad burn and coccidiosis — turn it, top up with dry material, and check for leaking drinkers.
          </span>
        </div>
      )}

      {awaitingBags > 0 && (
        <div className="stale-banner" style={{ marginTop: 16, borderColor: 'rgba(122, 154, 102, 0.4)' }}>
          🌱 <span>
            <strong>{num(awaitingBags, 1)} bag(s)</strong> across {awaitingField.length} batch{awaitingField.length === 1 ? '' : 'es'} of
            cleared litter {awaitingField.length === 1 ? 'is' : 'are'} not yet assigned to a field:
            {' '}{awaitingField.map((r, i) => (
              <span key={r.id}>
                {i > 0 ? ', ' : ' '}
                <strong>{r.batchLabel || `${num(r.quantity, 1)} bags, ${fmtDate(r.date)}`}</strong>
              </span>
            ))}. Find one below and hit <strong>Edit</strong> to set its field.
          </span>
        </div>
      )}

      {Object.keys(byField).length > 0 && (
        <>
          <p className="section-title">Manure sent to fields</p>
          <div className="grid grid-4">
            {Object.entries(byField).map(([field, qty]) => (
              <StatCard key={field} title={field} value={`${num(qty, 1)} bags`} tone="green" foot="manure applied" />
            ))}
          </div>
        </>
      )}

      <p className="section-title">Litter records</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Action</th><th>Batch</th><th>Material</th><th>Qty (bags)</th><th>Condition</th><th>Cost</th><th>To field</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtDate(r.date)}</td>
                <td>{r.action === 'Removed to field'
                  ? <span className="tag green">{r.action}</span>
                  : r.action}
                </td>
                <td>{r.batchLabel || '—'}</td>
                <td>{r.material || '—'}</td>
                <td className="mono">{r.quantity != null ? num(r.quantity, 1) : '—'}</td>
                <td>{r.condition ? <span className={`tag ${r.condition === 'Wet' || r.condition === 'Caked' ? 'rust' : r.condition === 'Damp' ? 'gold' : 'green'}`}>{r.condition}</span> : '—'}</td>
                <td className="mono">{r.cost != null ? `GH₵ ${num(r.cost, 2)}` : '—'}</td>
                <td>
                  {r.action === 'Removed to field' && (r.toField === 'Stored / composting' || !r.toField)
                    ? <span className="tag gold">Awaiting field</span>
                    : (r.toField || '—')}
                </td>
                <td className="notes">{r.notes || ''}</td>
                <td>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button className="link-btn" onClick={() => onEdit(r)}>Edit</button>
                    {onDelete && (
                      <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this litter record?')) onDelete(r.id); }}>Delete</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="empty">No litter logged yet — record the material laid, top-ups, condition checks, and manure cleared to your fields.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="stat-foot">
        Log a condition check whenever you walk the house. Dry litter keeps ammonia down and coccidiosis
        pressure low; caked or wet litter is the early warning that something needs fixing.
      </p>
    </>
  );
}

function LitterForm({ entry, fields, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const [f, setF] = useState({
    date: entry?.date || todayISO(),
    action: entry?.action || 'Top-up',
    material: entry?.material || 'Sawdust',
    quantity: entry?.quantity ?? '',
    condition: entry?.condition || 'Dry',
    cost: entry?.cost ?? '',
    toField: entry?.toField || '',
    batchLabel: entry?.batchLabel || '',
    notes: entry?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isManure = f.action === 'Removed to field';
  function submit() {
    if (!f.date) return;
    onSave({
      id: entry?.id || newId(), date: f.date, action: f.action,
      material: isManure ? (f.material || null) : f.material,
      quantity: f.quantity === '' ? null : Number(f.quantity),
      condition: isManure ? null : f.condition,
      cost: f.cost === '' ? null : Number(f.cost),
      toField: isManure ? (f.toField || null) : null,
      batchLabel: isManure ? (f.batchLabel || null) : null,
      notes: f.notes || null,
    });
  }
  return (
    <Modal
      title={isEdit ? 'Edit litter record' : 'Log litter'}
      sub={isEdit && isManure
        ? 'Assign this batch to a field now that you know where it\'s going, or update anything else.'
        : (isManure ? 'Cleared litter going to the fields as manure.' : 'Litter laid, topped up, turned, or checked.')}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Action">
          <select value={f.action} onChange={set('action')}>
            {LITTER_ACTIONS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Material">
          <select value={f.material} onChange={set('material')}>
            {LITTER_MATERIALS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Quantity (bags)"><input type="number" step="0.5" value={f.quantity} onChange={set('quantity')} /></Field>
        {isManure ? (
          <>
            <Field label="Batch label">
              <input
                value={f.batchLabel} onChange={set('batchLabel')}
                placeholder="e.g. Broiler coop, 1 Aug clean-out"
              />
            </Field>
            <Field label="To field">
              <select value={f.toField} onChange={set('toField')}>
                <option value="">— choose field —</option>
                {fields.map((fl) => <option key={fl.id} value={fl.name}>{fl.name}</option>)}
                <option value="Stored / composting">Stored / composting</option>
              </select>
            </Field>
          </>
        ) : (
          <Field label="Condition">
            <select value={f.condition} onChange={set('condition')}>
              {LITTER_CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        )}
        <Field label="Cost (GH₵)"><input type="number" step="0.01" value={f.cost} onChange={set('cost')} placeholder={isManure ? 'cartage, optional' : 'sawdust purchase'} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {isManure && (
        <p className="stat-foot" style={{ marginTop: 4 }}>
          Compost or age poultry manure before applying near young plants — fresh litter is high in
          ammonia and can scorch roots.
        </p>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>{isEdit ? 'Save changes' : 'Save'}</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ================= FEED MIX / RATION CALCULATOR ============== */
/* ============================================================= */

function starterMix(flockType) {
  // Sensible opening blend per 100 kg — the farmer tunes from here.
  // Both land inside their target protein/calcium/energy bands.
  if (flockType === 'broiler') {
    return { maize: 63, bran: 1, broilerconc: 28, soya: 5, oil: 2, salt: 1 };
  }
  return { maize: 58, bran: 8, layerconc: 30, oyster: 3, salt: 1 };
}

function FeedMixTab({ recipes, flock, onSave, onDelete }) {
  const [target, setTarget] = useState(flock.type === 'broiler' ? 'broiler_finisher' : 'layer');
  const [batchKg, setBatchKg] = useState(100);
  const [parts, setParts] = useState(() => starterMix(flock.type));
  const [prices, setPrices] = useState(() => {
    const p = {};
    INGREDIENTS.forEach((i) => { p[i.id] = i.defaultPrice; });
    return p;
  });
  const [bagPrice, setBagPrice] = useState(400);   // what a 50kg bag of compound feed costs
  const [recipeName, setRecipeName] = useState('');

  const used = INGREDIENTS.filter((i) => Number(parts[i.id]) > 0);
  const totalParts = used.reduce((s, i) => s + Number(parts[i.id] || 0), 0);

  // Weighted nutrient values across the blend.
  const calc = useMemo(() => {
    if (!totalParts) return null;
    let protein = 0, calcium = 0, energy = 0, cost = 0;
    used.forEach((i) => {
      const share = Number(parts[i.id]) / totalParts;
      protein += i.protein * share;
      calcium += i.calcium * share;
      energy += i.energy * share;
      cost += (Number(prices[i.id]) || 0) * share;
    });
    return { protein, calcium, energy, costPerKg: cost };
  }, [parts, prices, totalParts, used]);

  const t = RATION_TARGETS[target];
  const inRange = (v, [lo, hi]) => v >= lo && v <= hi;
  const tone = (v, range) => (inRange(v, range) ? 'green' : 'rust');

  const bagCostPerKg = Number(bagPrice) / 50;
  const savingPerKg = calc ? bagCostPerKg - calc.costPerKg : null;
  const batchCost = calc ? calc.costPerKg * Number(batchKg || 0) : null;
  const batchSaving = savingPerKg != null ? savingPerKg * Number(batchKg || 0) : null;

  const scale = totalParts ? Number(batchKg || 0) / totalParts : 0;

  function setPart(id, v) { setParts({ ...parts, [id]: v }); }
  function setPrice(id, v) { setPrices({ ...prices, [id]: v }); }

  function saveThis() {
    if (!recipeName.trim() || !calc) return;
    onSave({
      id: newId(), name: recipeName.trim(), target, batchKg: Number(batchKg),
      parts: { ...parts }, prices: { ...prices },
      protein: calc.protein, calcium: calc.calcium, energy: calc.energy,
      costPerKg: calc.costPerKg, savedOn: todayISO(), flockId: flock.id,
    });
    setRecipeName('');
  }

  function loadRecipe(r) {
    setTarget(r.target); setBatchKg(r.batchKg); setParts(r.parts); setPrices(r.prices);
  }

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Feed Mix Calculator</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="inline-select">
            {Object.entries(RATION_TARGETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button className="btn" onClick={() => setParts(starterMix(flock.type))}>Reset blend</button>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard
          title="Protein"
          value={calc ? `${num(calc.protein, 1)}%` : '—'}
          tone={calc ? tone(calc.protein, t.protein) : undefined}
          foot={`target ${t.protein[0]}–${t.protein[1]}%`}
        />
        <StatCard
          title="Calcium"
          value={calc ? `${num(calc.calcium, 2)}%` : '—'}
          tone={calc ? tone(calc.calcium, t.calcium) : undefined}
          foot={`target ${t.calcium[0]}–${t.calcium[1]}%`}
        />
        <StatCard
          title="Energy (ME)"
          value={calc ? `${num(calc.energy)} Kcal` : '—'}
          tone={calc ? tone(calc.energy, t.energy) : undefined}
          foot={`target ${t.energy[0]}–${t.energy[1]}`}
        />
        <StatCard
          title="Your Cost / kg"
          value={calc ? `GH₵ ${num(calc.costPerKg, 2)}` : '—'}
          tone={savingPerKg > 0 ? 'green' : 'rust'}
          foot={savingPerKg != null ? `bagged feed: GH₵ ${num(bagCostPerKg, 2)}/kg` : ''}
        />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>What you save</h3></div>
        <div className="mix-compare">
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Bagged feed price (GH₵ / 50kg bag)</label>
            <input type="number" value={bagPrice} onChange={(e) => setBagPrice(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 180 }}>
            <label>Batch size (kg)</label>
            <input type="number" value={batchKg} onChange={(e) => setBatchKg(e.target.value)} />
          </div>
          <div className="mix-saving">
            {savingPerKg != null && (
              savingPerKg > 0 ? (
                <>
                  <div className="stat-value green">GH₵ {num(batchSaving, 2)}</div>
                  <p className="stat-foot">
                    saved on a {num(batchKg)} kg batch (GH₵ {num(savingPerKg, 2)}/kg cheaper).
                    Batch costs you GH₵ {num(batchCost, 2)}.
                  </p>
                </>
              ) : (
                <>
                  <div className="stat-value rust">GH₵ {num(Math.abs(batchSaving), 2)} more</div>
                  <p className="stat-foot">
                    Mixing is costing more than bagged feed right now — usually means maize prices are high.
                  </p>
                </>
              )
            )}
          </div>
        </div>
      </div>

      <p className="section-title">Blend &amp; ingredient prices</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Ingredient</th><th>Parts (per 100)</th><th>Price GH₵/kg</th><th>Weigh out</th><th>Protein %</th><th>Calcium %</th><th>Cost in batch</th></tr>
          </thead>
          <tbody>
            {INGREDIENTS.map((i) => {
              const p = Number(parts[i.id]) || 0;
              const kg = p * scale;
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>
                    <input
                      className="mini-input" type="number" step="0.5" value={parts[i.id] ?? ''}
                      onChange={(e) => setPart(i.id, e.target.value)} placeholder="0"
                    />
                  </td>
                  <td>
                    <input
                      className="mini-input" type="number" step="0.1" value={prices[i.id] ?? ''}
                      onChange={(e) => setPrice(i.id, e.target.value)}
                    />
                  </td>
                  <td className="mono">{p > 0 ? `${num(kg, 1)} kg` : '—'}</td>
                  <td className="mono">{num(i.protein, 1)}</td>
                  <td className="mono">{num(i.calcium, 2)}</td>
                  <td className="mono">{p > 0 ? `GH₵ ${num(kg * (Number(prices[i.id]) || 0), 2)}` : '—'}</td>
                </tr>
              );
            })}
            <tr>
              <td><strong>Total</strong></td>
              <td className="mono"><strong>{num(totalParts, 1)}</strong></td>
              <td></td>
              <td className="mono"><strong>{num(Number(batchKg) || 0, 1)} kg</strong></td>
              <td colSpan={2}></td>
              <td className="mono"><strong>{batchCost != null ? `GH₵ ${num(batchCost, 2)}` : '—'}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>Save this recipe</h3></div>
        <div className="mix-compare">
          <div className="field" style={{ maxWidth: 300 }}>
            <label>Recipe name</label>
            <input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} placeholder="e.g. Layer mix — Aug maize price" />
          </div>
          <button className="btn btn-gold" onClick={saveThis} style={{ alignSelf: 'flex-end' }}>Save recipe</button>
        </div>
        {recipes.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="data">
              <thead>
                <tr><th>Recipe</th><th>Target</th><th>Protein</th><th>Calcium</th><th>Cost/kg</th><th>Saved</th><th></th></tr>
              </thead>
              <tbody>
                {recipes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{RATION_TARGETS[r.target]?.label || r.target}</td>
                    <td className="mono">{num(r.protein, 1)}%</td>
                    <td className="mono">{num(r.calcium, 2)}%</td>
                    <td className="mono">GH₵ {num(r.costPerKg, 2)}</td>
                    <td className="mono">{fmtDate(r.savedOn)}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button className="link-btn" onClick={() => loadRecipe(r)}>Load</button>
                        <button className="link-btn rust" onClick={() => onDelete(r.id)}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="stale-banner" style={{ marginTop: 18 }}>
        ⚠ <span>
          Nutrient figures here are typical book values used to compare blends and catch a bad ratio —
          they are not a lab analysis. <strong>Always follow the inclusion rate printed on your concentrate bag</strong>,
          since brands differ. And check your maize: mouldy maize carries aflatoxin, which quietly cuts
          laying, weakens shells, and can kill birds — no calculator can see that.
        </span>
      </div>
    </>
  );
}

/* ============================================================= */
/* =================== WHOLE FARM WORKSPACE ==================== */
/* ============================================================= */

const EXPENSE_CATEGORIES = ['Labour', 'Transport', 'Utilities', 'Repairs & maintenance', 'Equipment', 'Rent', 'Other'];
const FUEL_TYPES = ['Petrol', 'Diesel', 'Kerosene'];
const FUEL_EQUIPMENT = ['Generator', 'Water pump', 'Vehicle', 'Tiller / cultivator', 'Motorbike', 'Other'];

const BSF_SUBSTRATES = ['Poultry manure', 'Goat manure', 'Kitchen / vegetable scraps', 'Mixed', 'Other'];
const BSF_USES = ['Fed fresh to poultry', 'Dried & stored', 'Sold', 'Other'];
const BSF_CYCLE_DAYS = 42; // typical egg-to-adult cycle; larvae are usually harvest-ready well before this

/** Days a batch has been running, and whether it's likely nearing
    harvest-ready — a loose guide, not a hard rule, since temperature and
    substrate change how fast larvae mature. */
function bsfBatchStatus(batch, asOf = todayISO()) {
  if (batch.harvestDate) return { daysRunning: daysBetween(batch.startDate, batch.harvestDate), complete: true, nearingHarvest: false };
  const daysRunning = daysBetween(batch.startDate, asOf);
  return { daysRunning, complete: false, nearingHarvest: daysRunning >= 18 && daysRunning <= BSF_CYCLE_DAYS };
}

/* Farm help / payroll. Payments live in the SAME `expenses` array as other
   costs (tagged with staffId + paymentKind), so they automatically flow
   through the existing cost rollups — per field, per flock, and whole-farm
   P&L — without any separate wiring. */
const PAY_TYPES = ['Daily', 'Weekly', 'Monthly'];
const PAY_INTERVAL_DAYS = { Daily: 1, Weekly: 7, Monthly: 30 };
const PAYMENT_METHODS = ['Cash', 'Mobile Money', 'Bank'];
const PAYMENT_KINDS = ['Wage', 'Advance', 'Repaid in cash', 'Worked off'];

/** How a payment affects farm cost. Advances are real cash out when given;
    working an advance off isn't new cash, so it doesn't touch cost again. */
function paymentCostImpact(kind, amount) {
  const amt = Number(amount) || 0;
  if (kind === 'Wage' || kind === 'Advance') return amt;
  if (kind === 'Repaid in cash') return -amt;
  return 0; // 'Worked off'
}

/** How a payment affects the advance balance a staff member owes the farm. */
function paymentBalanceImpact(kind, amount) {
  const amt = Number(amount) || 0;
  if (kind === 'Advance') return amt;
  if (kind === 'Repaid in cash' || kind === 'Worked off') return -amt;
  return 0; // 'Wage'
}

function staffBalanceOwed(expenses, staffId) {
  return (expenses || [])
    .filter((e) => e.staffId === staffId)
    .reduce((s, e) => s + (Number(e.balanceAmount) || 0), 0);
}

/** The raw amount the farmer typed in, recovered from wherever it's stored —
    'Worked off' has zero cost impact, so its value only lives in
    balanceAmount; everything else stores it (signed) in amount. */
function paymentRawAmount(p) {
  const source = p.paymentKind === 'Worked off' ? p.balanceAmount : p.amount;
  return Math.abs(Number(source) || 0);
}

/** When this staff member's next payment is expected, based on their pay
    type and the last wage actually logged (or their start date if none yet). */
function nextPaymentDue(staff, expenses) {
  const wages = (expenses || [])
    .filter((e) => e.staffId === staff.id && e.paymentKind === 'Wage')
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const base = wages.length ? wages[0].date : staff.startDate;
  if (!base) return null;
  const interval = PAY_INTERVAL_DAYS[staff.payType] || 7;
  return addDaysISO(base, interval);
}

/* Capital items — structures and kit that last several seasons. Tracked
   separately from running costs so a GH₵25,000 net house doesn't make the
   season it was built in look like a disaster. */
const CAPEX_CATEGORIES = [
  'Insect net house', 'Poultry coop / house', 'Irrigation / drip system',
  'Borehole / water', 'Fencing', 'Store / shed', 'Equipment', 'Other structure',
];

/* Typical working lives, used as sensible defaults. Editable per item. */
const CAPEX_DEFAULT_LIFE = {
  'Insect net house': 4,
  'Poultry coop / house': 10,
  'Irrigation / drip system': 5,
  'Borehole / water': 15,
  'Fencing': 8,
  'Store / shed': 15,
  'Equipment': 5,
  'Other structure': 5,
};

/**
 * Capital cost written off so far, spread evenly over the item's useful life.
 * This is what should hit a season's margin — not the whole purchase price.
 */
function chargedToDate(item, asOf = todayISO()) {
  const amount = Number(item.amount) || 0;
  const life = Number(item.usefulLifeYears) || 1;
  const days = Math.max(0, daysBetween(item.date, asOf));
  return Math.min(amount, amount * (days / 365) / life);
}

function bookValue(item, asOf = todayISO()) {
  return Math.max(0, (Number(item.amount) || 0) - chargedToDate(item, asOf));
}

function annualCharge(item) {
  const life = Number(item.usefulLifeYears) || 1;
  return (Number(item.amount) || 0) / life;
}

/* ---------------- Export Center dataset definitions ---------------- */

function buildExportDatasets(data) {
  const p = data.pepper || {};
  const g = data.goats || {};
  const flockName = (id) => (data.flocks || []).find((f) => f.id === id)?.flockName || id || '—';
  const fieldName = (id) => (p.fields || []).find((f) => f.id === id)?.name || id || '—';
  const staffName = (id) => (data.staff || []).find((s) => s.id === id)?.name || '—';
  const goatName = (id) => { const a = (g.animals || []).find((x) => x.id === id); return a ? (a.name || a.tag) : '—'; };

  return [
    {
      key: 'dailyLog', label: 'Poultry — Daily Log', rows: data.dailyLog || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'flockId', label: 'Flock', get: (r) => flockName(r.flockId) },
        { key: 'birdAge', label: 'Bird Age' }, { key: 'opening', label: 'Opening' },
        { key: 'mortality', label: 'Mortality' }, { key: 'mortalityCause', label: 'Cause' },
        { key: 'culls', label: 'Culls' }, { key: 'closing', label: 'Closing' },
        { key: 'feedGiven', label: 'Feed Given (kg)' }, { key: 'waterGiven', label: 'Water (L)' },
        { key: 'lightHours', label: 'Light (h)' }, { key: 'eggs', label: 'Eggs' },
        { key: 'eggsCracked', label: 'Eggs Cracked' }, { key: 'medication', label: 'Medication' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'feed', label: 'Poultry — Feed Purchases', rows: data.feed || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'flockId', label: 'Flock', get: (r) => flockName(r.flockId) },
        { key: 'feedType', label: 'Feed Type' }, { key: 'purchased', label: 'Purchased (kg)' },
        { key: 'adjustment', label: 'Adjustment (kg)' }, { key: 'cost', label: 'Cost (GH₵)' },
        { key: 'supplier', label: 'Supplier' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'meds', label: 'Poultry — Medications', rows: data.meds || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'flockId', label: 'Flock', get: (r) => flockName(r.flockId) },
        { key: 'drug', label: 'Drug' }, { key: 'purpose', label: 'Purpose' }, { key: 'dosage', label: 'Dosage' },
        { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'duration', label: 'Duration (d)' },
        { key: 'daysGiven', label: 'Days Given', get: (r) => (r.daysGiven || []).length },
        { key: 'by', label: 'By' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'vax', label: 'Poultry — Vaccinations', rows: data.vax || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'flockId', label: 'Flock', get: (r) => flockName(r.flockId) },
        { key: 'disease', label: 'Disease' }, { key: 'vaccine', label: 'Vaccine' }, { key: 'method', label: 'Method' },
        { key: 'status', label: 'Status', get: (r) => r.status || 'done' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'weightSamples', label: 'Poultry — Growth Samples', rows: data.weightSamples || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'flockId', label: 'Flock', get: (r) => flockName(r.flockId) },
        { key: 'sampleSize', label: 'Sample Size' }, { key: 'avgWeightG', label: 'Avg Weight (g)' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'sales', label: 'Poultry — Sales', rows: data.sales || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'flockId', label: 'Flock', get: (r) => flockName(r.flockId) },
        { key: 'item', label: 'Item' }, { key: 'quantity', label: 'Quantity' }, { key: 'unitPrice', label: 'Unit Price' },
        { key: 'amount', label: 'Amount (GH₵)' }, { key: 'buyer', label: 'Buyer' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'litter', label: 'Poultry — Litter & Manure', rows: data.litter || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'flockId', label: 'Flock', get: (r) => flockName(r.flockId) },
        { key: 'action', label: 'Action' }, { key: 'material', label: 'Material' }, { key: 'quantity', label: 'Qty (bags)' },
        { key: 'condition', label: 'Condition' }, { key: 'cost', label: 'Cost (GH₵)' },
        { key: 'toField', label: 'To Field' }, { key: 'batchLabel', label: 'Batch Label' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'scouting', label: 'Bell Pepper — Scouting', rows: p.scouting || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'fieldId', label: 'Field', get: (r) => fieldName(r.fieldId) },
        { key: 'pest', label: 'Pest / Issue' }, { key: 'severity', label: 'Severity' },
        { key: 'pctAffected', label: '% Affected' }, { key: 'action', label: 'Action' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'sprays', label: 'Bell Pepper — Spray & Fertigation', rows: p.sprays || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'fieldId', label: 'Field', get: (r) => fieldName(r.fieldId) },
        { key: 'type', label: 'Type' }, { key: 'product', label: 'Product' }, { key: 'activeIngredient', label: 'Active Ingredient' },
        { key: 'rate', label: 'Rate' }, { key: 'cost', label: 'Cost (GH₵)' }, { key: 'phiDays', label: 'PHI (d)' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'harvests', label: 'Bell Pepper — Harvest & Sales', rows: p.harvests || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'fieldId', label: 'Field', get: (r) => fieldName(r.fieldId) },
        { key: 'weightKg', label: 'Weight (kg)' }, { key: 'grade', label: 'Grade' }, { key: 'pricePerKg', label: 'Price/kg' },
        { key: 'buyer', label: 'Buyer' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'manureReadings', label: 'Bell Pepper — Manure Readings', rows: p.manureReadings || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'location', label: 'Location' }, { key: 'moisture', label: 'Moisture %' },
        { key: 'ec', label: 'EC' }, { key: 'ph', label: 'pH' }, { key: 'n', label: 'N' }, { key: 'p', label: 'P' }, { key: 'k', label: 'K' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'soilReadings', label: 'Bell Pepper — Soil Readings', rows: p.soilReadings || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'fieldId', label: 'Field', get: (r) => fieldName(r.fieldId) },
        { key: 'location', label: 'Location' }, { key: 'moisture', label: 'Moisture %' },
        { key: 'ec', label: 'EC' }, { key: 'ph', label: 'pH' }, { key: 'n', label: 'N' }, { key: 'p', label: 'P' }, { key: 'k', label: 'K' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'batches', label: 'Bell Pepper — Planting Batches', rows: p.batches || [],
      columns: [
        { key: 'fieldId', label: 'Field', get: (r) => fieldName(r.fieldId) }, { key: 'batchLabel', label: 'Batch' },
        { key: 'variety', label: 'Variety' }, { key: 'transplantDate', label: 'Transplanted' },
        { key: 'closedDate', label: 'Closed' }, { key: 'plantCount', label: 'Plants' },
        { key: 'setupCost', label: 'Setup Cost (GH₵)' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'nurseryBatches', label: 'Bell Pepper — Nursery', rows: p.nurseryBatches || [],
      columns: [
        { key: 'batchLabel', label: 'Batch' }, { key: 'variety', label: 'Variety' }, { key: 'seedSowDate', label: 'Sown' },
        { key: 'method', label: 'Method' }, { key: 'quantitySown', label: 'Qty Sown' },
        { key: 'germinationDate', label: 'Germination Date' }, { key: 'germinationPct', label: 'Germination %' },
        { key: 'expectedNurseryDays', label: 'Expected Days' }, { key: 'status', label: 'Status' },
        { key: 'transplantedDate', label: 'Transplanted' },
        { key: 'transplantedToFieldId', label: 'Transplanted To', get: (r) => (r.transplantedToFieldId ? fieldName(r.transplantedToFieldId) : '') },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'inputs', label: 'Bell Pepper — Input Stock', rows: p.inputs || [],
      columns: [
        { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'activeIngredient', label: 'Active Ingredient' },
        { key: 'quantity', label: 'Quantity' }, { key: 'unit', label: 'Unit' }, { key: 'reorderAt', label: 'Reorder At' },
        { key: 'unitCost', label: 'Unit Cost (GH₵)' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'expenses', label: 'Whole Farm — Expenses, Fuel & Structures', rows: data.expenses || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount (GH₵)' }, { key: 'capital', label: 'Structure?', get: (r) => (r.capital ? 'Yes' : 'No') },
        { key: 'usefulLifeYears', label: 'Useful Life (yr)' }, { key: 'scope', label: 'Enterprise' }, { key: 'target', label: 'Target' },
        { key: 'staffId', label: 'Staff', get: (r) => (r.staffId ? staffName(r.staffId) : '') },
        { key: 'liters', label: 'Fuel Liters' }, { key: 'pricePerLiter', label: 'Fuel Price/L' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'staff', label: 'Whole Farm — Staff', rows: data.staff || [],
      columns: [
        { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'phone', label: 'Phone' },
        { key: 'payType', label: 'Pay Type' }, { key: 'rate', label: 'Rate (GH₵)' }, { key: 'startDate', label: 'Started' },
        { key: 'status', label: 'Status' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'invoices', label: 'Whole Farm — Invoices & Receipts', rows: data.invoices || [],
      columns: [
        { key: 'docNumber', label: 'No.' }, { key: 'kind', label: 'Type' }, { key: 'date', label: 'Date' },
        { key: 'buyerName', label: 'Buyer' }, { key: 'buyerPhone', label: 'Phone' }, { key: 'item', label: 'Item' },
        { key: 'quantity', label: 'Qty' }, { key: 'unitPrice', label: 'Unit Price' }, { key: 'amount', label: 'Amount (GH₵)' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'bsf', label: 'Whole Farm — BSF Larvae', rows: (data.bsf?.batches || []),
      columns: [
        { key: 'batchLabel', label: 'Batch' }, { key: 'startDate', label: 'Started' },
        { key: 'substrateType', label: 'Substrate' }, { key: 'substrateKg', label: 'Substrate (kg)' },
        { key: 'harvestDate', label: 'Harvested' }, { key: 'larvaeHarvestedKg', label: 'Larvae (kg)' },
        { key: 'driedKg', label: 'Dried (kg)' }, { key: 'usedFor', label: 'Used For' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'goatAnimals', label: 'Goats — Herd Registry', rows: g.animals || [],
      columns: [
        { key: 'tag', label: 'Tag' }, { key: 'name', label: 'Name' }, { key: 'sex', label: 'Sex' },
        { key: 'breed', label: 'Breed' }, { key: 'dob', label: 'DOB' }, { key: 'source', label: 'Source' },
        { key: 'acquiredDate', label: 'Acquired' }, { key: 'cost', label: 'Cost (GH₵)' },
        { key: 'sireId', label: 'Sire', get: (r) => (r.sireId ? goatName(r.sireId) : '') },
        { key: 'damId', label: 'Dam', get: (r) => (r.damId ? goatName(r.damId) : '') },
        { key: 'bloodline', label: 'Bloodline' }, { key: 'status', label: 'Status' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'goatHeats', label: 'Goats — Heat Observations', rows: g.heats || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'doeId', label: 'Doe', get: (r) => goatName(r.doeId) },
        { key: 'intensity', label: 'Intensity' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'goatMatings', label: 'Goats — Matings', rows: g.matings || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'doeId', label: 'Doe', get: (r) => goatName(r.doeId) },
        { key: 'buckId', label: 'Buck', get: (r) => goatName(r.buckId) },
        { key: 'inbreedingLevel', label: 'Pedigree Check' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'goatKiddings', label: 'Goats — Kiddings', rows: g.kiddings || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'doeId', label: 'Doe', get: (r) => goatName(r.doeId) },
        { key: 'liveKids', label: 'Live Kids' }, { key: 'stillborn', label: 'Stillborn' },
        { key: 'males', label: 'Males' }, { key: 'females', label: 'Females' },
        { key: 'avgBirthWeightKg', label: 'Avg Birth Weight (kg)' }, { key: 'complications', label: 'Complications' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'goatKidMortality', label: 'Goats — Kid Mortality', rows: g.kidMortality || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'doeId', label: 'Dam', get: (r) => goatName(r.doeId) },
        { key: 'cause', label: 'Cause' }, { key: 'stage', label: 'Stage' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'goatHealth', label: 'Goats — Health Log', rows: g.health || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'animalId', label: 'Animal', get: (r) => goatName(r.animalId) },
        { key: 'type', label: 'Type' }, { key: 'product', label: 'Product' }, { key: 'dosage', label: 'Dosage' },
        { key: 'score', label: 'Score' }, { key: 'diagnosis', label: 'Diagnosis' }, { key: 'cost', label: 'Cost (GH₵)' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'goatWeights', label: 'Goats — Weight Samples', rows: g.weights || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'animalId', label: 'Animal', get: (r) => goatName(r.animalId) },
        { key: 'weightKg', label: 'Weight (kg)' }, { key: 'notes', label: 'Notes' },
      ],
    },
    {
      key: 'goatSales', label: 'Goats — Sales', rows: g.sales || [],
      columns: [
        { key: 'date', label: 'Date' }, { key: 'animalId', label: 'Animal', get: (r) => goatName(r.animalId) },
        { key: 'buyer', label: 'Buyer' }, { key: 'weightKg', label: 'Weight (kg)' }, { key: 'price', label: 'Price (GH₵)' },
        { key: 'notes', label: 'Notes' },
      ],
    },
  ];
}

function ExportCenterTab({ data, onNewInvoice, onDeleteInvoice }) {
  const { showToast, askConfirm } = useToastConfirm();
  const datasets = useMemo(() => buildExportDatasets(data), [data]);
  const nonEmpty = datasets.filter((d) => d.rows.length > 0);
  const invoices = [...(data.invoices || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

  function exportOne(ds) {
    const csv = toCSV(ds.rows, ds.columns);
    downloadCSV(`ai-farms-${ds.key}-${todayISO()}.csv`, csv);
  }

  function exportAll() {
    if (!nonEmpty.length) {
      showToast('Nothing to export yet — add some records first.');
      return;
    }
    nonEmpty.forEach((ds, i) => setTimeout(() => exportOne(ds), i * 250));
    showToast(`Downloading ${nonEmpty.length} CSV file(s) — allow multiple downloads if your browser asks.`, 'green');
  }

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Documents</h3>
        <button className="btn btn-green" onClick={onNewInvoice}>+ New Invoice / Receipt</button>
      </div>
      <p className="stat-foot" style={{ marginTop: 0, marginBottom: 14 }}>
        Every sale in Sales &amp; Profit and Harvest &amp; Sales has an <strong>Invoice</strong> button that
        pre-fills one of these from the record — or start a blank one here for anything not logged yet.
      </p>
      {invoices.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <table className="data">
            <thead><tr><th>No.</th><th>Type</th><th>Date</th><th>Buyer</th><th>Item</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.docNumber}</td>
                  <td><span className={`tag ${i.kind === 'receipt' ? 'green' : 'gold'}`}>{i.kind === 'receipt' ? 'Receipt' : 'Invoice'}</span></td>
                  <td className="mono">{fmtDate(i.date)}</td>
                  <td>{i.buyerName}</td>
                  <td>{i.item}</td>
                  <td className="mono">GH₵ {num(i.amount, 2)}</td>
                  <td><button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this record? The buyer keeps any copy already printed.')) onDeleteInvoice(i.id); }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Export Center</h3>
        <button className="btn btn-gold" onClick={exportAll} disabled={!nonEmpty.length}>⤓ Export everything</button>
      </div>
      <p className="stat-foot" style={{ marginTop: 0, marginBottom: 18 }}>
        Each dataset downloads as its own CSV file — opens straight in Excel, Google Sheets, or any
        spreadsheet app. Useful for your own analysis, or handing records to a bank, buyer, or co-op.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Dataset</th><th>Records</th><th></th></tr></thead>
          <tbody>
            {datasets.map((ds) => (
              <tr key={ds.key}>
                <td>{ds.label}</td>
                <td className="mono">{num(ds.rows.length)}</td>
                <td>
                  <button className="link-btn" disabled={!ds.rows.length} onClick={() => exportOne(ds)}>
                    {ds.rows.length ? 'Export CSV' : 'No data'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ============================================================= */
/* ===================== INVOICE / RECEIPT ======================= */
/* ============================================================= */

/**
 * A printable invoice or receipt. The preview IS what prints — a
 * `.invoice-print` wrapper plus a print stylesheet hides everything else on
 * the page, so "Print / Save as PDF" uses the phone's own print dialog
 * (Android's has "Save as PDF" built in) rather than a bundled PDF library.
 */
function InvoiceModal({ prefill, invoices, farmProfile, onSave, onClose }) {
  const [kind, setKind] = useState(prefill?.kind || 'invoice'); // 'invoice' | 'receipt'
  const [f, setF] = useState({
    date: prefill?.date || todayISO(),
    buyerName: prefill?.buyerName || '',
    buyerPhone: prefill?.buyerPhone || '',
    item: prefill?.item || '',
    quantity: prefill?.quantity ?? '',
    unitPrice: prefill?.unitPrice ?? '',
    amount: prefill?.amount ?? '',
    notes: prefill?.notes || '',
  });
  const [docNumber, setDocNumber] = useState(() => nextInvoiceNumber(invoices, kind, f.date));

  function switchKind(next) {
    setKind(next);
    setDocNumber(nextInvoiceNumber(invoices, next, f.date));
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const autoAmount = (Number(f.quantity) || 0) * (Number(f.unitPrice) || 0);
  const amount = f.amount !== '' ? Number(f.amount) : autoAmount;
  const paid = kind === 'receipt';

  function handlePrint() {
    if (!f.buyerName || !f.item) return;
    onSave({
      id: newId(), kind, docNumber, date: f.date,
      buyerName: f.buyerName, buyerPhone: f.buyerPhone || null,
      item: f.item, quantity: f.quantity === '' ? null : Number(f.quantity),
      unitPrice: f.unitPrice === '' ? null : Number(f.unitPrice),
      amount, notes: f.notes || null,
    });
    // Let the saved state settle before the browser's print dialog opens.
    setTimeout(() => window.print(), 50);
  }

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="invoice-shell" onClick={(e) => e.stopPropagation()}>
        <div className="invoice-editor no-print">
          <div className="panel-head" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 16 }}>New {kind === 'receipt' ? 'Receipt' : 'Invoice'}</h3>
            <button className="link-btn" onClick={onClose}>Close</button>
          </div>
          <div className="kind-toggle">
            <button className={kind === 'invoice' ? 'active' : ''} onClick={() => switchKind('invoice')}>Invoice (payment due)</button>
            <button className={kind === 'receipt' ? 'active' : ''} onClick={() => switchKind('receipt')}>Receipt (paid)</button>
          </div>
          <div className="form-grid">
            <Field label="Doc number"><input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} /></Field>
            <Field label="Date"><input type="date" value={f.date} onChange={(e) => { set('date')(e); setDocNumber(nextInvoiceNumber(invoices, kind, e.target.value)); }} /></Field>
            <Field label="Buyer name"><input value={f.buyerName} onChange={set('buyerName')} /></Field>
            <Field label="Buyer phone"><input value={f.buyerPhone} onChange={set('buyerPhone')} /></Field>
            <Field label="Item"><input value={f.item} onChange={set('item')} /></Field>
            <Field label="Quantity"><input type="number" value={f.quantity} onChange={set('quantity')} /></Field>
            <Field label="Unit price (GH₵)"><input type="number" step="0.01" value={f.unitPrice} onChange={set('unitPrice')} /></Field>
            <Field label="Amount (GH₵)"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} placeholder={autoAmount ? `auto ${num(autoAmount, 2)}` : 'or type total'} /></Field>
            <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="payment method, delivery details..." /></Field>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-gold" onClick={handlePrint} disabled={!f.buyerName || !f.item}>
              ⤓ Save &amp; Print / Save as PDF
            </button>
          </div>
        </div>

        <div className="invoice-print">
          <div className="invoice-head">
            <div>
              <div className="invoice-biz-name">{(farmProfile.farmName || 'MY FARM').toUpperCase()}</div>
              {farmProfile.location && <div className="invoice-biz-line">{farmProfile.location}</div>}
              {farmProfile.email && <div className="invoice-biz-line">{farmProfile.email}</div>}
              {farmProfile.phone && <div className="invoice-biz-line">WhatsApp: {farmProfile.phone}</div>}
            </div>
            <div className="invoice-title-block">
              <div className="invoice-title">{kind === 'receipt' ? 'RECEIPT' : 'INVOICE'}</div>
              <div className="invoice-meta">No. {docNumber}</div>
              <div className="invoice-meta">Date: {fmtDate(f.date)}</div>
            </div>
          </div>
          <div className="invoice-rule" />
          <div className="invoice-billto">
            <div className="invoice-billto-label">BILLED TO</div>
            <div>{f.buyerName || '—'}</div>
            {f.buyerPhone && <div>{f.buyerPhone}</div>}
          </div>
          <table className="invoice-table">
            <thead><tr><th>Item</th><th>Qty</th><th>Unit Price (GH₵)</th><th>Amount (GH₵)</th></tr></thead>
            <tbody>
              <tr>
                <td>{f.item || '—'}</td>
                <td>{f.quantity !== '' ? num(f.quantity) : '—'}</td>
                <td>{f.unitPrice !== '' ? num(f.unitPrice, 2) : '—'}</td>
                <td>{num(amount, 2)}</td>
              </tr>
            </tbody>
          </table>
          <div className="invoice-total">TOTAL &nbsp; <span>GH₵ {num(amount, 2)}</span></div>
          <div className={`invoice-status ${paid ? 'paid' : 'due'}`}>{paid ? 'PAID IN FULL' : 'PAYMENT DUE'}</div>
          {f.notes && <div className="invoice-notes">{f.notes}</div>}
          <div className="invoice-footer">Thank you for your business — {farmProfile.farmName || 'us'}{farmProfile.location ? `, ${farmProfile.location}` : ''}.</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================= */
/* ============================ GOATS ============================ */
/* ============================================================= */

const GOAT_BREEDS = ['West African Dwarf', 'Sahel / Sudan', 'Boer cross', 'Nubian cross', 'Mixed / local', 'Other'];
const GOAT_STATUSES = ['active', 'quarantine', 'sold', 'deceased', 'culled'];
const HEALTH_TYPES = ['Deworming', 'Vaccination', 'FAMACHA', 'BCS', 'Treatment'];
const KID_MORT_CAUSES = ['Stillbirth', 'Crushed by dam', 'Disease', 'Weak birth / chill', 'Predator', 'Unknown', 'Other'];

function ageLabel(dob) {
  if (!dob) return '—';
  const days = daysBetween(dob, todayISO());
  if (days < 0) return '—';
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months}mo`;
  return `${(days / 365.25).toFixed(1)}yr`;
}

function goatAncestors(animals, id, depth, maxDepth, acc) {
  if (!id || depth > maxDepth) return;
  const a = animals.find((x) => x.id === id);
  if (!a) return;
  if (!acc.has(id) || acc.get(id) > depth) acc.set(id, depth);
  if (a.sireId) goatAncestors(animals, a.sireId, depth + 1, maxDepth, acc);
  if (a.damId) goatAncestors(animals, a.damId, depth + 1, maxDepth, acc);
}

/** Traces both pedigrees up to 3 generations and flags shared ancestry.
    'block' = direct parent/offspring or full siblings; 'caution' = half
    siblings or a shared ancestor further back; 'clear' = nothing found in
    the recorded pedigree (which may simply mean the pedigree isn't known). */
function checkInbreeding(animals, doeId, buckId) {
  const doe = animals.find((a) => a.id === doeId);
  const buck = animals.find((a) => a.id === buckId);
  if (!doe || !buck || doeId === buckId) return { level: 'block', reason: 'Same animal or missing record' };
  if (doe.sireId === buckId || doe.damId === buckId || buck.sireId === doeId || buck.damId === doeId) {
    return { level: 'block', reason: 'Direct parent / offspring pair' };
  }
  const sameSire = doe.sireId && buck.sireId && doe.sireId === buck.sireId;
  const sameDam = doe.damId && buck.damId && doe.damId === buck.damId;
  if (sameSire && sameDam) return { level: 'block', reason: 'Full siblings — same sire and dam' };
  if (sameSire || sameDam) return { level: 'caution', reason: 'Half-siblings — share one parent' };
  const doeAnc = new Map();
  goatAncestors(animals, doe.sireId, 1, 3, doeAnc);
  goatAncestors(animals, doe.damId, 1, 3, doeAnc);
  const buckAnc = new Map();
  goatAncestors(animals, buck.sireId, 1, 3, buckAnc);
  goatAncestors(animals, buck.damId, 1, 3, buckAnc);
  for (const [id] of doeAnc) {
    if (buckAnc.has(id)) return { level: 'caution', reason: 'Shared ancestor within 3 generations' };
  }
  if (!doe.sireId && !doe.damId && !buck.sireId && !buck.damId) {
    return { level: 'clear', reason: 'No pedigree on file for either animal yet' };
  }
  return { level: 'clear', reason: 'No shared ancestry found in recorded pedigree' };
}

function inbreedingBadge(level) {
  if (level === 'block') return <span className="tag rust">🔴 Blocked — close relatives</span>;
  if (level === 'caution') return <span className="tag gold">🟡 Caution — related line</span>;
  return <span className="tag green">🟢 Clear</span>;
}

function GoatWorkspace({
  goats, farmProfile, reminders, expenses,
  onAddGoat, onUpdateGoat, onDeleteGoat,
  onAddHeat, onDeleteHeat,
  onAddMating, onDeleteMating,
  onAddKidding, onDeleteKidding,
  onAddKidMortality, onDeleteKidMortality,
  onAddHealth, onDeleteHealth,
  onAddWeight, onDeleteWeight,
  onAddSale, onDeleteSale,
  onAddReminder, onToggleReminder, onDeleteReminder,
  onInvoiceSale,
}) {
  const { showToast, askConfirm } = useToastConfirm();
  const [gtab, setGtab] = useState('dashboard');
  const [modal, setModal] = useState(null);
  const [editingGoat, setEditingGoat] = useState(null);
  const [matingPrefillDoe, setMatingPrefillDoe] = useState(null);
  const [kiddingPrefill, setKiddingPrefill] = useState(null);
  const [mortalityPrefill, setMortalityPrefill] = useState(null);

  // Memoized (not just `|| []`) so hooks further down that depend on these
  // — the reminders list, the explorer's scenario calcs — actually get to
  // skip recomputation instead of seeing a "new" array every render.
  const animals = useMemo(() => goats.animals || [], [goats.animals]);
  const heats = useMemo(() => goats.heats || [], [goats.heats]);
  const matings = useMemo(() => goats.matings || [], [goats.matings]);
  const kiddings = useMemo(() => goats.kiddings || [], [goats.kiddings]);
  const kidMortality = useMemo(() => goats.kidMortality || [], [goats.kidMortality]);
  const health = useMemo(() => goats.health || [], [goats.health]);
  const weights = useMemo(() => goats.weights || [], [goats.weights]);
  const sales = useMemo(() => goats.sales || [], [goats.sales]);

  const activeAnimals = animals.filter((a) => a.status === 'active' || a.status === 'quarantine');
  const does = activeAnimals.filter((a) => a.sex === 'doe');
  const bucks = activeAnimals.filter((a) => a.sex === 'buck');
  const goatLabel = useCallback((id) => { const a = animals.find((x) => x.id === id); return a ? `${a.name || a.tag}${a.tag && a.name ? ` (${a.tag})` : ''}` : '—'; }, [animals]);

  const now = todayISO();

  /* ---- auto reminders: deworm cycle, expected heat, expected kidding ---- */
  const autoItems = useMemo(() => {
    const items = [];
    activeAnimals.forEach((a) => {
      const lastDeworm = [...health].filter((h) => h.animalId === a.id && h.type === 'Deworming')
        .sort((x, y) => new Date(y.date) - new Date(x.date))[0];
      const base = lastDeworm ? lastDeworm.date : (a.acquiredDate || a.dob);
      if (base) {
        const due = addDaysISO(base, 90);
        const daysLeft = daysBetween(now, due);
        if (daysLeft <= 14) items.push({ id: `deworm-${a.id}`, title: `Deworm — ${a.name || a.tag}`, dueDate: due, daysLeft, source: 'goats · deworm cycle' });
      }
      if (a.sex === 'doe') {
        const pregnant = matings.some((m) => m.doeId === a.id && !kiddings.some((k) => k.matingId === m.id) && daysBetween(m.date, now) < 155);
        if (!pregnant) {
          const lastHeat = [...heats].filter((h) => h.doeId === a.id).sort((x, y) => new Date(y.date) - new Date(x.date))[0];
          if (lastHeat) {
            const due = addDaysISO(lastHeat.date, 20);
            const daysLeft = daysBetween(now, due);
            if (daysLeft <= 5) items.push({ id: `heat-${a.id}`, title: `Expect heat — ${a.name || a.tag}`, dueDate: due, daysLeft, source: 'goats · heat cycle (~20d)' });
          }
        }
      }
    });
    matings.forEach((m) => {
      if (!kiddings.some((k) => k.matingId === m.id)) {
        const due = addDaysISO(m.date, 150);
        const daysLeft = daysBetween(now, due);
        if (daysLeft <= 14) items.push({ id: `kid-${m.id}`, title: `Expect kidding — ${goatLabel(m.doeId)}`, dueDate: due, daysLeft, source: 'goats · gestation (~150d)' });
      }
    });
    return items;
  }, [activeAnimals, health, heats, matings, kiddings, now, goatLabel]);

  /* ---- dashboard stats ---- */
  const totalHerd = activeAnimals.length;
  const soldCount = animals.filter((a) => a.status === 'sold').length;
  const deceasedCount = animals.filter((a) => a.status === 'deceased' || a.status === 'culled').length;
  const totalBornLive = kiddings.reduce((s, k) => s + (Number(k.liveKids) || 0), 0);
  const totalStillborn = kiddings.reduce((s, k) => s + (Number(k.stillborn) || 0), 0);
  const kidDeaths = kidMortality.length;
  const kidSurvivalRate = totalBornLive ? Math.round(((totalBornLive - kidDeaths) / totalBornLive) * 1000) / 10 : null;
  const avgKidsPerKidding = kiddings.length ? Math.round((totalBornLive / kiddings.length) * 10) / 10 : null;
  const revenue = sales.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const purchaseCost = animals.filter((a) => a.source === 'Purchased').reduce((s, a) => s + (Number(a.cost) || 0), 0);
  const healthCost = health.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const goatExpenses = (expenses || []).filter((e) => e.scope === 'goats').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalCost = purchaseCost + healthCost + goatExpenses;
  const margin = revenue - totalCost;
  const blockedCount = matings.filter((m) => m.inbreedingLevel === 'block').length;
  const overdueDeworm = autoItems.filter((i) => i.id.startsWith('deworm-') && i.daysLeft < 0).length;
  const preWeaningDeaths = kidMortality.filter((k) => k.stage === 'pre-weaning').length;
  const postWeaningDeaths = kidMortality.filter((k) => k.stage === 'post-weaning').length;
  const mortByCause = {};
  kidMortality.forEach((k) => { mortByCause[k.cause] = (mortByCause[k.cause] || 0) + 1; });

  const weightChart = useMemo(() => {
    const byMonth = {};
    weights.forEach((w) => {
      const key = (w.date || '').slice(0, 7);
      if (!key) return;
      if (!byMonth[key]) byMonth[key] = { total: 0, n: 0 };
      byMonth[key].total += Number(w.weightKg) || 0;
      byMonth[key].n += 1;
    });
    return Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, avgKg: Math.round((v.total / v.n) * 10) / 10 }));
  }, [weights]);

  function submitGoat(entry) {
    if (editingGoat) onUpdateGoat(editingGoat.id, entry); else onAddGoat({ ...entry, id: newId() });
    setModal(null); setEditingGoat(null);
  }

  async function submitMating(entry) {
    const check = checkInbreeding(animals, entry.doeId, entry.buckId);
    if (check.level === 'block' && !(await askConfirm(
      `🔴 ${check.reason}. This pairing is flagged as inbreeding. Proceed anyway? It will be logged as an overridden mating.`
    ))) return;
    if (check.level === 'caution' && !(await askConfirm(
      `🟡 ${check.reason}. Proceed with this pairing?`
    ))) return;
    onAddMating({ ...entry, id: newId(), inbreedingLevel: check.level, overridden: check.level !== 'clear' });
    setModal(null); setMatingPrefillDoe(null);
    showToast(check.level === 'clear' ? 'Mating logged.' : 'Mating logged with a flagged pairing.', check.level === 'block' ? 'rust' : 'green');
  }

  return (
    <>
      <header className="header">
        <div>
          <p className="brand-eyebrow">{farmProfile.farmName || 'My Farm'} · Goats</p>
          <h1 className="brand-title">Goat Herd</h1>
          <p className="brand-sub">{totalHerd} active · {does.length} does · {bucks.length} bucks · {farmProfile.location || 'location not set'}</p>
        </div>
        <div className="day-stamp">
          <DayRing pct={margin >= 0 ? 1 : 0} color={margin >= 0 ? '#7A9A66' : '#C15F41'} />
          <div>
            <div className={`num ${margin >= 0 ? 'pepper' : ''}`}>GH₵ {num(margin, 2)}</div>
            <div className="label">goat margin to date</div>
          </div>
        </div>
      </header>

      <div className="field-seg" style={{ marginBottom: 20 }}>
        <button className={gtab === 'dashboard' ? 'active' : ''} onClick={() => setGtab('dashboard')}>Dashboard</button>
        <button className={gtab === 'herd' ? 'active' : ''} onClick={() => setGtab('herd')}>Herd</button>
        <button className={gtab === 'breeding' ? 'active' : ''} onClick={() => setGtab('breeding')}>Breeding</button>
        <button className={gtab === 'health' ? 'active' : ''} onClick={() => setGtab('health')}>Health</button>
        <button className={gtab === 'growth' ? 'active' : ''} onClick={() => setGtab('growth')}>Growth</button>
        <button className={gtab === 'financials' ? 'active' : ''} onClick={() => setGtab('financials')}>Sales &amp; P&amp;L</button>
        <button className={gtab === 'reminders' ? 'active' : ''} onClick={() => setGtab('reminders')}>Reminders</button>
        <button className={gtab === 'explore' ? 'active' : ''} onClick={() => setGtab('explore')}>Explore Scenarios</button>
      </div>

      {gtab === 'dashboard' && (
        <>
          <div className="grid grid-4">
            <StatCard title="Active Herd" value={num(totalHerd)} tone="green" foot={`${does.length} does · ${bucks.length} bucks`} />
            <StatCard title="Kid Survival Rate" value={kidSurvivalRate != null ? `${kidSurvivalRate}%` : '—'} tone={kidSurvivalRate == null ? undefined : kidSurvivalRate >= 85 ? 'green' : 'gold'} foot={`${kidDeaths} death(s) of ${totalBornLive} born live · ${totalStillborn} stillborn`} />
            <StatCard title="Avg Kids / Kidding" value={avgKidsPerKidding != null ? num(avgKidsPerKidding, 1) : '—'} tone="gold" foot={`${kiddings.length} kidding(s) recorded`} />
            <StatCard title="Sold / Culled" value={`${soldCount} / ${deceasedCount}`} tone="rust" foot="lifetime herd movement" />
          </div>
          <div className="grid grid-4" style={{ marginTop: 14 }}>
            <StatCard title="Revenue" value={`GH₵ ${num(revenue, 2)}`} tone="green" foot="goat sales" />
            <StatCard title="Cost" value={`GH₵ ${num(totalCost, 2)}`} tone="rust" foot="purchase + health + running" />
            <StatCard title="Margin" value={`GH₵ ${num(margin, 2)}`} tone={margin >= 0 ? 'green' : 'rust'} foot={margin >= 0 ? 'in profit' : 'below break-even'} />
            <StatCard title="Matings Flagged" value={num(blockedCount)} tone={blockedCount ? 'rust' : 'green'} foot="blocked for inbreeding risk" />
          </div>

          {(overdueDeworm > 0 || preWeaningDeaths + postWeaningDeaths > 0) && (
            <div className="stale-banner" style={{ marginTop: 18 }}>
              ⚠️ <span>
                {overdueDeworm > 0 && <>{overdueDeworm} animal(s) overdue for deworming. </>}
                {preWeaningDeaths + postWeaningDeaths > 0 && <>{preWeaningDeaths} pre-weaning and {postWeaningDeaths} post-weaning kid death(s) logged — check the Breeding tab for cause patterns.</>}
              </span>
            </div>
          )}

          {Object.keys(mortByCause).length > 0 && (
            <div className="panel" style={{ marginTop: 18 }}>
              <div className="panel-head"><h3>Kid mortality by cause</h3></div>
              <div style={{ padding: '4px 0 10px' }}>
                {Object.entries(mortByCause).sort((a, b) => b[1] - a[1]).map(([cause, n]) => (
                  <div className="kv" key={cause}><span className="k">{cause}</span><span className="v">{n}</span></div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {gtab === 'herd' && (
        <>
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 18 }}>Herd Registry</h3>
            <button className="btn btn-green" onClick={() => { setEditingGoat(null); setModal('goat'); }}>+ Add goat</button>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Tag / Name</th><th>Sex</th><th>Breed</th><th>Age</th><th>Sire / Dam</th><th>Bloodline</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {animals.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name || a.tag}{a.name && a.tag ? <span className="stat-foot" style={{ margin: 0 }}> {a.tag}</span> : null}</td>
                    <td style={{ textTransform: 'capitalize' }}>{a.sex}</td>
                    <td>{a.breed || '—'}</td>
                    <td className="mono">{ageLabel(a.dob)}</td>
                    <td>{goatLabel(a.sireId)} / {goatLabel(a.damId)}</td>
                    <td>{a.bloodline || '—'}</td>
                    <td><span className={`tag ${a.status === 'active' ? 'green' : a.status === 'quarantine' ? 'gold' : 'rust'}`}>{a.status}</span></td>
                    <td>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button className="link-btn" onClick={() => { setEditingGoat(a); setModal('goat'); }}>Edit</button>
                        <button className="link-btn rust" onClick={async () => { if (await askConfirm(`Delete ${a.name || a.tag}? This does not delete linked breeding/health records.`)) onDeleteGoat(a.id); }}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
                {animals.length === 0 && <tr><td colSpan={8} className="empty">No goats yet — add your first doe or buck.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {gtab === 'breeding' && (
        <>
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 18 }}>Heat Observations</h3>
            <button className="btn btn-gold" onClick={() => setModal('heat')} disabled={!does.length}>+ Log heat</button>
          </div>
          <div className="table-wrap" style={{ marginBottom: 24 }}>
            <table className="data">
              <thead><tr><th>Date</th><th>Doe</th><th>Intensity</th><th>Next expected</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {[...heats].sort((a, b) => new Date(b.date) - new Date(a.date)).map((h) => (
                  <tr key={h.id}>
                    <td className="mono">{fmtDate(h.date)}</td>
                    <td>{goatLabel(h.doeId)}</td>
                    <td>{h.intensity || '—'}</td>
                    <td className="mono">{fmtDate(addDaysISO(h.date, 20))}</td>
                    <td>{h.notes || '—'}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button className="link-btn" onClick={() => { setMatingPrefillDoe(h.doeId); setModal('mating'); }}>Log mating</button>
                        <button className="link-btn rust" onClick={() => onDeleteHeat(h.id)}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
                {heats.length === 0 && <tr><td colSpan={6} className="empty">No heat observations logged yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 18 }}>Matings</h3>
            <button className="btn btn-gold" onClick={() => setModal('mating')} disabled={!does.length || !bucks.length}>+ Log mating</button>
          </div>
          <div className="table-wrap" style={{ marginBottom: 24 }}>
            <table className="data">
              <thead><tr><th>Date</th><th>Doe × Buck</th><th>Pedigree check</th><th>Expected kidding</th><th></th></tr></thead>
              <tbody>
                {[...matings].sort((a, b) => new Date(b.date) - new Date(a.date)).map((m) => {
                  const kidded = kiddings.find((k) => k.matingId === m.id);
                  const returnedToHeat = heats.some((h) => h.doeId === m.doeId && !kidded && daysBetween(m.date, h.date) >= 16 && daysBetween(m.date, h.date) <= 26);
                  return (
                    <tr key={m.id}>
                      <td className="mono">{fmtDate(m.date)}</td>
                      <td>{goatLabel(m.doeId)} × {goatLabel(m.buckId)}</td>
                      <td>{inbreedingBadge(m.inbreedingLevel || 'clear')}</td>
                      <td className="mono">
                        {fmtDate(addDaysISO(m.date, 150))}
                        {kidded && <span className="tag green" style={{ marginLeft: 6 }}>Kidded</span>}
                        {!kidded && returnedToHeat && <span className="tag rust" style={{ marginLeft: 6 }}>⚠ Returned to heat</span>}
                      </td>
                      <td>
                        <span style={{ display: 'flex', gap: 8 }}>
                          {!kidded && (
                            <button className="link-btn" onClick={() => { setKiddingPrefill({ matingId: m.id, doeId: m.doeId }); setModal('kidding'); }}>Record kidding</button>
                          )}
                          <button className="link-btn rust" onClick={() => onDeleteMating(m.id)}>Delete</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {matings.length === 0 && <tr><td colSpan={5} className="empty">No matings logged yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 18 }}>Kiddings</h3>
            <button className="btn btn-green" onClick={() => { setKiddingPrefill(null); setModal('kidding'); }} disabled={!does.length}>+ Record kidding</button>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Doe</th><th>Live / Stillborn</th><th>Complications</th><th></th></tr></thead>
              <tbody>
                {[...kiddings].sort((a, b) => new Date(b.date) - new Date(a.date)).map((k) => (
                  <tr key={k.id}>
                    <td className="mono">{fmtDate(k.date)}</td>
                    <td>{goatLabel(k.doeId)}</td>
                    <td className="mono">{k.liveKids || 0} / {k.stillborn || 0}</td>
                    <td>{k.complications || '—'}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button className="link-btn rust" onClick={() => { setMortalityPrefill({ kiddingId: k.id, doeId: k.doeId }); setModal('kidmort'); }}>+ Kid death</button>
                        <button className="link-btn rust" onClick={() => onDeleteKidding(k.id)}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
                {kiddings.length === 0 && <tr><td colSpan={5} className="empty">No kiddings recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>

          {kidMortality.length > 0 && (
            <>
              <p className="section-title" style={{ marginTop: 22 }}>Kid Mortality Log</p>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Date</th><th>Dam</th><th>Cause</th><th>Stage</th><th>Notes</th><th></th></tr></thead>
                  <tbody>
                    {[...kidMortality].sort((a, b) => new Date(b.date) - new Date(a.date)).map((k) => (
                      <tr key={k.id}>
                        <td className="mono">{fmtDate(k.date)}</td>
                        <td>{goatLabel(k.doeId)}</td>
                        <td>{k.cause}</td>
                        <td style={{ textTransform: 'capitalize' }}>{k.stage}</td>
                        <td>{k.notes || '—'}</td>
                        <td><button className="link-btn rust" onClick={() => onDeleteKidMortality(k.id)}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {gtab === 'health' && (
        <>
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 18 }}>Health Log</h3>
            <button className="btn btn-gold" onClick={() => setModal('health')} disabled={!animals.length}>+ Add record</button>
          </div>
          <p className="stat-foot" style={{ marginTop: 0 }}>
            Deworm every ~3 months (parasites, especially barber-pole worm, are the top killer of goats in humid
            climates) and check FAMACHA (eyelid colour) between full dewormings to avoid over-treating and
            building resistance. Vaccinate against PPR annually.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Animal</th><th>Type</th><th>Detail</th><th>Cost</th><th></th></tr></thead>
              <tbody>
                {[...health].sort((a, b) => new Date(b.date) - new Date(a.date)).map((h) => (
                  <tr key={h.id}>
                    <td className="mono">{fmtDate(h.date)}</td>
                    <td>{goatLabel(h.animalId)}</td>
                    <td><span className="tag gold">{h.type}</span></td>
                    <td>
                      {h.type === 'Deworming' && `${h.product || ''} ${h.dosage || ''}`}
                      {h.type === 'Vaccination' && (h.product || 'PPR')}
                      {h.type === 'FAMACHA' && `Score ${h.score}/5`}
                      {h.type === 'BCS' && `Score ${h.score}/5`}
                      {h.type === 'Treatment' && (h.diagnosis || h.notes || '—')}
                    </td>
                    <td className="mono">{h.cost ? `GH₵ ${num(h.cost, 2)}` : '—'}</td>
                    <td><button className="link-btn rust" onClick={() => onDeleteHealth(h.id)}>Delete</button></td>
                  </tr>
                ))}
                {health.length === 0 && <tr><td colSpan={6} className="empty">No health records yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {gtab === 'growth' && (
        <>
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 18 }}>Weight Tracking</h3>
            <button className="btn btn-gold" onClick={() => setModal('weight')} disabled={!animals.length}>+ Log weight</button>
          </div>
          {weightChart.length > 1 && (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head"><h3>Average herd weight by month</h3></div>
              <div className="chart-card">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={weightChart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#423827' }} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="avgKg" name="Avg weight (kg)" stroke="#7A9A66" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Animal</th><th>Weight (kg)</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {[...weights].sort((a, b) => new Date(b.date) - new Date(a.date)).map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{fmtDate(w.date)}</td>
                    <td>{goatLabel(w.animalId)}</td>
                    <td className="mono">{num(w.weightKg, 1)}</td>
                    <td>{w.notes || '—'}</td>
                    <td><button className="link-btn rust" onClick={() => onDeleteWeight(w.id)}>Delete</button></td>
                  </tr>
                ))}
                {weights.length === 0 && <tr><td colSpan={5} className="empty">No weight samples yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {gtab === 'financials' && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 18 }}>
            <StatCard title="Revenue" value={`GH₵ ${num(revenue, 2)}`} tone="green" foot="goat sales" />
            <StatCard title="Purchase Cost" value={`GH₵ ${num(purchaseCost, 2)}`} tone="rust" foot="animals bought in" />
            <StatCard title="Health Cost" value={`GH₵ ${num(healthCost, 2)}`} tone="rust" foot="deworm, vax, treatment" />
            <StatCard title="Margin" value={`GH₵ ${num(margin, 2)}`} tone={margin >= 0 ? 'green' : 'rust'} foot="revenue − all cost" />
          </div>
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 18 }}>Sales</h3>
            <button className="btn btn-green" onClick={() => setModal('sale')} disabled={!activeAnimals.length}>+ Record sale</button>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Animal</th><th>Buyer</th><th>Weight (kg)</th><th>Price</th><th></th></tr></thead>
              <tbody>
                {[...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{fmtDate(s.date)}</td>
                    <td>{goatLabel(s.animalId)}</td>
                    <td>{s.buyer || '—'}</td>
                    <td className="mono">{s.weightKg ? num(s.weightKg, 1) : '—'}</td>
                    <td className="mono">GH₵ {num(s.price, 2)}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button className="link-btn" onClick={() => onInvoiceSale(s, goatLabel(s.animalId))}>Invoice</button>
                        <button className="link-btn rust" onClick={() => onDeleteSale(s.id)}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td colSpan={6} className="empty">No goat sales yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="stat-foot" style={{ marginTop: 14 }}>
            Running goat costs (housing, mineral licks, general vet visits) are logged as expenses in
            <strong> Whole Farm → Profit &amp; loss</strong> with enterprise set to "Goats" — they flow into this
            margin automatically. Full CSV export for every goat dataset is in <strong>Whole Farm → Export</strong>.
          </p>
        </>
      )}

      {gtab === 'reminders' && (
        <RemindersTab
          reminders={reminders}
          scope="goats"
          autoItems={autoItems}
          onAdd={() => setModal('reminder')}
          onToggle={onToggleReminder}
          onDelete={onDeleteReminder}
          accent="green"
        />
      )}

      {gtab === 'explore' && <GoatExplorer />}

      {modal === 'goat' && (
        <GoatForm
          goat={editingGoat}
          animals={animals}
          onClose={() => { setModal(null); setEditingGoat(null); }}
          onSave={submitGoat}
        />
      )}
      {modal === 'heat' && (
        <HeatForm does={does} onClose={() => setModal(null)} onSave={(e) => { onAddHeat({ ...e, id: newId() }); setModal(null); }} />
      )}
      {modal === 'mating' && (
        <MatingForm does={does} bucks={bucks} defaultDoe={matingPrefillDoe} onClose={() => { setModal(null); setMatingPrefillDoe(null); }} onSave={submitMating} />
      )}
      {modal === 'kidding' && (
        <KiddingForm does={does} prefill={kiddingPrefill} onClose={() => { setModal(null); setKiddingPrefill(null); }}
          onSave={(e) => { onAddKidding({ ...e, id: newId() }); setModal(null); setKiddingPrefill(null); }} />
      )}
      {modal === 'kidmort' && (
        <KidMortalityForm does={does} prefill={mortalityPrefill} onClose={() => { setModal(null); setMortalityPrefill(null); }}
          onSave={(e) => { onAddKidMortality({ ...e, id: newId() }); setModal(null); setMortalityPrefill(null); }} />
      )}
      {modal === 'health' && (
        <GoatHealthForm animals={animals} onClose={() => setModal(null)} onSave={(e) => { onAddHealth({ ...e, id: newId() }); setModal(null); }} />
      )}
      {modal === 'weight' && (
        <GoatWeightForm animals={animals} onClose={() => setModal(null)} onSave={(e) => { onAddWeight({ ...e, id: newId() }); setModal(null); }} />
      )}
      {modal === 'sale' && (
        <GoatSaleForm animals={activeAnimals} onClose={() => setModal(null)} onSave={(e) => { onAddSale({ ...e, id: newId() }); setModal(null); }} />
      )}
      {modal === 'reminder' && (
        <ReminderForm scope="goats" onClose={() => setModal(null)} onSave={(e) => { onAddReminder(e); setModal(null); }} />
      )}
    </>
  );
}

/* ============================================================= */
/* =============== GOAT PROFITABILITY EXPLORER =================== */
/* ============================================================= */

function GoatSlider({ label, value, min, max, step, onChange, suffix = '', hint }) {
  return (
    <div className="field span-2" style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label>{label}</label>
        <span className="mono" style={{ color: 'var(--gold)', fontWeight: 600, fontSize: 13 }}>{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="goat-range" />
      {hint && <p className="stat-foot" style={{ margin: '2px 0 0' }}>{hint}</p>}
    </div>
  );
}

function GoatToggle({ label, checked, onChange, onLabel = 'ON', offLabel = 'OFF', hint }) {
  return (
    <div className="field span-2" style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ margin: 0 }}>{label}</label>
        <button type="button" onClick={() => onChange(!checked)}
          className={`goat-toggle-btn${checked ? ' on' : ''}`}>
          {checked ? onLabel : offLabel}
        </button>
      </div>
      {hint && <p className="stat-foot" style={{ margin: '2px 0 0' }}>{hint}</p>}
    </div>
  );
}

function GoatEditableCell({ value, computedValue, overridden, onChange, onReset }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {overridden && (
        <button type="button" onClick={onReset} title={`Reset to modeled value (${computedValue.toFixed(1)})`}
          className="link-btn" style={{ padding: 0, fontSize: 12 }}>↺</button>
      )}
      <input
        type="number" step="0.1" value={Number(value.toFixed(2))}
        onChange={(e) => onChange(e.target.value === '' ? computedValue : Number(e.target.value))}
        className={`goat-edit-cell${overridden ? ' overridden' : ''}`}
      />
    </span>
  );
}

function GoatExplorer() {
  const [initialFemales, setInitialFemales] = useState(5);
  const [initialMales, setInitialMales] = useState(1);

  const [keepAllFemales, setKeepAllFemales] = useState(false);
  const [femaleRetentionPct, setFemaleRetentionPct] = useState(30);
  const [keepAllMales, setKeepAllMales] = useState(false);
  const [maleRetentionPct, setMaleRetentionPct] = useState(0);

  const [kidsPerDoeYear, setKidsPerDoeYear] = useState(1.9);
  const [mortalityPct, setMortalityPct] = useState(6);

  const [doePrice, setDoePrice] = useState(450);
  const [buckPrice, setBuckPrice] = useState(550);
  const [salePrice, setSalePrice] = useState(400);
  const [housingCost, setHousingCost] = useState(4500);

  const [feedAdultMonthly, setFeedAdultMonthly] = useState(15);
  const [feedKidMonthly, setFeedKidMonthly] = useState(6);
  const [healthAdultYearly, setHealthAdultYearly] = useState(70);
  const [healthKidYearly, setHealthKidYearly] = useState(35);

  const [years, setYears] = useState(10);
  const [buckRotationYear, setBuckRotationYear] = useState(3);
  const [rotateBuck, setRotateBuck] = useState(true);

  const [herdOverrides, setHerdOverrides] = useState({});
  const setDoesOverride = (year, value) =>
    setHerdOverrides((prev) => ({ ...prev, [year]: { ...prev[year], does: value } }));
  const setBucksOverride = (year, value) =>
    setHerdOverrides((prev) => ({ ...prev, [year]: { ...prev[year], bucks: value } }));
  const clearOverride = (year, field) =>
    setHerdOverrides((prev) => {
      const next = { ...prev, [year]: { ...prev[year] } };
      delete next[year][field];
      if (Object.keys(next[year]).length === 0) delete next[year];
      return next;
    });

  const [viewYear, setViewYear] = useState(10);

  const femaleRetention = keepAllFemales ? 1 : femaleRetentionPct / 100;
  const maleRetention = keepAllMales ? 1 : maleRetentionPct / 100;
  const mortality = mortalityPct / 100;

  const projection = useMemo(() => {
    const setupCost = doePrice * initialFemales + buckPrice * initialMales + housingCost;
    const rows = [{
      year: 0, label: 'Setup', does: initialFemales, bucks: initialMales,
      kids: 0, sold: 0, revenue: 0, feedCost: 0, healthCost: 0, buckReplaceCost: setupCost,
      totalCost: setupCost, netCashFlow: -setupCost, cumulative: -setupCost,
    }];

    let does = initialFemales;
    let bucks = initialMales;
    let cumulative = -setupCost;

    for (let y = 1; y <= years; y++) {
      const kids = does * kidsPerDoeYear;
      const femaleKids = kids * 0.5;
      const maleKids = kids * 0.5;

      const retainedDoes = femaleKids * femaleRetention;
      const soldDoelings = femaleKids - retainedDoes;
      const retainedBucks = maleKids * maleRetention;
      const soldBucklings = maleKids - retainedBucks;

      const totalSold = soldDoelings + soldBucklings;
      const revenue = totalSold * salePrice;

      const feedCost = feedAdultMonthly * 12 * (does + bucks) + feedKidMonthly * 6 * kids;
      const healthCost = healthAdultYearly * (does + bucks) + healthKidYearly * 0.5 * kids;
      const buckReplaceCost = (rotateBuck && buckRotationYear > 0 && y % buckRotationYear === 0) ? buckPrice : 0;
      const totalCost = feedCost + healthCost + buckReplaceCost;

      const netCashFlow = revenue - totalCost;
      cumulative += netCashFlow;

      const doesEndComputed = does * (1 - mortality) + retainedDoes;
      // A bought replacement buck should actually join the herd count, not
      // just show up as a cost while the buck population keeps decaying —
      // otherwise the model charges you for a buck it never adds back.
      const bucksEndComputed = bucks * (1 - mortality) + retainedBucks + (buckReplaceCost > 0 ? 1 : 0);
      const override = herdOverrides[y] || {};
      const doesEnd = override.does != null ? override.does : doesEndComputed;
      const bucksEnd = override.bucks != null ? override.bucks : bucksEndComputed;

      rows.push({
        year: y, label: `Yr ${y}`, does: doesEnd, bucks: bucksEnd,
        doesComputed: doesEndComputed, bucksComputed: bucksEndComputed,
        doesOverridden: override.does != null, bucksOverridden: override.bucks != null,
        kids, soldDoelings, soldBucklings, sold: totalSold, revenue, feedCost, healthCost, buckReplaceCost,
        totalCost, netCashFlow, cumulative, marginPerGoat: totalSold ? netCashFlow / totalSold : null,
      });

      does = doesEnd;
      bucks = bucksEnd;
    }
    return { rows, setupCost };
  }, [
    initialFemales, initialMales, femaleRetention, maleRetention, kidsPerDoeYear,
    mortality, doePrice, buckPrice, salePrice, housingCost, feedAdultMonthly,
    feedKidMonthly, healthAdultYearly, healthKidYearly, years, rotateBuck, buckRotationYear,
    herdOverrides,
  ]);

  const last = projection.rows[projection.rows.length - 1];
  const breakEvenRow = projection.rows.find((r) => r.year > 0 && r.cumulative >= 0);
  const totalRevenue = projection.rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = projection.rows.reduce((s, r) => s + r.totalCost, 0);
  const totalSold = projection.rows.reduce((s, r) => s + (r.sold || 0), 0);

  const clampedViewYear = Math.min(Math.max(viewYear, 0), years);
  const viewRow = projection.rows.find((r) => r.year === clampedViewYear) || last;
  const rowsThroughView = projection.rows.filter((r) => r.year <= clampedViewYear);
  const soldThroughView = rowsThroughView.reduce((s, r) => s + (r.sold || 0), 0);
  const revenueThroughView = rowsThroughView.reduce((s, r) => s + r.revenue, 0);
  const costThroughView = rowsThroughView.reduce((s, r) => s + r.totalCost, 0);

  const resetDefaults = () => {
    setInitialFemales(5); setInitialMales(1);
    setKeepAllFemales(false); setFemaleRetentionPct(30);
    setKeepAllMales(false); setMaleRetentionPct(0);
    setKidsPerDoeYear(1.9); setMortalityPct(6);
    setDoePrice(450); setBuckPrice(550); setSalePrice(400); setHousingCost(4500);
    setFeedAdultMonthly(15); setFeedKidMonthly(6); setHealthAdultYearly(70); setHealthKidYearly(35);
    setYears(10); setBuckRotationYear(3); setRotateBuck(true);
    setHerdOverrides({}); setViewYear(10);
  };

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Goat Profitability Explorer</h3>
        <button className="link-btn" onClick={resetDefaults}>Reset to defaults</button>
      </div>
      <p className="stat-foot" style={{ marginTop: 0, marginBottom: 18 }}>
        Every number below is an assumption you can change — herd size, sex mix, what you keep vs sell,
        reproduction, mortality, prices and running costs. The projection recalculates as you move it.
      </p>

      <div className="goat-explorer-grid">
        {/* ---------------- Controls ---------------- */}
        <div className="panel">
          <div className="form-grid">
            <p className="section-title">1 · Starting herd</p>
            <Field label="Females (does) to start with">
              <input type="number" min={1} value={initialFemales} onChange={(e) => setInitialFemales(Number(e.target.value))} />
            </Field>
            <Field label="Males (bucks) to start with">
              <input type="number" min={1} value={initialMales} onChange={(e) => setInitialMales(Number(e.target.value))} />
            </Field>

            <p className="section-title">2 · Keep or sell strategy</p>
            <GoatToggle label="Keep all female kids" checked={keepAllFemales} onChange={setKeepAllFemales}
              onLabel="KEEP ALL" offLabel="PARTIAL"
              hint="On = maximise herd growth, nothing female is sold." />
            {!keepAllFemales && (
              <GoatSlider label="Female kids retained" value={femaleRetentionPct} min={0} max={100} step={5}
                onChange={setFemaleRetentionPct} suffix="%" hint="Rest are sold as young does." />
            )}
            <GoatToggle label="Keep all male kids" checked={keepAllMales} onChange={setKeepAllMales}
              onLabel="KEEP ALL" offLabel="PARTIAL" hint="Off = sell every buckling as meat, the usual approach." />
            {!keepAllMales && (
              <GoatSlider label="Male kids retained" value={maleRetentionPct} min={0} max={100} step={5}
                onChange={setMaleRetentionPct} suffix="%" />
            )}

            <p className="section-title">3 · Reproduction &amp; survival</p>
            <GoatSlider label="Kids weaned per doe / year" value={kidsPerDoeYear} min={0.8} max={3} step={0.1}
              onChange={setKidsPerDoeYear} hint="Kiddings/yr × litter size × survival to weaning, combined." />
            <GoatSlider label="Annual mortality / culling" value={mortalityPct} min={0} max={25} step={1}
              onChange={setMortalityPct} suffix="%" />

            <p className="section-title">4 · Prices (GH₵)</p>
            <Field label="Price per breeding doe"><input type="number" step={10} value={doePrice} onChange={(e) => setDoePrice(Number(e.target.value))} /></Field>
            <Field label="Price per buck"><input type="number" step={10} value={buckPrice} onChange={(e) => setBuckPrice(Number(e.target.value))} /></Field>
            <Field label="Average sale price per goat"><input type="number" step={10} value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value))} /></Field>
            <Field label="Housing / pen setup"><input type="number" step={100} value={housingCost} onChange={(e) => setHousingCost(Number(e.target.value))} /></Field>

            <p className="section-title">5 · Running costs (GH₵)</p>
            <Field label="Feed/mineral — per adult / month"><input type="number" value={feedAdultMonthly} onChange={(e) => setFeedAdultMonthly(Number(e.target.value))} /></Field>
            <Field label="Feed/mineral — per kid / month"><input type="number" value={feedKidMonthly} onChange={(e) => setFeedKidMonthly(Number(e.target.value))} /></Field>
            <Field label="Health — per adult / year"><input type="number" step={5} value={healthAdultYearly} onChange={(e) => setHealthAdultYearly(Number(e.target.value))} /></Field>
            <Field label="Health — per kid / year"><input type="number" step={5} value={healthKidYearly} onChange={(e) => setHealthKidYearly(Number(e.target.value))} /></Field>

            <p className="section-title">6 · Time horizon</p>
            <GoatSlider label="Years to project" value={years} min={1} max={20} step={1} onChange={setYears}
              hint="No cap — push this out as far as you want to see the herd compound." />
            <GoatToggle label="Buck rotation (new bloodline)" checked={rotateBuck} onChange={setRotateBuck}
              hint="Recommended every 2-3 years on a small herd to avoid inbreeding." />
            {rotateBuck && (
              <GoatSlider label="Rotate buck every N years" value={buckRotationYear} min={1} max={10} step={1}
                onChange={setBuckRotationYear} hint="Recurring for the whole projection." />
            )}
          </div>
        </div>

        {/* ---------------- Results ---------------- */}
        <div>
          <div className="grid grid-4" style={{ marginBottom: 18 }}>
            <StatCard title="Setup cost" value={`GH₵ ${num(projection.setupCost, 0)}`} tone="rust" foot="does + bucks + housing" />
            <StatCard title={`Herd after Yr ${years}`} value={`${num(last.does, 1)} does`} tone="gold" foot={`${num(last.bucks, 1)} bucks`} />
            <StatCard title="Total sold" value={num(totalSold, 1)} foot="goats, all years" />
            <StatCard title="Total revenue" value={`GH₵ ${num(totalRevenue, 0)}`} tone="green" />
            <StatCard title="Total cost" value={`GH₵ ${num(totalCost, 0)}`} tone="rust" foot="setup + running" />
            <StatCard title={`Cumulative profit — Yr ${years}`} value={`GH₵ ${num(last.cumulative, 0)}`} tone={last.cumulative >= 0 ? 'green' : 'rust'} />
            <StatCard title="Break-even year" value={breakEvenRow ? `Year ${breakEvenRow.year}` : `> Yr ${years}`} tone={breakEvenRow ? 'green' : 'rust'} />
            <StatCard title={`Yearly profit — Yr ${years}`} value={`GH₵ ${num(last.netCashFlow, 0)}`} tone={last.netCashFlow >= 0 ? 'green' : 'rust'} foot="that year alone" />
          </div>

          {/* ---- Jump-to-year snapshot ---- */}
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-head" style={{ marginBottom: 12 }}>
              <h3>Snapshot for a specific year</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="number" min={0} max={years} value={clampedViewYear}
                  onChange={(e) => setViewYear(Number(e.target.value))}
                  style={{ width: 60, textAlign: 'center' }} />
                <input type="range" min={0} max={years} step={1} value={clampedViewYear}
                  onChange={(e) => setViewYear(Number(e.target.value))} className="goat-range" style={{ width: 140 }} />
              </div>
            </div>
            <div className="grid grid-2">
              <div>
                <p className="section-title">Year {clampedViewYear} only {clampedViewYear === 0 && '(setup)'}</p>
                <div className="kv"><span className="k">Kids weaned</span><span className="v">{viewRow.kids ? num(viewRow.kids, 1) : '—'}</span></div>
                <div className="kv"><span className="k">Goats sold</span><span className="v">{viewRow.sold ? num(viewRow.sold, 1) : '—'}</span></div>
                <div className="kv"><span className="k">Revenue</span><span className="v">GH₵ {num(viewRow.revenue, 0)}</span></div>
                <div className="kv"><span className="k">Total cost</span><span className="v">GH₵ {num(viewRow.totalCost, 0)}</span></div>
                <div className="kv"><span className="k">Net cash flow</span>
                  <span className="v" style={{ color: viewRow.netCashFlow >= 0 ? 'var(--green)' : 'var(--rust)', fontWeight: 600 }}>GH₵ {num(viewRow.netCashFlow, 0)}</span>
                </div>
              </div>
              <div>
                <p className="section-title">Cumulative through Year {clampedViewYear}</p>
                <div className="kv"><span className="k">Herd on hand</span><span className="v">{num(viewRow.does, 1)} does · {num(viewRow.bucks, 1)} bucks</span></div>
                <div className="kv"><span className="k">Total goats sold</span><span className="v">{num(soldThroughView, 1)}</span></div>
                <div className="kv"><span className="k">Total revenue</span><span className="v">GH₵ {num(revenueThroughView, 0)}</span></div>
                <div className="kv"><span className="k">Total cost</span><span className="v">GH₵ {num(costThroughView, 0)}</span></div>
                <div className="kv"><span className="k">Cumulative profit</span>
                  <span className="v" style={{ color: viewRow.cumulative >= 0 ? 'var(--green)' : 'var(--rust)', fontWeight: 600 }}>GH₵ {num(viewRow.cumulative, 0)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ---- Chart ---- */}
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-head"><h3>Yearly profit vs cumulative profit</h3></div>
            <p className="stat-foot" style={{ marginTop: 0 }}>
              Bars = that year's revenue and cost. Gold line = cumulative profit. Blue line = that year's
              net profit alone — watch it climb as the herd compounds past break-even.
            </p>
            <div className="chart-card">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={projection.rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#423827' }} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }}
                    formatter={(v, name) => [`GH₵ ${num(v, 0)}`, name]} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#B9AD9A' }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#7A9A66" barSize={14} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="totalCost" name="Cost" fill="#C15F41" barSize={14} radius={[3, 3, 0, 0]} />
                  <Line dataKey="netCashFlow" name="Yearly net profit" stroke="#5B9BD9" strokeWidth={2} dot={{ r: 2.5 }} />
                  <Line dataKey="cumulative" name="Cumulative profit" stroke="#D4A537" strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ---- Table ---- */}
          <div className="table-wrap">
            <p className="stat-foot" style={{ margin: '0 0 8px' }}>
              <strong style={{ color: 'var(--gold)' }}>Does and Bucks are editable</strong> — type your actual
              headcount for any year and every later year recalculates from that real number instead of the model.
            </p>
            <table className="data">
              <thead>
                <tr>
                  <th>Year</th><th>Does</th><th>Bucks</th><th>Kids</th><th>Sold</th>
                  <th>Revenue</th><th>Cost</th><th>Net cash flow</th><th>Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {projection.rows.map((r) => (
                  <tr key={r.year}>
                    <td>{r.label}</td>
                    <td className="mono">
                      {r.year === 0 ? num(r.does, 1) : (
                        <GoatEditableCell value={r.does} computedValue={r.doesComputed} overridden={r.doesOverridden}
                          onChange={(v) => setDoesOverride(r.year, v)} onReset={() => clearOverride(r.year, 'does')} />
                      )}
                    </td>
                    <td className="mono">
                      {r.year === 0 ? num(r.bucks, 1) : (
                        <GoatEditableCell value={r.bucks} computedValue={r.bucksComputed} overridden={r.bucksOverridden}
                          onChange={(v) => setBucksOverride(r.year, v)} onReset={() => clearOverride(r.year, 'bucks')} />
                      )}
                    </td>
                    <td className="mono">{r.kids ? num(r.kids, 1) : '—'}</td>
                    <td className="mono">{r.sold ? num(r.sold, 1) : '—'}</td>
                    <td className="mono">GH₵ {num(r.revenue, 0)}</td>
                    <td className="mono">GH₵ {num(r.totalCost, 0)}</td>
                    <td className="mono" style={{ color: r.netCashFlow >= 0 ? 'var(--green)' : 'var(--rust)' }}>GH₵ {num(r.netCashFlow, 0)}</td>
                    <td className="mono" style={{ color: r.cumulative >= 0 ? 'var(--green)' : 'var(--rust)', fontWeight: 600 }}>GH₵ {num(r.cumulative, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="stat-foot" style={{ marginTop: 14 }}>
            Modeled averages — actual births and sales land on whole animals. Feed assumes browse is
            mostly free; the feed figures cover mineral licks and dry-season supplement only.
          </p>
        </div>
      </div>
    </>
  );
}

function GoatForm({ goat, animals, onClose, onSave }) {
  const [f, setF] = useState({
    tag: goat?.tag || '', name: goat?.name || '', sex: goat?.sex || 'doe', breed: goat?.breed || GOAT_BREEDS[0],
    dob: goat?.dob || '', source: goat?.source || 'Born on farm', acquiredDate: goat?.acquiredDate || todayISO(),
    cost: goat?.cost ?? '', sireId: goat?.sireId || '', damId: goat?.damId || '',
    bloodline: goat?.bloodline || '', status: goat?.status || 'active', notes: goat?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const possibleSires = animals.filter((a) => a.sex === 'buck' && a.id !== goat?.id);
  const possibleDams = animals.filter((a) => a.sex === 'doe' && a.id !== goat?.id);
  function submit() {
    if (!f.tag && !f.name) return;
    onSave({
      ...f, cost: f.cost === '' ? null : Number(f.cost),
      sireId: f.sireId || null, damId: f.damId || null,
    });
  }
  return (
    <Modal title={goat ? 'Edit goat' : 'Add goat'} sub="Tag or name, sex, and pedigree — pedigree powers the inbreeding check." onClose={onClose}>
      <div className="form-grid">
        <Field label="Tag / ID"><input value={f.tag} onChange={set('tag')} placeholder="e.g. G-014" /></Field>
        <Field label="Name"><input value={f.name} onChange={set('name')} /></Field>
        <Field label="Sex">
          <select value={f.sex} onChange={set('sex')}><option value="doe">Doe (female)</option><option value="buck">Buck (male)</option><option value="wether">Wether (castrated)</option></select>
        </Field>
        <Field label="Breed">
          <select value={f.breed} onChange={set('breed')}>{GOAT_BREEDS.map((b) => <option key={b}>{b}</option>)}</select>
        </Field>
        <Field label="Date of birth"><input type="date" value={f.dob} onChange={set('dob')} /></Field>
        <Field label="Source">
          <select value={f.source} onChange={set('source')}><option>Born on farm</option><option>Purchased</option></select>
        </Field>
        <Field label="Acquired / born date"><input type="date" value={f.acquiredDate} onChange={set('acquiredDate')} /></Field>
        {f.source === 'Purchased' && <Field label="Purchase cost (GH₵)"><input type="number" step="0.01" value={f.cost} onChange={set('cost')} /></Field>}
        <Field label="Sire (buck)">
          <select value={f.sireId} onChange={set('sireId')}>
            <option value="">Unknown / none</option>
            {possibleSires.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}
          </select>
        </Field>
        <Field label="Dam (doe)">
          <select value={f.damId} onChange={set('damId')}>
            <option value="">Unknown / none</option>
            {possibleDams.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}
          </select>
        </Field>
        <Field label="Bloodline / group"><input value={f.bloodline} onChange={set('bloodline')} placeholder="e.g. Founding stock A" /></Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>{GOAT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save goat</button>
      </div>
    </Modal>
  );
}

function HeatForm({ does, onClose, onSave }) {
  const [f, setF] = useState({ doeId: does[0]?.id || '', date: todayISO(), intensity: 'Normal', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() { if (!f.doeId) return; onSave(f); }
  return (
    <Modal title="Log heat observation" sub="Tail wagging, mounting behaviour, swelling/reddening, bleating, reduced appetite." onClose={onClose}>
      <div className="form-grid">
        <Field label="Doe"><select value={f.doeId} onChange={set('doeId')}>{does.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Intensity">
          <select value={f.intensity} onChange={set('intensity')}><option>Low</option><option>Normal</option><option>Strong</option></select>
        </Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}

function MatingForm({ does, bucks, defaultDoe, onClose, onSave }) {
  const [f, setF] = useState({ doeId: defaultDoe || does[0]?.id || '', buckId: bucks[0]?.id || '', date: todayISO(), notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() { if (!f.doeId || !f.buckId) return; onSave(f); }
  return (
    <Modal title="Log mating" sub="Checked against recorded pedigree for inbreeding risk before it saves." onClose={onClose}>
      <div className="form-grid">
        <Field label="Doe"><select value={f.doeId} onChange={set('doeId')}>{does.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}</select></Field>
        <Field label="Buck"><select value={f.buckId} onChange={set('buckId')}>{bucks.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save mating</button>
      </div>
    </Modal>
  );
}

function KiddingForm({ does, prefill, onClose, onSave }) {
  const [f, setF] = useState({
    matingId: prefill?.matingId || null, doeId: prefill?.doeId || does[0]?.id || '', date: todayISO(),
    liveKids: '', stillborn: '', males: '', females: '', avgBirthWeightKg: '', complications: '', notes: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.doeId) return;
    onSave({
      ...f, liveKids: Number(f.liveKids) || 0, stillborn: Number(f.stillborn) || 0,
      males: Number(f.males) || 0, females: Number(f.females) || 0,
      avgBirthWeightKg: f.avgBirthWeightKg === '' ? null : Number(f.avgBirthWeightKg),
    });
  }
  return (
    <Modal title="Record kidding" sub="Gestation is ~150 days from mating." onClose={onClose}>
      <div className="form-grid">
        <Field label="Doe"><select value={f.doeId} onChange={set('doeId')}>{does.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Live kids"><input type="number" value={f.liveKids} onChange={set('liveKids')} /></Field>
        <Field label="Stillborn"><input type="number" value={f.stillborn} onChange={set('stillborn')} /></Field>
        <Field label="Males"><input type="number" value={f.males} onChange={set('males')} /></Field>
        <Field label="Females"><input type="number" value={f.females} onChange={set('females')} /></Field>
        <Field label="Avg birth weight (kg)"><input type="number" step="0.1" value={f.avgBirthWeightKg} onChange={set('avgBirthWeightKg')} /></Field>
        <Field label="Complications"><input value={f.complications} onChange={set('complications')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save kidding</button>
      </div>
    </Modal>
  );
}

function KidMortalityForm({ does, prefill, onClose, onSave }) {
  const [f, setF] = useState({
    kiddingId: prefill?.kiddingId || null, doeId: prefill?.doeId || does[0]?.id || '',
    date: todayISO(), cause: KID_MORT_CAUSES[0], stage: 'pre-weaning', notes: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() { if (!f.doeId) return; onSave(f); }
  return (
    <Modal title="Log kid death" sub="Cause and stage help you see where to intervene — bedding, supervision, or the dam herself." onClose={onClose}>
      <div className="form-grid">
        <Field label="Dam"><select value={f.doeId} onChange={set('doeId')}>{does.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Cause"><select value={f.cause} onChange={set('cause')}>{KID_MORT_CAUSES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Stage">
          <select value={f.stage} onChange={set('stage')}><option value="pre-weaning">Pre-weaning</option><option value="post-weaning">Post-weaning</option></select>
        </Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}

function GoatHealthForm({ animals, onClose, onSave }) {
  const [f, setF] = useState({
    animalId: animals[0]?.id || '', date: todayISO(), type: 'Deworming', product: '', dosage: '',
    score: '3', diagnosis: '', cost: '', notes: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.animalId) return;
    onSave({ ...f, cost: f.cost === '' ? null : Number(f.cost), score: (f.type === 'FAMACHA' || f.type === 'BCS') ? Number(f.score) : null });
  }
  return (
    <Modal title="Add health record" onClose={onClose}>
      <div className="form-grid">
        <Field label="Animal"><select value={f.animalId} onChange={set('animalId')}>{animals.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Type"><select value={f.type} onChange={set('type')}>{HEALTH_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        {(f.type === 'Deworming' || f.type === 'Vaccination') && (
          <>
            <Field label={f.type === 'Deworming' ? 'Dewormer product' : 'Vaccine (e.g. PPR)'}><input value={f.product} onChange={set('product')} /></Field>
            {f.type === 'Deworming' && <Field label="Dosage"><input value={f.dosage} onChange={set('dosage')} /></Field>}
          </>
        )}
        {(f.type === 'FAMACHA' || f.type === 'BCS') && (
          <Field label={f.type === 'FAMACHA' ? 'FAMACHA score (1 red = healthy, 5 white = severe anaemia)' : 'Body Condition Score (1 thin – 5 fat, 3 ideal)'}>
            <select value={f.score} onChange={set('score')}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </Field>
        )}
        {f.type === 'Treatment' && <Field label="Diagnosis / treatment" span2><input value={f.diagnosis} onChange={set('diagnosis')} /></Field>}
        <Field label="Cost (GH₵)"><input type="number" step="0.01" value={f.cost} onChange={set('cost')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save record</button>
      </div>
    </Modal>
  );
}

function GoatWeightForm({ animals, onClose, onSave }) {
  const [f, setF] = useState({ animalId: animals[0]?.id || '', date: todayISO(), weightKg: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() { if (!f.animalId || f.weightKg === '') return; onSave({ ...f, weightKg: Number(f.weightKg) }); }
  return (
    <Modal title="Log weight" onClose={onClose}>
      <div className="form-grid">
        <Field label="Animal"><select value={f.animalId} onChange={set('animalId')}>{animals.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Weight (kg)"><input type="number" step="0.1" value={f.weightKg} onChange={set('weightKg')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save</button>
      </div>
    </Modal>
  );
}

function GoatSaleForm({ animals, onClose, onSave }) {
  const [f, setF] = useState({ animalId: animals[0]?.id || '', date: todayISO(), buyer: '', weightKg: '', price: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.animalId || f.price === '') return;
    onSave({ ...f, weightKg: f.weightKg === '' ? null : Number(f.weightKg), price: Number(f.price) });
  }
  return (
    <Modal title="Record goat sale" sub="Ghana goat prices spike around Christmas, Easter, funerals, and Eid — this builds your own seasonal price history." onClose={onClose}>
      <div className="form-grid">
        <Field label="Animal"><select value={f.animalId} onChange={set('animalId')}>{animals.map((a) => <option key={a.id} value={a.id}>{a.name || a.tag}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Buyer"><input value={f.buyer} onChange={set('buyer')} /></Field>
        <Field label="Weight (kg)"><input type="number" step="0.1" value={f.weightKg} onChange={set('weightKg')} /></Field>
        <Field label="Price (GH₵)"><input type="number" step="0.01" value={f.price} onChange={set('price')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>Save sale</button>
      </div>
    </Modal>
  );
}

function FarmWorkspace({ data, onAddExpense, onUpdateExpense, onDeleteExpense, onSaveStaff, onDeleteStaff, onNewInvoice, onDeleteInvoice, onAddBsfBatch, onUpdateBsfBatch, onDeleteBsfBatch }) {
  const [modal, setModal] = useState(null);
  const [view, setView] = useState('pl');   // 'pl' | 'assets' | 'staff' | 'fuel' | 'bsf'
  const [editingPayment, setEditingPayment] = useState(null);
  const [editingStaff, setEditingStaff] = useState(null);
  const [editingFuel, setEditingFuel] = useState(null);
  const [editingBsfBatch, setEditingBsfBatch] = useState(null);

  const allExpenses = data.expenses || [];
  const capital = allExpenses.filter((e) => e.capital);
  const running = allExpenses.filter((e) => !e.capital);
  const staff = data.staff || [];
  const payments = allExpenses.filter((e) => e.staffId);
  const fuel = allExpenses.filter((e) => e.category === 'Fuel');

  const fields = (data.pepper && data.pepper.fields) || [];
  const flocks = data.flocks || [];
  const labelFor = (e) => {
    if (e.target === 'shared' || !e.target) {
      return e.scope === 'pepper' ? 'Both fields' : e.scope === 'poultry' ? 'All flocks' : e.scope === 'goats' ? 'Whole herd' : 'Whole farm';
    }
    const f = fields.find((x) => x.id === e.target);
    if (f) return f.name;
    const fl = flocks.find((x) => x.id === e.target);
    return fl ? fl.flockName : 'Whole farm';
  };

  // Capital is charged over its life, so only the written-off share hits margin.
  const capexCharge = (scope) => capital
    .filter((e) => e.scope === scope)
    .reduce((s, e) => s + chargedToDate(e), 0);
  const runningCost = (scope) => running
    .filter((e) => e.scope === scope)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // ---- Poultry ----
  const poultryRevenue = (data.sales || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const feedCost = (data.feed || []).reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const litterCost = (data.litter || []).reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const flockSetup = flocks.reduce((s, f) => s + (Number(f.setupCost) || 0), 0);
  const medCost = (data.meds || []).reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const poultryCost = feedCost + litterCost + flockSetup + medCost + runningCost('poultry') + capexCharge('poultry');
  const poultryMargin = poultryRevenue - poultryCost;

  // ---- Pepper ----
  const p = data.pepper || {};
  const pepperRevenue = (p.harvests || []).reduce((s, h) => s + (Number(h.weightKg) || 0) * (Number(h.pricePerKg) || 0), 0);
  const sprayCost = (p.sprays || []).reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const fieldSetup = fields.reduce((s, f) => s + (Number(f.setupCost) || 0), 0);
  const pepperCost = sprayCost + fieldSetup + runningCost('pepper') + capexCharge('pepper');
  const pepperMargin = pepperRevenue - pepperCost;

  // ---- Goats ----
  const g = data.goats || {};
  const goatAnimals = g.animals || [];
  const goatRevenue = (g.sales || []).reduce((s, r) => s + (Number(r.price) || 0), 0);
  const goatPurchaseCost = goatAnimals.filter((a) => a.source === 'Purchased').reduce((s, a) => s + (Number(a.cost) || 0), 0);
  const goatHealthCost = (g.health || []).reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const goatCost = goatPurchaseCost + goatHealthCost + runningCost('goats') + capexCharge('goats');
  const goatMargin = goatRevenue - goatCost;

  // ---- General ----
  const generalCost = runningCost('general') + capexCharge('general');

  const totalRevenue = poultryRevenue + pepperRevenue + goatRevenue;
  const totalCost = poultryCost + pepperCost + goatCost + generalCost;
  const netProfit = totalRevenue - totalCost;

  const totalInvested = capital.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalBookValue = capital.reduce((s, e) => s + bookValue(e), 0);

  const manureBags = (data.litter || [])
    .filter((r) => r.action === 'Removed to field')
    .reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  const enterpriseChart = [
    { name: 'Poultry', revenue: Math.round(poultryRevenue), cost: Math.round(poultryCost) },
    { name: 'Bell pepper', revenue: Math.round(pepperRevenue), cost: Math.round(pepperCost) },
    { name: 'Goats', revenue: Math.round(goatRevenue), cost: Math.round(goatCost) },
    { name: 'General', revenue: 0, cost: Math.round(generalCost) },
  ];

  const sortedRunning = [...running].sort((a, b) => new Date(b.date) - new Date(a.date));
  const byCategory = {};
  sortedRunning.forEach((e) => { byCategory[e.category] = (byCategory[e.category] || 0) + (Number(e.amount) || 0); });

  return (
    <>
      <header className="header">
        <div>
          <p className="brand-eyebrow">{data.farmProfile.farmName || 'My Farm'} · Whole Farm</p>
          <h1 className="brand-title">Farm Profit &amp; Loss</h1>
          <p className="brand-sub">{data.farmProfile.location || 'Location not set'} · poultry + bell pepper combined</p>
        </div>
        <div className="day-stamp">
          <DayRing pct={totalRevenue ? Math.max(0, Math.min(1, netProfit / Math.max(totalRevenue, 1))) : 0} color={netProfit >= 0 ? '#7A9A66' : '#C15F41'} />
          <div>
            <div className={`num ${netProfit >= 0 ? 'pepper' : ''}`}>GH₵ {num(netProfit, 2)}</div>
            <div className="label">net {netProfit >= 0 ? 'profit' : 'loss'} to date</div>
          </div>
        </div>
      </header>

      <div className="field-seg" style={{ marginBottom: 20 }}>
        <button className={view === 'pl' ? 'active' : ''} onClick={() => setView('pl')}>Profit &amp; loss</button>
        <button className={view === 'assets' ? 'active' : ''} onClick={() => setView('assets')}>Structures &amp; assets</button>
        <button className={view === 'staff' ? 'active' : ''} onClick={() => setView('staff')}>Farm Team</button>
        <button className={view === 'fuel' ? 'active' : ''} onClick={() => setView('fuel')}>Fuel</button>
        <button className={view === 'bsf' ? 'active' : ''} onClick={() => setView('bsf')}>BSF Larvae</button>
        <button className={view === 'export' ? 'active' : ''} onClick={() => setView('export')}>Export</button>
      </div>

      {view === 'pl' && (<>
        <div className="grid grid-4">
          <StatCard title="Total Revenue" value={`GH₵ ${num(totalRevenue, 2)}`} tone="green" foot="poultry + pepper sales" />
          <StatCard title="Total Cost" value={`GH₵ ${num(totalCost, 2)}`} tone="rust" foot="inputs + running + structure share" />
          <StatCard title="Net Profit" value={`GH₵ ${num(netProfit, 2)}`} tone={netProfit >= 0 ? 'green' : 'rust'} foot={netProfit >= 0 ? 'farm is in profit' : 'farm below break-even'} />
          <StatCard title="Manure Recycled" value={manureBags ? `${num(manureBags, 1)} bags` : '—'} tone="green" foot="poultry litter to fields" />
        </div>

        <div className="grid grid-2" style={{ marginTop: 18 }}>
          <div className="panel">
            <div className="panel-head"><h3>Revenue vs cost by enterprise</h3></div>
            <div className="chart-card">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={enterpriseChart} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#423827" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#423827' }} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#241F18', border: '1px solid #423827', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#B9AD9A' }} />
                  <Bar dataKey="revenue" name="Revenue (GH₵)" fill="#7A9A66" barSize={18} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cost" name="Cost (GH₵)" fill="#C15F41" barSize={18} radius={[3, 3, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h3>Enterprise breakdown</h3></div>
            <div style={{ padding: '4px 0 10px' }}>
              <div className="kv"><span className="k">Poultry revenue</span><span className="v">GH₵ {num(poultryRevenue, 2)}</span></div>
              <div className="kv"><span className="k">Poultry cost</span><span className="v">GH₵ {num(poultryCost, 2)}</span></div>
              <div className="kv">
                <span className="k">Poultry margin</span>
                <span className="v" style={{ color: poultryMargin >= 0 ? 'var(--green)' : 'var(--rust)' }}>GH₵ {num(poultryMargin, 2)}</span>
              </div>
              <div className="kv"><span className="k">Pepper revenue</span><span className="v">GH₵ {num(pepperRevenue, 2)}</span></div>
              <div className="kv"><span className="k">Pepper cost</span><span className="v">GH₵ {num(pepperCost, 2)}</span></div>
              <div className="kv">
                <span className="k">Pepper margin</span>
                <span className="v" style={{ color: pepperMargin >= 0 ? 'var(--green)' : 'var(--rust)' }}>GH₵ {num(pepperMargin, 2)}</span>
              </div>
              <div className="kv"><span className="k">Goat revenue</span><span className="v">GH₵ {num(goatRevenue, 2)}</span></div>
              <div className="kv"><span className="k">Goat cost</span><span className="v">GH₵ {num(goatCost, 2)}</span></div>
              <div className="kv">
                <span className="k">Goat margin</span>
                <span className="v" style={{ color: goatMargin >= 0 ? 'var(--green)' : 'var(--rust)' }}>GH₵ {num(goatMargin, 2)}</span>
              </div>
              <div className="kv"><span className="k">General costs</span><span className="v">GH₵ {num(generalCost, 2)}</span></div>
              <div className="kv">
                <span className="k">Net profit</span>
                <span className="v" style={{ color: netProfit >= 0 ? 'var(--green)' : 'var(--rust)', fontWeight: 600 }}>GH₵ {num(netProfit, 2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="panel-head" style={{ margin: '22px 0 14px' }}>
          <h3 style={{ fontSize: 18 }}>Running expenses</h3>
          <button className="btn btn-gold" onClick={() => setModal('expense')}>+ Add expense</button>
        </div>

        {Object.keys(byCategory).length > 0 && (
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, amt]) => (
              <StatCard key={cat} title={cat} value={`GH₵ ${num(amt, 2)}`} tone="rust" foot="spent to date" />
            ))}
          </div>
        )}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Date</th><th>Category</th><th>Description</th><th>Assigned to</th><th>Amount</th><th></th></tr>
            </thead>
            <tbody>
              {sortedRunning.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{fmtDate(r.date)}</td>
                  <td>{r.category}</td>
                  <td>{r.description || '—'}</td>
                  <td>{labelFor(r)}</td>
                  <td className="mono">GH₵ {num(r.amount, 2)}</td>
                  <td>
                    <span style={{ display: 'flex', gap: 8 }}>
                      {!r.staffId && r.category !== 'Fuel' && (
                        <button className="link-btn" onClick={() => setModal(`expense:${r.id}`)}>Edit</button>
                      )}
                      {r.category === 'Fuel' && <span className="stat-foot" style={{ margin: 0 }}>edit in Fuel tab</span>}
                      <button className="link-btn rust" onClick={() => onDeleteExpense(r.id)}>Delete</button>
                    </span>
                  </td>
                </tr>
              ))}
              {sortedRunning.length === 0 && <tr><td colSpan={6} className="empty">No running expenses yet — add labour, transport, utilities and repairs for a true farm P&amp;L.</td></tr>}
            </tbody>
          </table>
        </div>

        <p className="stat-foot">
          Feed, litter, sprays and flock setup costs are pulled automatically from the poultry and
          pepper workspaces. Add here only what those don&apos;t already capture.
        </p>
      </>)}

      {view === 'assets' && (<>
        <div className="grid grid-4">
          <StatCard title="Total Invested" value={`GH₵ ${num(totalInvested, 2)}`} tone="gold" foot={`${capital.length} structure(s)`} />
          <StatCard title="Remaining Value" value={`GH₵ ${num(totalBookValue, 2)}`} tone="green" foot="life still left in them" />
          <StatCard title="Charged to Date" value={`GH₵ ${num(totalInvested - totalBookValue, 2)}`} tone="rust" foot="written off into margins" />
          <StatCard
            title="Yearly Charge"
            value={`GH₵ ${num(capital.reduce((s, e) => s + annualCharge(e), 0), 2)}`}
            foot="what structures cost per year"
          />
        </div>

        <div className="panel-head" style={{ margin: '22px 0 14px' }}>
          <h3 style={{ fontSize: 18 }}>Structures &amp; equipment</h3>
          <button className="btn btn-gold" onClick={() => setModal('expense')}>+ Add structure</button>
        </div>

        <AssetsTable capital={capital} labelFor={labelFor} onDelete={onDeleteExpense} />

        <p className="stat-foot">
          A net house or coop serves many seasons, so its cost is spread across its useful life rather
          than charged entirely to the season it was built. That keeps one big build from making an
          otherwise good season look like a loss.
        </p>
      </>)}

      {view === 'staff' && (
        <StaffPayrollTab
          staff={staff}
          payments={payments}
          labelFor={labelFor}
          onAddStaff={() => { setEditingStaff(null); setModal('staff'); }}
          onEditStaff={(s) => { setEditingStaff(s); setModal('staff'); }}
          onDeleteStaff={onDeleteStaff}
          onAddPayment={() => { setEditingPayment(null); setModal('payment'); }}
          onEditPayment={(p) => { setEditingPayment(p); setModal('payment'); }}
          onDeletePayment={onDeleteExpense}
        />
      )}

      {view === 'fuel' && (
        <FuelTab
          fuel={fuel}
          labelFor={labelFor}
          onAdd={() => { setEditingFuel(null); setModal('fuel'); }}
          onEdit={(f) => { setEditingFuel(f); setModal('fuel'); }}
          onDelete={onDeleteExpense}
        />
      )}

      {view === 'bsf' && (
        <BsfTab
          batches={data.bsf?.batches || []}
          onAdd={() => { setEditingBsfBatch(null); setModal('bsf'); }}
          onEdit={(b) => { setEditingBsfBatch(b); setModal('bsf'); }}
          onDelete={onDeleteBsfBatch}
        />
      )}

      {view === 'export' && <ExportCenterTab data={data} onNewInvoice={onNewInvoice} onDeleteInvoice={onDeleteInvoice} />}

      {(modal === 'expense' || (typeof modal === 'string' && modal.startsWith('expense:'))) && (
        <ExpenseForm
          entry={modal.startsWith('expense:') ? running.concat(capital).find((r) => r.id === modal.split(':')[1]) : null}
          fields={fields}
          flocks={flocks}
          onClose={() => setModal(null)}
          onSave={(e) => {
            if (modal.startsWith('expense:')) onUpdateExpense(e.id, e);
            else onAddExpense(e);
            setModal(null);
          }}
        />
      )}

      {modal === 'staff' && (
        <StaffForm
          entry={editingStaff}
          onClose={() => { setModal(null); setEditingStaff(null); }}
          onSave={(s) => { onSaveStaff(s); setModal(null); setEditingStaff(null); }}
        />
      )}

      {modal === 'payment' && (
        <PaymentForm
          entry={editingPayment}
          staff={staff}
          fields={fields}
          flocks={flocks}
          payments={payments}
          onClose={() => { setModal(null); setEditingPayment(null); }}
          onSave={(e) => {
            if (editingPayment) onUpdateExpense(e.id, e);
            else onAddExpense(e);
            setModal(null);
            setEditingPayment(null);
          }}
        />
      )}

      {modal === 'fuel' && (
        <FuelForm
          entry={editingFuel}
          fields={fields}
          flocks={flocks}
          onClose={() => { setModal(null); setEditingFuel(null); }}
          onSave={(e) => {
            if (editingFuel) onUpdateExpense(e.id, e);
            else onAddExpense(e);
            setModal(null);
            setEditingFuel(null);
          }}
        />
      )}
      {modal === 'bsf' && (
        <BsfBatchForm
          entry={editingBsfBatch}
          onClose={() => { setModal(null); setEditingBsfBatch(null); }}
          onSave={(e) => {
            if (editingBsfBatch) onUpdateBsfBatch(e.id, e);
            else onAddBsfBatch(e);
            setModal(null);
            setEditingBsfBatch(null);
          }}
        />
      )}
    </>
  );
}

function ExpenseForm({ entry, fields, flocks, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const [f, setF] = useState({
    date: entry?.date || todayISO(),
    kind: entry?.capital ? 'capital' : 'running',
    category: (!entry?.capital && entry?.category) || 'Labour',
    capexCategory: (entry?.capital && entry?.category) || 'Insect net house',
    description: entry?.description || '',
    amount: entry?.amount ?? '',
    scope: entry?.scope || 'general',
    target: entry?.target || 'shared',
    usefulLifeYears: entry?.usefulLifeYears ?? 4,
    notes: entry?.notes || '',
  });
  const isCapital = f.kind === 'capital';

  function set(k) {
    return (e) => {
      const v = e.target.value;
      // Picking a capital category pulls in its typical working life.
      if (k === 'capexCategory') {
        setF({ ...f, capexCategory: v, usefulLifeYears: CAPEX_DEFAULT_LIFE[v] ?? 5 });
        return;
      }
      // Changing enterprise resets the target, since the options differ.
      if (k === 'scope') {
        setF({ ...f, scope: v, target: 'shared' });
        return;
      }
      setF({ ...f, [k]: v });
    };
  }

  const targetOptions = f.scope === 'pepper'
    ? [...fields.map((fl) => [fl.id, fl.name]), ['shared', 'Both fields / shared']]
    : f.scope === 'poultry'
      ? [...flocks.map((fl) => [fl.id, fl.flockName]), ['shared', 'All flocks / shared']]
      : f.scope === 'goats'
        ? [['shared', 'Whole herd']]
        : [['shared', 'Whole farm']];

  const amount = Number(f.amount) || 0;
  const life = Number(f.usefulLifeYears) || 1;
  const perYear = isCapital && amount ? amount / life : null;

  function submit() {
    if (!f.date || f.amount === '') return;
    onSave({
      id: entry?.id || newId(), date: f.date,
      capital: isCapital,
      category: isCapital ? f.capexCategory : f.category,
      description: f.description || null,
      amount, scope: f.scope, target: f.target,
      usefulLifeYears: isCapital ? life : null,
      notes: f.notes || null,
    });
  }

  return (
    <Modal
      title={isEdit ? 'Edit entry' : (isCapital ? 'Add structure or equipment' : 'Add farm expense')}
      sub={isCapital
        ? 'Something that lasts several seasons — a net house, coop, or borehole.'
        : "Running costs the poultry, pepper, and goat logs don't already capture."}
      onClose={onClose}
    >
      <div className="kind-toggle">
        <button
          className={!isCapital ? 'active' : ''}
          onClick={() => setF({ ...f, kind: 'running' })}
        >Running cost</button>
        <button
          className={isCapital ? 'active' : ''}
          onClick={() => setF({ ...f, kind: 'capital' })}
        >Structure / equipment</button>
      </div>

      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>

        {isCapital ? (
          <Field label="What is it?">
            <select value={f.capexCategory} onChange={set('capexCategory')}>
              {CAPEX_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Category">
            <select value={f.category} onChange={set('category')}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        )}

        <Field label="Enterprise">
          <select value={f.scope} onChange={set('scope')}>
            <option value="general">Whole farm</option>
            <option value="poultry">Poultry</option>
            <option value="pepper">Bell pepper</option>
            <option value="goats">Goats</option>
          </select>
        </Field>

        <Field label={f.scope === 'pepper' ? 'Which field?' : f.scope === 'poultry' ? 'Which flock / house?' : 'Applies to'}>
          <select value={f.target} onChange={set('target')}>
            {targetOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>

        <Field label="Description" span2>
          <input value={f.description} onChange={set('description')}
            placeholder={isCapital ? 'e.g. 50-mesh net house, 25m x 20m' : 'e.g. casual labour, 3 days'} />
        </Field>

        <Field label="Amount (GH₵)"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} /></Field>

        {isCapital && (
          <Field label="Useful life (years)">
            <input type="number" step="1" min="1" value={f.usefulLifeYears} onChange={set('usefulLifeYears')} />
          </Field>
        )}

        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>

      {isCapital && perYear != null && (
        <p className="stat-foot" style={{ marginTop: 4 }}>
          Spread over {life} year(s), this charges about <strong>GH₵ {num(perYear, 2)} per year</strong> to
          {f.scope === 'pepper' ? ' this field' : f.scope === 'poultry' ? ' this flock' : ' the farm'} instead of
          the full GH₵ {num(amount, 2)} landing on one season.
        </p>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>{isEdit ? 'Save changes' : (isCapital ? 'Save structure' : 'Save expense')}</button>
      </div>
    </Modal>
  );
}

/* ---------------- Assets & structures table ---------------- */

function AssetsTable({ capital, labelFor, onDelete }) {
  if (!capital.length) {
    return (
      <p className="empty" style={{ padding: '18px 0' }}>
        No structures logged yet — add your net house, coops, drip system or borehole so their cost
        is spread across the seasons they actually serve.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Built</th><th>Structure</th><th>Description</th><th>Assigned to</th>
            <th>Cost</th><th>Life</th><th>Per year</th><th>Written off</th><th>Book value</th><th></th>
          </tr>
        </thead>
        <tbody>
          {capital.map((r) => (
            <tr key={r.id}>
              <td className="mono">{fmtDate(r.date)}</td>
              <td>{r.category}</td>
              <td>{r.description || '—'}</td>
              <td>{labelFor(r)}</td>
              <td className="mono">GH₵ {num(r.amount, 2)}</td>
              <td className="mono">{r.usefulLifeYears}y</td>
              <td className="mono">GH₵ {num(annualCharge(r), 2)}</td>
              <td className="mono">GH₵ {num(chargedToDate(r), 2)}</td>
              <td className="mono"><span className="tag green">GH₵ {num(bookValue(r), 2)}</span></td>
              <td><button className="link-btn rust" onClick={() => onDelete(r.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================= */
/* =================== FARM TEAM & PAYROLL ====================== */
/* ============================================================= */

function StaffPayrollTab({ staff, payments, labelFor, onAddStaff, onEditStaff, onDeleteStaff, onAddPayment, onEditPayment, onDeletePayment }) {
  const { askConfirm } = useToastConfirm();
  const active = staff.filter((s) => s.status !== 'inactive');
  const inactive = staff.filter((s) => s.status === 'inactive');

  // Who's due or overdue for their next expected payment.
  const dueSoon = active
    .map((s) => {
      const due = nextPaymentDue(s, payments);
      const daysLeft = due ? daysBetween(todayISO(), due) : null;
      return { staff: s, due, daysLeft };
    })
    .filter((x) => x.daysLeft !== null && x.daysLeft <= 2)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const withBalance = active
    .map((s) => ({ staff: s, balance: staffBalanceOwed(payments, s.id) }))
    .filter((x) => x.balance > 0);

  const totalPaidToDate = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const sortedPayments = [...payments].sort((a, b) => new Date(b.date) - new Date(a.date));
  const nameFor = (id) => (staff.find((s) => s.id === id) || {}).name || 'Former staff';

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Farm Team</h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={onAddStaff}>+ Add staff</button>
          <button className="btn btn-gold" onClick={onAddPayment} disabled={!active.length}>+ Log payment</button>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard title="Active Staff" value={num(active.length)} tone="gold" foot={`${staff.length} total on record`} />
        <StatCard title="Paid to Date" value={`GH₵ ${num(totalPaidToDate, 2)}`} tone="rust" foot="all wages & advances" />
        <StatCard
          title="Payments Due"
          value={dueSoon.length ? String(dueSoon.length) : 'None'}
          tone={dueSoon.some((x) => x.daysLeft < 0) ? 'rust' : dueSoon.length ? 'gold' : 'green'}
          foot={dueSoon.length ? 'within 2 days or overdue' : 'nothing due soon'}
        />
        <StatCard
          title="Advances Outstanding"
          value={withBalance.length ? `GH₵ ${num(withBalance.reduce((s, x) => s + x.balance, 0), 2)}` : '—'}
          tone={withBalance.length ? 'gold' : 'green'}
          foot={withBalance.length ? `owed by ${withBalance.length} staff` : 'all settled'}
        />
      </div>

      {dueSoon.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {dueSoon.map(({ staff: s, due, daysLeft }) => (
            <div className="stale-banner" key={s.id} style={{ marginBottom: 8 }}>
              ⚠ <span>
                <strong>{s.name}</strong> ({s.payType.toLowerCase()}) —{' '}
                {daysLeft < 0 ? `payment overdue by ${Math.abs(daysLeft)}d` : daysLeft === 0 ? 'payment due today' : `payment due in ${daysLeft}d`}
                {' '}(expected {fmtDate(due)}).
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="section-title">Staff</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Role</th><th>Pay</th><th>Phone</th><th>Started</th><th>Balance owed</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {[...active, ...inactive].map((s) => {
              const balance = staffBalanceOwed(payments, s.id);
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.role || '—'}</td>
                  <td className="mono">{s.payType} · GH₵ {num(s.rate, 2)}</td>
                  <td>{s.phone || '—'}</td>
                  <td className="mono">{s.startDate ? fmtDate(s.startDate) : '—'}</td>
                  <td className="mono">{balance > 0 ? <span className="tag gold">GH₵ {num(balance, 2)}</span> : '—'}</td>
                  <td>{s.status === 'inactive' ? <span className="tag">Inactive</span> : <span className="tag green">Active</span>}</td>
                  <td>
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button className="link-btn" onClick={() => onEditStaff(s)}>Edit</button>
                      {payments.some((p) => p.staffId === s.id) ? (
                        <span className="stat-foot" style={{ margin: 0 }} title="Has payment history — mark Inactive instead">has history</span>
                      ) : (
                        <button className="link-btn rust" onClick={async () => { if (await askConfirm(`Remove ${s.name} from the team?`)) onDeleteStaff(s.id); }}>Delete</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {staff.length === 0 && <tr><td colSpan={8} className="empty">No farm help on record yet — add your first team member to start tracking payments.</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="section-title">Payments</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Staff</th><th>Type</th><th>Amount</th><th>Method</th><th>Assigned to</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {sortedPayments.map((p) => (
              <tr key={p.id}>
                <td className="mono">{fmtDate(p.date)}</td>
                <td>{nameFor(p.staffId)}</td>
                <td>
                  <span className={`tag ${p.paymentKind === 'Advance' ? 'gold' : p.paymentKind === 'Wage' ? 'green' : ''}`}>
                    {p.paymentKind}
                  </span>
                </td>
                <td className="mono">
                  {p.paymentKind === 'Repaid in cash' ? '−' : ''}GH₵ {num(paymentRawAmount(p), 2)}
                </td>
                <td>{p.method || '—'}</td>
                <td>{labelFor(p)}</td>
                <td className="notes">{p.notes || ''}</td>
                <td>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button className="link-btn" onClick={() => onEditPayment(p)}>Edit</button>
                    <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this payment record?')) onDeletePayment(p.id); }}>Delete</button>
                  </span>
                </td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={8} className="empty">No payments logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="stat-foot">
        Advances count as cost the day they're paid out — real cash left the farm. "Worked off" clears
        the balance without adding new cost, since no fresh cash moved. "Repaid in cash" refunds the
        cost when the money actually comes back.
      </p>
    </>
  );
}

function StaffForm({ entry, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const [f, setF] = useState({
    name: entry?.name || '', role: entry?.role || '', phone: entry?.phone || '',
    payType: entry?.payType || 'Weekly', rate: entry?.rate ?? '',
    startDate: entry?.startDate || todayISO(), status: entry?.status || 'active', notes: entry?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.name) return;
    onSave({
      id: entry?.id || newId(), name: f.name, role: f.role || null, phone: f.phone || null,
      payType: f.payType, rate: f.rate === '' ? null : Number(f.rate),
      startDate: f.startDate || null, status: f.status, notes: f.notes || null,
    });
  }
  return (
    <Modal title={isEdit ? `Edit ${entry.name}` : 'Add staff'} sub="Farm help — a family member, casual worker, or hired hand." onClose={onClose}>
      <div className="form-grid">
        <Field label="Name" span2><input value={f.name} onChange={set('name')} placeholder="e.g. Comfort" /></Field>
        <Field label="Role"><input value={f.role} onChange={set('role')} placeholder="e.g. General farm hand" /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Pay type">
          <select value={f.payType} onChange={set('payType')}>
            {PAY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Rate (GH₵)"><input type="number" step="0.01" value={f.rate} onChange={set('rate')} placeholder="usual amount per period" /></Field>
        <Field label="Start date"><input type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        {isEdit && (
          <Field label="Status">
            <select value={f.status} onChange={set('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        )}
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>{isEdit ? 'Save changes' : 'Add staff'}</button>
      </div>
    </Modal>
  );
}

function PaymentForm({ entry, staff, fields, flocks, payments, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const activeStaff = staff.filter((s) => s.status !== 'inactive' || (entry && entry.staffId === s.id));
  const [f, setF] = useState({
    staffId: entry?.staffId || (activeStaff[0] && activeStaff[0].id) || '',
    date: entry?.date || todayISO(),
    kind: entry?.paymentKind || 'Wage',
    amount: entry ? (paymentRawAmount(entry) || '') : '',
    method: entry?.method || 'Cash',
    scope: entry?.scope || 'general',
    target: entry?.target || 'shared',
    notes: entry?.notes || '',
  });

  function set(k) {
    return (e) => {
      const v = e.target.value;
      if (k === 'scope') { setF({ ...f, scope: v, target: 'shared' }); return; }
      if (k === 'staffId') {
        // Suggest the person's usual rate when switching to them, for Wage payments.
        const person = staff.find((s) => s.id === v);
        const suggest = f.kind === 'Wage' && person && person.rate != null && f.amount === '';
        setF({ ...f, staffId: v, amount: suggest ? String(person.rate) : f.amount });
        return;
      }
      setF({ ...f, [k]: v });
    };
  }

  const selectedStaff = staff.find((s) => s.id === f.staffId);
  const currentBalance = selectedStaff ? staffBalanceOwed(payments.filter((p) => p.id !== entry?.id), selectedStaff.id) : 0;

  const targetOptions = f.scope === 'pepper'
    ? [...fields.map((fl) => [fl.id, fl.name]), ['shared', 'Both fields / shared']]
    : f.scope === 'poultry'
      ? [...flocks.map((fl) => [fl.id, fl.flockName]), ['shared', 'All flocks / shared']]
      : f.scope === 'goats'
        ? [['shared', 'Whole herd']]
        : [['shared', 'Whole farm']];

  function submit() {
    if (!f.staffId || !f.date || f.amount === '') return;
    const person = staff.find((s) => s.id === f.staffId);
    const amount = Number(f.amount) || 0;
    onSave({
      id: entry?.id || newId(),
      date: f.date,
      capital: false,
      category: 'Labour',
      staffId: f.staffId,
      paymentKind: f.kind,
      description: `${f.kind} — ${person ? person.name : ''}`,
      amount: paymentCostImpact(f.kind, amount),
      balanceAmount: paymentBalanceImpact(f.kind, amount),
      method: f.method,
      scope: f.scope,
      target: f.target,
      notes: f.notes || null,
    });
  }

  return (
    <Modal
      title={isEdit ? 'Edit payment' : 'Log payment'}
      sub={
        f.kind === 'Advance' ? "Cash given ahead of work — counts as cost now, and adds to their balance owed."
        : f.kind === 'Worked off' ? 'Clears balance owed through work done — no new cash cost.'
        : f.kind === 'Repaid in cash' ? 'They paid cash back — reduces cost and their balance owed.'
        : 'Normal payment for work completed.'
      }
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Staff member" span2>
          <select value={f.staffId} onChange={set('staffId')}>
            {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Type">
          <select value={f.kind} onChange={set('kind')}>
            {PAYMENT_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Amount (GH₵)"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Method">
          <select value={f.method} onChange={set('method')}>
            {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Enterprise">
          <select value={f.scope} onChange={set('scope')}>
            <option value="general">Whole farm</option>
            <option value="poultry">Poultry</option>
            <option value="pepper">Bell pepper</option>
            <option value="goats">Goats</option>
          </select>
        </Field>
        <Field label={f.scope === 'pepper' ? 'Which field?' : f.scope === 'poultry' ? 'Which flock?' : 'Applies to'}>
          <select value={f.target} onChange={set('target')}>
            {targetOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {selectedStaff && currentBalance > 0 && (
        <p className="stat-foot" style={{ marginTop: 4 }}>
          {selectedStaff.name} currently owes the farm <strong>GH₵ {num(currentBalance, 2)}</strong> from a past advance.
        </p>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>{isEdit ? 'Save changes' : 'Save payment'}</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ========================= FUEL TRACKER ======================= */
/* ============================================================= */

function FuelTab({ fuel, labelFor, onAdd, onEdit, onDelete }) {
  const { askConfirm } = useToastConfirm();
  const sorted = [...fuel].sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalSpent = fuel.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalLiters = fuel.reduce((s, r) => s + (Number(r.liters) || 0), 0);
  const avgPrice = totalLiters ? totalSpent / totalLiters : null;

  const byEquipment = {};
  fuel.forEach((r) => {
    const key = r.equipment || 'Unspecified';
    byEquipment[key] = (byEquipment[key] || 0) + (Number(r.amount) || 0);
  });
  const topEquipment = Object.entries(byEquipment).sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Fuel</h3>
        <button className="btn btn-gold" onClick={onAdd}>+ Log purchase</button>
      </div>

      <div className="grid grid-4">
        <StatCard title="Total Spent" value={`GH₵ ${num(totalSpent, 2)}`} tone="rust" foot={`${fuel.length} purchase(s)`} />
        <StatCard title="Total Liters" value={`${num(totalLiters, 1)} L`} tone="gold" />
        <StatCard title="Avg Price / Liter" value={avgPrice != null ? `GH₵ ${num(avgPrice, 2)}` : '—'} foot="across all purchases" />
        <StatCard title="Last Purchase" value={sorted.length ? fmtDate(sorted[0].date) : '—'} tone="green" foot={sorted.length ? (sorted[0].equipment || '—') : ''} />
      </div>

      {topEquipment.length > 0 && (
        <>
          <p className="section-title">Spend by equipment</p>
          <div className="grid grid-4" style={{ marginBottom: 6 }}>
            {topEquipment.map(([eq, amt]) => (
              <StatCard key={eq} title={eq} value={`GH₵ ${num(amt, 2)}`} foot="spent to date" />
            ))}
          </div>
        </>
      )}

      <p className="section-title">Purchases</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Equipment</th><th>Liters</th><th>Price/L</th><th>Cost</th><th>Assigned to</th><th>Supplier</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtDate(r.date)}</td>
                <td>{r.fuelType || '—'}</td>
                <td>{r.equipment || '—'}</td>
                <td className="mono">{r.liters != null ? num(r.liters, 1) : '—'}</td>
                <td className="mono">{r.pricePerLiter != null ? num(r.pricePerLiter, 2) : '—'}</td>
                <td className="mono">GH₵ {num(r.amount, 2)}</td>
                <td>{labelFor(r)}</td>
                <td>{r.supplier || '—'}</td>
                <td className="notes">{r.notes || ''}</td>
                <td>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button className="link-btn" onClick={() => onEdit(r)}>Edit</button>
                    <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this fuel record?')) onDelete(r.id); }}>Delete</button>
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={10} className="empty">No fuel purchases logged yet — track what the generator, pump, or vehicle actually costs to run.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="stat-foot">
        Fuel counts as a running cost the same as labour or feed — assigning a purchase to a field or
        flock (rather than "Whole farm") means it shows up in that field's or flock's own margin too.
      </p>
    </>
  );
}

function FuelForm({ entry, fields, flocks, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const [f, setF] = useState({
    date: entry?.date || todayISO(),
    fuelType: entry?.fuelType || FUEL_TYPES[1], // Diesel default — most common for generators/tillers
    equipment: entry?.equipment || FUEL_EQUIPMENT[0],
    liters: entry?.liters ?? '',
    pricePerLiter: entry?.pricePerLiter ?? '',
    amount: entry?.amount ?? '',
    supplier: entry?.supplier || '',
    scope: entry?.scope || 'general',
    target: entry?.target || 'shared',
    notes: entry?.notes || '',
  });

  function set(k) {
    return (e) => {
      const v = e.target.value;
      if (k === 'scope') { setF({ ...f, scope: v, target: 'shared' }); return; }
      setF({ ...f, [k]: v });
    };
  }

  const autoAmount = (Number(f.liters) || 0) * (Number(f.pricePerLiter) || 0);
  const amount = f.amount !== '' ? Number(f.amount) : autoAmount;

  const targetOptions = f.scope === 'pepper'
    ? [...fields.map((fl) => [fl.id, fl.name]), ['shared', 'Both fields / shared']]
    : f.scope === 'poultry'
      ? [...flocks.map((fl) => [fl.id, fl.flockName]), ['shared', 'All flocks / shared']]
      : f.scope === 'goats'
        ? [['shared', 'Whole herd']]
        : [['shared', 'Whole farm']];

  function submit() {
    if (!f.date || (f.liters === '' && f.amount === '')) return;
    onSave({
      id: entry?.id || newId(), date: f.date, capital: false, category: 'Fuel',
      fuelType: f.fuelType, equipment: f.equipment,
      liters: f.liters === '' ? null : Number(f.liters),
      pricePerLiter: f.pricePerLiter === '' ? null : Number(f.pricePerLiter),
      description: `${f.fuelType} — ${f.equipment}`,
      amount, supplier: f.supplier || null,
      scope: f.scope, target: f.target,
      notes: f.notes || null,
    });
  }

  return (
    <Modal
      title={isEdit ? 'Edit fuel purchase' : 'Log fuel purchase'}
      sub={autoAmount ? `Cost: GH₵ ${num(autoAmount, 2)}.` : 'Enter liters × price, or type the total directly.'}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Fuel type">
          <select value={f.fuelType} onChange={set('fuelType')}>
            {FUEL_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Equipment / purpose">
          <select value={f.equipment} onChange={set('equipment')}>
            {FUEL_EQUIPMENT.map((eq) => <option key={eq}>{eq}</option>)}
          </select>
        </Field>
        <Field label="Liters"><input type="number" step="0.1" value={f.liters} onChange={set('liters')} /></Field>
        <Field label="Price per liter (GH₵)"><input type="number" step="0.01" value={f.pricePerLiter} onChange={set('pricePerLiter')} /></Field>
        <Field label="Total cost (GH₵)"><input type="number" step="0.01" value={f.amount} onChange={set('amount')} placeholder={autoAmount ? `auto ${num(autoAmount, 2)}` : 'or type total'} /></Field>
        <Field label="Supplier"><input value={f.supplier} onChange={set('supplier')} /></Field>
        <Field label="Enterprise">
          <select value={f.scope} onChange={set('scope')}>
            <option value="general">Whole farm</option>
            <option value="poultry">Poultry</option>
            <option value="pepper">Bell pepper</option>
            <option value="goats">Goats</option>
          </select>
        </Field>
        <Field label={f.scope === 'pepper' ? 'Which field?' : f.scope === 'poultry' ? 'Which flock?' : 'Applies to'}>
          <select value={f.target} onChange={set('target')}>
            {targetOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={submit}>{isEdit ? 'Save changes' : 'Save purchase'}</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ================== BLACK SOLDIER FLY LARVAE =================== */
/* ============================================================= */

function bsfStatusTag(batch) {
  const s = bsfBatchStatus(batch);
  if (s.complete) return <span className="tag green">Harvested</span>;
  if (s.nearingHarvest) return <span className="tag gold">Nearing harvest</span>;
  return <span className="tag">Growing</span>;
}

function BsfTab({ batches, onAdd, onEdit, onDelete }) {
  const { askConfirm } = useToastConfirm();
  const active = batches.filter((b) => !b.harvestDate);
  const harvested = [...batches.filter((b) => b.harvestDate)].sort((a, b) => new Date(b.harvestDate) - new Date(a.harvestDate));
  const totalLarvaeKg = harvested.reduce((s, b) => s + (Number(b.larvaeHarvestedKg) || 0), 0);
  const totalDriedKg = harvested.reduce((s, b) => s + (Number(b.driedKg) || 0), 0);
  const totalSubstrateKg = batches.reduce((s, b) => s + (Number(b.substrateKg) || 0), 0);

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <h3 style={{ fontSize: 18 }}>Black Soldier Fly Larvae</h3>
        <button className="btn btn-green" onClick={onAdd}>+ Start batch</button>
      </div>
      <p className="stat-foot" style={{ marginTop: 0, marginBottom: 18 }}>
        Turning manure and farm waste into protein-rich larvae for poultry feed. A batch is usually
        harvest-ready within about 3–6 weeks of starting, though heat and substrate change the pace.
      </p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard title="Larvae Harvested" value={`${num(totalLarvaeKg, 1)} kg`} tone="green" foot="lifetime, fresh weight" />
        <StatCard title="Dried & Stored" value={`${num(totalDriedKg, 1)} kg`} tone="gold" />
        <StatCard title="Substrate Used" value={`${num(totalSubstrateKg, 1)} kg`} foot="manure/scraps fed to larvae" />
        <StatCard title="Active Batches" value={num(active.length)} tone={active.length ? 'gold' : undefined} />
      </div>

      {active.length > 0 && (
        <div className="field-card-grid" style={{ marginBottom: 20 }}>
          {active.map((b) => {
            const s = bsfBatchStatus(b);
            return (
              <div className="panel" key={b.id} style={{ marginBottom: 0 }}>
                <div className="panel-head">
                  <h3>{b.batchLabel || `Started ${fmtDate(b.startDate)}`}</h3>
                  {bsfStatusTag(b)}
                </div>
                <div style={{ padding: '4px 0 10px' }}>
                  <div className="kv"><span className="k">Started</span><span className="v">{fmtDate(b.startDate)} ({s.daysRunning}d ago)</span></div>
                  <div className="kv"><span className="k">Substrate</span><span className="v">{b.substrateType}{b.substrateKg ? ` — ${num(b.substrateKg, 1)} kg` : ''}</span></div>
                  {b.notes && <div className="kv"><span className="k">Notes</span><span className="v" style={{ textAlign: 'right' }}>{b.notes}</span></div>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => onEdit(b)}>Edit / log harvest</button>
                  <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this batch?')) onDelete(b.id); }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {harvested.length > 0 && (
        <>
          <p className="section-title">Harvest history</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Batch</th><th>Substrate</th><th>Started</th><th>Harvested</th><th>Larvae (kg)</th><th>Dried (kg)</th><th>Used for</th><th></th></tr></thead>
              <tbody>
                {harvested.map((b) => (
                  <tr key={b.id}>
                    <td>{b.batchLabel || '—'}</td>
                    <td>{b.substrateType}</td>
                    <td className="mono">{fmtDate(b.startDate)}</td>
                    <td className="mono">{fmtDate(b.harvestDate)}</td>
                    <td className="mono">{num(b.larvaeHarvestedKg, 1)}</td>
                    <td className="mono">{b.driedKg ? num(b.driedKg, 1) : '—'}</td>
                    <td>{b.usedFor || '—'}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button className="link-btn" onClick={() => onEdit(b)}>Edit</button>
                        <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this batch?')) onDelete(b.id); }}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {active.length === 0 && harvested.length === 0 && (
        <p className="empty" style={{ padding: '18px 0' }}>
          No batches yet — start one when you set up a bin. Wild BSF already visiting the farm will find it
          on their own; no need to buy starter larvae.
        </p>
      )}
    </>
  );
}

function BsfBatchForm({ entry, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const [f, setF] = useState({
    batchLabel: entry?.batchLabel || '', startDate: entry?.startDate || todayISO(),
    substrateType: entry?.substrateType || BSF_SUBSTRATES[0], substrateKg: entry?.substrateKg ?? '',
    harvestDate: entry?.harvestDate || '', larvaeHarvestedKg: entry?.larvaeHarvestedKg ?? '',
    driedKg: entry?.driedKg ?? '', usedFor: entry?.usedFor || BSF_USES[0],
    notes: entry?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.startDate) return;
    onSave({
      id: entry?.id || newId(),
      batchLabel: f.batchLabel || null, startDate: f.startDate,
      substrateType: f.substrateType, substrateKg: f.substrateKg === '' ? null : Number(f.substrateKg),
      harvestDate: f.harvestDate || null,
      larvaeHarvestedKg: f.larvaeHarvestedKg === '' ? null : Number(f.larvaeHarvestedKg),
      driedKg: f.driedKg === '' ? null : Number(f.driedKg),
      usedFor: f.harvestDate ? f.usedFor : null,
      notes: f.notes || null,
    });
  }
  return (
    <Modal
      title={isEdit ? 'Edit BSF batch' : 'Start new BSF batch'}
      sub="Log the harvest once larvae are ready — leave harvest fields blank while it's still growing."
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Batch label"><input value={f.batchLabel} onChange={set('batchLabel')} placeholder="e.g. Bin 1 — Sept batch" /></Field>
        <Field label="Start date"><input type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="Substrate">
          <select value={f.substrateType} onChange={set('substrateType')}>
            {BSF_SUBSTRATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Substrate fed (kg)"><input type="number" step="0.1" value={f.substrateKg} onChange={set('substrateKg')} /></Field>
        <Field label="Harvest date"><input type="date" value={f.harvestDate} onChange={set('harvestDate')} /></Field>
        <Field label="Larvae harvested (kg, fresh)"><input type="number" step="0.1" value={f.larvaeHarvestedKg} onChange={set('larvaeHarvestedKg')} /></Field>
        <Field label="Dried weight (kg)"><input type="number" step="0.1" value={f.driedKg} onChange={set('driedKg')} placeholder="if dried for storage" /></Field>
        {f.harvestDate && (
          <Field label="Used for">
            <select value={f.usedFor} onChange={set('usedFor')}>
              {BSF_USES.map((u) => <option key={u}>{u}</option>)}
            </select>
          </Field>
        )}
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>{isEdit ? 'Save changes' : 'Start batch'}</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ==================== SOIL & BATCHES (PEPPER) ================= */
/* ============================================================= */

function verdictTag(overall) {
  if (overall === 'Safe') return <span className="tag green">Safe to transplant</span>;
  if (overall === 'Caution') return <span className="tag gold">Caution</span>;
  if (overall === 'Not safe') return <span className="tag rust">Not safe yet</span>;
  return <span className="tag">No data</span>;
}

function bandTag(status) {
  if (status === 'ok') return <span className="tag green">OK</span>;
  if (status === 'below') return <span className="tag gold">Low</span>;
  if (status === 'above') return <span className="tag rust">High</span>;
  return <span className="tag">—</span>;
}

function SoilBatchesTab({
  view, setView, scope, fields, fieldsScoped, manureReadings, soilReadings, batches,
  harvests, scouting, sprays, onAddManure, onDeleteManure, onAddSoil, onDeleteSoil, onDeleteBatch,
}) {
  const { askConfirm } = useToastConfirm();
  const manureAvg = averageReading(manureReadings);
  const sortedManure = [...manureReadings].sort((a, b) => new Date(b.date) - new Date(a.date));
  const sortedSoil = [...soilReadings]
    .filter((r) => scope === 'all' || r.fieldId === scope)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const readinessCards = fieldsScoped.map((f) => {
    const round = latestFieldRound(soilReadings, f.id);
    const verdict = readinessVerdict(round.avg, f);
    const daysSinceMix = f.manureAppliedDate ? daysBetween(f.manureAppliedDate, todayISO()) : null;
    return { field: f, round, verdict, daysSinceMix };
  });

  return (
    <>
      <div className="field-seg" style={{ marginBottom: 20 }}>
        <button className={view === 'soil' ? 'active' : ''} onClick={() => setView('soil')}>Soil Monitoring</button>
        <button className={view === 'batches' ? 'active' : ''} onClick={() => setView('batches')}>Batch Performance</button>
      </div>

      {view === 'soil' && (<>
        <p className="section-title" style={{ marginTop: 0 }}>Transplant readiness</p>
        <div className="grid grid-2">
          {readinessCards.map(({ field, round, verdict, daysSinceMix }) => (
            <div className="panel" key={field.id}>
              <div className="panel-head">
                <h3>{field.name}</h3>
                {verdictTag(verdict.overall)}
              </div>
              <p className="stat-foot" style={{ marginTop: 0 }}>
                {field.manureAppliedDate
                  ? `Manure applied ${fmtDate(field.manureAppliedDate)} (${daysSinceMix}d ago)`
                  : 'No manure-applied date set — add one in Crop Cycle → Edit.'}
                {round.date && ` · last tested ${fmtDate(round.date)}`}
              </p>
              {round.avg ? (
                <div style={{ padding: '4px 0 6px' }}>
                  <div className="kv"><span className="k">EC</span><span className="v">{num(round.avg.ec)} µs/cm ({field.targetECMin}–{field.targetECMax}) {bandTag(verdict.ec)}</span></div>
                  <div className="kv"><span className="k">pH</span><span className="v">{num(round.avg.ph, 1)} ({field.targetPHMin}–{field.targetPHMax}) {bandTag(verdict.ph)}</span></div>
                  <div className="kv"><span className="k">Nitrogen</span><span className="v">{num(round.avg.n)} mg/kg ({field.targetNMin}–{field.targetNMax}) {bandTag(verdict.n)}</span></div>
                  <div className="kv"><span className="k">Phosphorus</span><span className="v">{num(round.avg.p)} mg/kg ({field.targetPMin}–{field.targetPMax}) {bandTag(verdict.p)}</span></div>
                  <div className="kv"><span className="k">Potassium</span><span className="v">{num(round.avg.k)} mg/kg ({field.targetKMin}–{field.targetKMax}) {bandTag(verdict.k)}</span></div>
                </div>
              ) : (
                <p className="empty" style={{ padding: '10px 0' }}>No soil tests logged for this field yet.</p>
              )}
            </div>
          ))}
        </div>
        <p className="stat-foot">
          The Safe/Caution/Not safe verdict follows EC and pH — the actual gate for transplanting.
          Nitrogen, Phosphorus and Potassium are shown for information against this field's own targets
          (set in Crop Cycle → Edit → Soil targets).
        </p>

        <div className="panel-head" style={{ margin: '22px 0 14px' }}>
          <h3 style={{ fontSize: 18 }}>Manure pile readings</h3>
          <button className="btn btn-green" onClick={onAddManure}>+ Add sample</button>
        </div>
        {manureAvg && (
          <div className="grid grid-4" style={{ marginBottom: 14 }}>
            <StatCard title="Avg EC" value={`${num(manureAvg.ec)} µs/cm`} foot="raw manure, before mixing" />
            <StatCard title="Avg pH" value={num(manureAvg.ph, 1)} foot={`${manureReadings.length} sample(s)`} />
            <StatCard title="Avg N-P-K" value={`${num(manureAvg.n)}-${num(manureAvg.p)}-${num(manureAvg.k)}`} foot="mg/kg" />
            <StatCard title="Fertility" value={num(fertility(manureAvg))} foot="N+P+K, mg/kg" />
          </div>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Date</th><th>Location</th><th>Moisture %</th><th>EC</th><th>pH</th><th>N</th><th>P</th><th>K</th><th>Fertility</th><th></th></tr>
            </thead>
            <tbody>
              {sortedManure.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{fmtDate(r.date)}</td>
                  <td>{r.location || '—'}</td>
                  <td className="mono">{r.moisture != null ? num(r.moisture, 1) : '—'}</td>
                  <td className="mono">{r.ec != null ? num(r.ec) : '—'}</td>
                  <td className="mono">{r.ph != null ? num(r.ph, 1) : '—'}</td>
                  <td className="mono">{r.n != null ? num(r.n) : '—'}</td>
                  <td className="mono">{r.p != null ? num(r.p) : '—'}</td>
                  <td className="mono">{r.k != null ? num(r.k) : '—'}</td>
                  <td className="mono">{fertility(r)}</td>
                  <td><button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this sample?')) onDeleteManure(r.id); }}>Delete</button></td>
                </tr>
              ))}
              {sortedManure.length === 0 && <tr><td colSpan={10} className="empty">No manure samples logged yet — test a few spots in the pile before mixing.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="panel-head" style={{ margin: '22px 0 14px' }}>
          <h3 style={{ fontSize: 18 }}>Field soil readings</h3>
          <button className="btn btn-green" onClick={onAddSoil}>+ Add soil test</button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Date</th><th>Field</th><th>Days since mix</th><th>Location</th><th>Moisture %</th><th>EC</th><th>pH</th><th>N</th><th>P</th><th>K</th><th></th></tr>
            </thead>
            <tbody>
              {sortedSoil.map((r) => {
                const field = fields.find((f) => f.id === r.fieldId);
                const days = field && field.manureAppliedDate ? daysBetween(field.manureAppliedDate, r.date) : null;
                return (
                  <tr key={r.id}>
                    <td className="mono">{fmtDate(r.date)}</td>
                    <td>{field ? field.name : r.fieldId}</td>
                    <td className="mono">{days != null ? `Day ${days}` : '—'}</td>
                    <td>{r.location || '—'}</td>
                    <td className="mono">{r.moisture != null ? num(r.moisture, 1) : '—'}</td>
                    <td className="mono">{r.ec != null ? num(r.ec) : '—'}</td>
                    <td className="mono">{r.ph != null ? num(r.ph, 1) : '—'}</td>
                    <td className="mono">{r.n != null ? num(r.n) : '—'}</td>
                    <td className="mono">{r.p != null ? num(r.p) : '—'}</td>
                    <td className="mono">{r.k != null ? num(r.k) : '—'}</td>
                    <td><button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this test?')) onDeleteSoil(r.id); }}>Delete</button></td>
                  </tr>
                );
              })}
              {sortedSoil.length === 0 && <tr><td colSpan={11} className="empty">No soil tests logged yet — test several spots on the same day, then average, same as the manure log.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}

      {view === 'batches' && (
        <BatchPerformanceView
          fields={fieldsScoped} batches={batches} soilReadings={soilReadings}
          harvests={harvests} scouting={scouting} sprays={sprays}
          onDeleteBatch={onDeleteBatch}
        />
      )}
    </>
  );
}

function BatchPerformanceView({ fields, batches, soilReadings, harvests, scouting, sprays, onDeleteBatch }) {
  const { askConfirm } = useToastConfirm();
  // Every batch to show per field: its closed history, plus the current
  // live planting synthesized from the field's own state.
  const entries = [];
  fields.forEach((field) => {
    const closed = batches
      .filter((b) => b.fieldId === field.id)
      .sort((a, b) => new Date(a.transplantDate) - new Date(b.transplantDate));
    closed.forEach((b) => entries.push({ ...b, field, isCurrent: false }));
    if (field.transplantDate) {
      entries.push({
        id: `current-${field.id}`, fieldId: field.id, field,
        batchLabel: field.currentBatchLabel || 'Current planting',
        variety: field.variety, transplantDate: field.transplantDate,
        plantCount: field.plantCount, expectedHarvestDAT: field.expectedHarvestDAT,
        setupCost: field.setupCost, closedDate: null, isCurrent: true,
      });
    }
  });
  entries.sort((a, b) => new Date(b.transplantDate) - new Date(a.transplantDate));

  return (
    <>
      <p className="section-title" style={{ marginTop: 0 }}>Batch performance</p>
      {entries.length === 0 ? (
        <p className="empty" style={{ padding: '18px 0' }}>
          No plantings recorded yet — set a transplant date in Crop Cycle to start your first batch.
        </p>
      ) : entries.map((b) => {
        const windowEnd = b.closedDate || todayISO();
        const inWindow = (r) => r.fieldId === b.fieldId && r.date >= b.transplantDate && r.date <= windowEnd;
        const batchHarvests = harvests.filter(inWindow);
        const batchScouting = scouting.filter(inWindow);
        const batchSprays = sprays.filter(inWindow);
        const kg = batchHarvests.reduce((s, h) => s + (Number(h.weightKg) || 0), 0);
        const revenue = batchHarvests.reduce((s, h) => s + (Number(h.weightKg) || 0) * (Number(h.pricePerKg) || 0), 0);
        const sprayCost = batchSprays.reduce((s, r) => s + (Number(r.cost) || 0), 0);
        const cost = (Number(b.setupCost) || 0) + sprayCost;
        const margin = revenue - cost;
        const highPressureDays = batchScouting.filter((s) => s.severity === 'High').length;
        const soilAtTransplant = nearestSoilRound(soilReadings, b.fieldId, b.transplantDate, 14);
        const daysGrown = b.closedDate ? daysBetween(b.transplantDate, b.closedDate) : daysBetween(b.transplantDate, todayISO());

        return (
          <div className="panel" key={b.id}>
            <div className="panel-head">
              <h3>{b.field.name} — {b.batchLabel}{b.isCurrent && <span className="tag gold" style={{ marginLeft: 8 }}>Ongoing</span>}</h3>
              {!b.isCurrent && <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this batch record? Harvest/scouting history is not affected.')) onDeleteBatch(b.id); }}>Delete</button>}
            </div>
            <p className="stat-foot" style={{ marginTop: 0 }}>
              {b.variety || 'no variety set'} · transplanted {fmtDate(b.transplantDate)} ·{' '}
              {b.closedDate ? `closed ${fmtDate(b.closedDate)}` : 'still growing'} · {daysGrown} days
            </p>

            <div className="grid grid-4">
              <StatCard title="Yield" value={kg ? `${num(kg, 1)} kg` : '—'} tone="gold" foot={`${batchHarvests.length} pick(s)`} />
              <StatCard title="Revenue" value={`GH₵ ${num(revenue, 2)}`} tone="green" />
              <StatCard title="Cost" value={`GH₵ ${num(cost, 2)}`} tone="rust" foot="setup + sprays in this window" />
              <StatCard title="Margin" value={`GH₵ ${num(margin, 2)}`} tone={margin >= 0 ? 'green' : 'rust'} />
            </div>

            <div style={{ padding: '10px 0 4px' }}>
              <div className="kv">
                <span className="k">Soil at transplant</span>
                <span className="v">
                  {soilAtTransplant
                    ? `EC ${num(soilAtTransplant.avg.ec)} · pH ${num(soilAtTransplant.avg.ph, 1)} · N ${num(soilAtTransplant.avg.n)} (tested ${fmtDate(soilAtTransplant.date)})`
                    : 'no soil test within 14 days of transplant'}
                </span>
              </div>
              <div className="kv"><span className="k">Pest pressure</span><span className="v">{batchScouting.length ? `${batchScouting.length} check(s), ${highPressureDays} high` : 'not scouted'}</span></div>
            </div>
          </div>
        );
      })}
      <p className="stat-foot">
        Cost here is this batch's own setup cost plus sprays logged in its date window — it doesn&apos;t
        include the field's shared structures or general expenses, which stay at the field level in
        the Dashboard and Whole Farm views.
      </p>
    </>
  );
}

function ManureReadingForm({ onClose, onSave }) {
  const [f, setF] = useState({ date: todayISO(), location: MANURE_LOCATIONS[0], moisture: '', ec: '', ph: '', n: '', p: '', k: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.date) return;
    onSave({
      id: newId(), date: f.date, location: f.location,
      moisture: f.moisture === '' ? null : Number(f.moisture),
      ec: f.ec === '' ? null : Number(f.ec), ph: f.ph === '' ? null : Number(f.ph),
      n: f.n === '' ? null : Number(f.n), p: f.p === '' ? null : Number(f.p), k: f.k === '' ? null : Number(f.k),
      notes: f.notes || null,
    });
  }
  return (
    <Modal title="Add manure sample" sub="Test a few spots in the pile before mixing into soil." onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Location in pile">
          <select value={f.location} onChange={set('location')}>
            {MANURE_LOCATIONS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Moisture (%)"><input type="number" step="0.1" value={f.moisture} onChange={set('moisture')} /></Field>
        <Field label="EC (µs/cm)"><input type="number" value={f.ec} onChange={set('ec')} /></Field>
        <Field label="pH"><input type="number" step="0.1" value={f.ph} onChange={set('ph')} /></Field>
        <Field label="Nitrogen (mg/kg)"><input type="number" value={f.n} onChange={set('n')} /></Field>
        <Field label="Phosphorus (mg/kg)"><input type="number" value={f.p} onChange={set('p')} /></Field>
        <Field label="Potassium (mg/kg)"><input type="number" value={f.k} onChange={set('k')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Save sample</button>
      </div>
    </Modal>
  );
}

function SoilReadingForm({ fields, defaultField, onClose, onSave }) {
  const [f, setF] = useState({ date: todayISO(), fieldId: defaultField, location: '', moisture: '', ec: '', ph: '', n: '', p: '', k: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.date || !f.fieldId) return;
    onSave({
      id: newId(), date: f.date, fieldId: f.fieldId, location: f.location || null,
      moisture: f.moisture === '' ? null : Number(f.moisture),
      ec: f.ec === '' ? null : Number(f.ec), ph: f.ph === '' ? null : Number(f.ph),
      n: f.n === '' ? null : Number(f.n), p: f.p === '' ? null : Number(f.p), k: f.k === '' ? null : Number(f.k),
      notes: f.notes || null,
    });
  }
  return (
    <Modal title="Add soil test" sub="Test several spots in the field on the same day — the app averages them for you." onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Field">
          <select value={f.fieldId} onChange={set('fieldId')}>
            {fields.map((fl) => <option key={fl.id} value={fl.id}>{fl.name}</option>)}
          </select>
        </Field>
        <Field label="Location in field"><input value={f.location} onChange={set('location')} placeholder="e.g. North corner" /></Field>
        <Field label="Moisture (%)"><input type="number" step="0.1" value={f.moisture} onChange={set('moisture')} /></Field>
        <Field label="EC (µs/cm)"><input type="number" value={f.ec} onChange={set('ec')} /></Field>
        <Field label="pH"><input type="number" step="0.1" value={f.ph} onChange={set('ph')} /></Field>
        <Field label="Nitrogen (mg/kg)"><input type="number" value={f.n} onChange={set('n')} /></Field>
        <Field label="Phosphorus (mg/kg)"><input type="number" value={f.p} onChange={set('p')} /></Field>
        <Field label="Potassium (mg/kg)"><input type="number" value={f.k} onChange={set('k')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Save test</button>
      </div>
    </Modal>
  );
}

function NewBatchForm({ field, onClose, onSave }) {
  const [f, setF] = useState({
    batchLabel: '', variety: '', transplantDate: todayISO(), plantCount: '', spacing: field?.spacing || '',
    expectedHarvestDAT: field?.expectedHarvestDAT ?? 70, setupCost: '', manureAppliedDate: '', notes: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const hadPrior = Boolean(field?.transplantDate);
  function submit() {
    if (!f.transplantDate) return;
    onSave({
      currentBatchLabel: f.batchLabel || 'New batch',
      variety: f.variety || '', transplantDate: f.transplantDate,
      plantCount: f.plantCount === '' ? null : Number(f.plantCount),
      spacing: f.spacing || '',
      expectedHarvestDAT: f.expectedHarvestDAT === '' ? null : Number(f.expectedHarvestDAT),
      setupCost: f.setupCost === '' ? null : Number(f.setupCost),
      manureAppliedDate: f.manureAppliedDate || null,
      notes: f.notes || '',
    });
  }
  return (
    <Modal
      title={`Start new batch — ${field ? field.name : ''}`}
      sub={hadPrior
        ? "This archives the current planting to Batch Performance and starts fresh with these details."
        : 'This becomes the first recorded batch for this field.'}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Batch label" span2><input value={f.batchLabel} onChange={set('batchLabel')} placeholder="e.g. Batch 2 — dry season" /></Field>
        <Field label="Variety"><input value={f.variety} onChange={set('variety')} /></Field>
        <Field label="Transplant date"><input type="date" value={f.transplantDate} onChange={set('transplantDate')} /></Field>
        <Field label="Plants in ground"><input type="number" value={f.plantCount} onChange={set('plantCount')} /></Field>
        <Field label="Spacing"><input value={f.spacing} onChange={set('spacing')} /></Field>
        <Field label="Expected 1st harvest (DAT)"><input type="number" value={f.expectedHarvestDAT} onChange={set('expectedHarvestDAT')} /></Field>
        <Field label="Setup cost (GH₵)"><input type="number" step="0.01" value={f.setupCost} onChange={set('setupCost')} placeholder="seedlings for this batch" /></Field>
        <Field label="Manure applied date"><input type="date" value={f.manureAppliedDate} onChange={set('manureAppliedDate')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Start batch</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ========================= NURSERY ============================ */
/* ============================================================= */

function nurseryStatusTag(batch) {
  if (batch.status === 'transplanted') return <span className="tag green">Transplanted</span>;
  if (batch.status === 'failed') return <span className="tag rust">Failed / discarded</span>;
  return <span className="tag gold">Active</span>;
}

function NurseryTab({ batches, fields, onAdd, onEdit, onDelete, onTransplant }) {
  const { askConfirm } = useToastConfirm();
  const active = batches.filter((b) => b.status !== 'transplanted' && b.status !== 'failed');
  const past = batches.filter((b) => b.status === 'transplanted' || b.status === 'failed');

  return (
    <>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <h3 style={{ fontSize: 18 }}>Nursery</h3>
        <button className="btn btn-green" onClick={onAdd}>+ Sow new batch</button>
      </div>
      <p className="stat-foot" style={{ marginTop: 0, marginBottom: 18 }}>
        Track seedlings from sowing through germination to transplant-ready, before they ever reach
        Field A or B. Typical bell pepper nursery duration is around 30 days, but every batch can set
        its own.
      </p>

      {active.length === 0 && past.length === 0 ? (
        <p className="empty" style={{ padding: '18px 0' }}>
          No nursery batches yet — log one when you sow seeds, and this tracks it through to transplant.
        </p>
      ) : (
        <div className="field-card-grid">
          {active.map((b) => {
            const ns = nurseryStatus(b);
            return (
              <div className="panel" key={b.id} style={{ marginBottom: 0 }}>
                <div className="panel-head">
                  <h3>{b.batchLabel}</h3>
                  {nurseryStatusTag(b)}
                </div>
                <div style={{ padding: '4px 0 10px' }}>
                  <div className="kv"><span className="k">Variety</span><span className="v">{b.variety || '—'}</span></div>
                  <div className="kv"><span className="k">Sown</span><span className="v">{fmtDate(b.seedSowDate)} ({ns.daysSinceSow}d ago)</span></div>
                  <div className="kv"><span className="k">Method</span><span className="v">{b.method || '—'}</span></div>
                  <div className="kv"><span className="k">Quantity sown</span><span className="v">{num(b.quantitySown)}</span></div>
                  <div className="kv">
                    <span className="k">Germination</span>
                    <span className="v">{b.germinationDate ? `${num(b.germinationPct)}% on ${fmtDate(b.germinationDate)}` : 'not checked yet'}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Expected ready</span>
                    <span className="v">{fmtDate(ns.expectedReady)}{ns.daysToReady > 0 ? ` (${ns.daysToReady}d)` : ' (due)'}</span>
                  </div>
                  {b.notes && <div className="kv"><span className="k">Notes</span><span className="v" style={{ textAlign: 'right' }}>{b.notes}</span></div>}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => onEdit(b)}>Edit / log germination</button>
                  <button className="btn btn-green" onClick={() => onTransplant(b)}>Transplant to field</button>
                  <button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this nursery batch?')) onDelete(b.id); }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {past.length > 0 && (
        <>
          <p className="section-title">Past batches</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Batch</th><th>Variety</th><th>Sown</th><th>Status</th><th>Transplanted</th><th></th></tr></thead>
              <tbody>
                {past.map((b) => (
                  <tr key={b.id}>
                    <td>{b.batchLabel}</td>
                    <td>{b.variety || '—'}</td>
                    <td className="mono">{fmtDate(b.seedSowDate)}</td>
                    <td>{nurseryStatusTag(b)}</td>
                    <td className="mono">
                      {b.transplantedDate
                        ? `${fmtDate(b.transplantedDate)} → ${(fields.find((f) => f.id === b.transplantedToFieldId) || {}).name || '—'}`
                        : '—'}
                    </td>
                    <td><button className="link-btn rust" onClick={async () => { if (await askConfirm('Delete this nursery batch?')) onDelete(b.id); }}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function NurseryBatchForm({ entry, onClose, onSave }) {
  const isEdit = Boolean(entry);
  const [f, setF] = useState({
    batchLabel: entry?.batchLabel || '', variety: entry?.variety || '',
    seedSowDate: entry?.seedSowDate || todayISO(), seedSource: entry?.seedSource || '',
    method: entry?.method || NURSERY_METHODS[0], quantitySown: entry?.quantitySown ?? '',
    expectedNurseryDays: entry?.expectedNurseryDays ?? NURSERY_DEFAULT_DAYS,
    germinationDate: entry?.germinationDate || '', germinationPct: entry?.germinationPct ?? '',
    status: entry?.status || 'active', notes: entry?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.batchLabel || !f.seedSowDate) return;
    onSave({
      id: entry?.id || newId(),
      batchLabel: f.batchLabel, variety: f.variety || null, seedSowDate: f.seedSowDate,
      seedSource: f.seedSource || null, method: f.method,
      quantitySown: f.quantitySown === '' ? null : Number(f.quantitySown),
      expectedNurseryDays: f.expectedNurseryDays === '' ? NURSERY_DEFAULT_DAYS : Number(f.expectedNurseryDays),
      germinationDate: f.germinationDate || null,
      germinationPct: f.germinationPct === '' ? null : Number(f.germinationPct),
      status: f.status, notes: f.notes || null,
    });
  }
  return (
    <Modal title={isEdit ? `Edit ${entry.batchLabel}` : 'Sow new nursery batch'} sub="Seeds sown, method, and germination progress." onClose={onClose}>
      <div className="form-grid">
        <Field label="Batch label"><input value={f.batchLabel} onChange={set('batchLabel')} placeholder="e.g. June sowing" /></Field>
        <Field label="Variety"><input value={f.variety} onChange={set('variety')} placeholder="e.g. California Wonder" /></Field>
        <Field label="Seed sowing date"><input type="date" value={f.seedSowDate} onChange={set('seedSowDate')} /></Field>
        <Field label="Seed source"><input value={f.seedSource} onChange={set('seedSource')} placeholder="supplier / variety batch" /></Field>
        <Field label="Method">
          <select value={f.method} onChange={set('method')}>
            {NURSERY_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Quantity sown"><input type="number" value={f.quantitySown} onChange={set('quantitySown')} placeholder="seeds or trays" /></Field>
        <Field label="Expected nursery days"><input type="number" value={f.expectedNurseryDays} onChange={set('expectedNurseryDays')} placeholder={String(NURSERY_DEFAULT_DAYS)} /></Field>
        <Field label="Germination check date"><input type="date" value={f.germinationDate} onChange={set('germinationDate')} /></Field>
        <Field label="Germination rate (%)"><input type="number" value={f.germinationPct} onChange={set('germinationPct')} /></Field>
        {isEdit && (
          <Field label="Status">
            <select value={f.status} onChange={set('status')}>
              {Object.entries(NURSERY_STATUSES).filter(([k]) => k !== 'transplanted').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        )}
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="damping-off watch, shading, hardening off..." /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>{isEdit ? 'Save changes' : 'Sow batch'}</button>
      </div>
    </Modal>
  );
}

function TransplantNurseryForm({ batch, fields, onClose, onSave }) {
  const [f, setF] = useState({
    fieldId: fields[0]?.id || '', transplantDate: todayISO(), plantCount: batch?.quantitySown ?? '',
    spacing: '', expectedHarvestDAT: 70, setupCost: '', manureAppliedDate: '', notes: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ns = batch ? nurseryStatus(batch, f.transplantDate) : null;
  function submit() {
    if (!f.fieldId || !f.transplantDate) return;
    onSave(f.fieldId, {
      currentBatchLabel: `From nursery: ${batch.batchLabel}`,
      variety: batch.variety || '', transplantDate: f.transplantDate,
      plantCount: f.plantCount === '' ? null : Number(f.plantCount),
      spacing: f.spacing || '',
      expectedHarvestDAT: f.expectedHarvestDAT === '' ? null : Number(f.expectedHarvestDAT),
      setupCost: f.setupCost === '' ? null : Number(f.setupCost),
      manureAppliedDate: f.manureAppliedDate || null,
      notes: f.notes || `Transplanted from nursery batch "${batch.batchLabel}" (sown ${fmtDate(batch.seedSowDate)}).`,
    });
  }
  if (!batch) return null;
  return (
    <Modal
      title={`Transplant ${batch.batchLabel}`}
      sub={ns ? `${ns.daysSinceSow} days in the nursery by this transplant date.` : undefined}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Field">
          <select value={f.fieldId} onChange={set('fieldId')}>
            {fields.map((fl) => <option key={fl.id} value={fl.id}>{fl.name}</option>)}
          </select>
        </Field>
        <Field label="Transplant date"><input type="date" value={f.transplantDate} onChange={set('transplantDate')} /></Field>
        <Field label="Plants transplanted"><input type="number" value={f.plantCount} onChange={set('plantCount')} /></Field>
        <Field label="Spacing"><input value={f.spacing} onChange={set('spacing')} placeholder="e.g. 45cm × 60cm" /></Field>
        <Field label="Expected 1st harvest (DAT)"><input type="number" value={f.expectedHarvestDAT} onChange={set('expectedHarvestDAT')} /></Field>
        <Field label="Setup cost (GH₵)"><input type="number" step="0.01" value={f.setupCost} onChange={set('setupCost')} placeholder="land prep, drip, labour" /></Field>
        <Field label="Manure applied date"><input type="date" value={f.manureAppliedDate} onChange={set('manureAppliedDate')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <p className="stat-foot" style={{ marginTop: 4 }}>
        This closes out whatever's currently planted on that field (archived to Batch Performance) and
        starts this batch as the new planting, carrying the variety across from the nursery record.
      </p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Transplant</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ============= AGROCHEMICAL / INPUT STOCK (PEPPER) =========== */
/* ============================================================= */

const INPUT_UNITS = ['ml', 'L', 'g', 'kg', 'sachets', 'bags'];
const INPUT_TYPES = ['Insecticide', 'Fungicide', 'Fertiliser', 'Foliar feed', 'Herbicide', 'Other'];

function InputsTab({ inputs, onAdd, onUpdate, onDelete }) {
  const low = inputs.filter((i) => i.reorderAt != null && Number(i.quantity) <= Number(i.reorderAt));
  return (
    <>
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 18 }}>Agrochemical &amp; Input Stock</h3>
        <button className="btn btn-green" onClick={onAdd}>+ Add input</button>
      </div>

      {low.map((i) => (
        <div className="stale-banner" key={i.id} style={{ marginBottom: 10 }}>
          ⚠ <span><strong>{i.name}</strong> is low — {num(i.quantity, 1)} {i.unit} left (reorder at {num(i.reorderAt, 1)}). Restock before you need it mid-outbreak.</span>
        </div>
      ))}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Input</th><th>Type</th><th>Active ingredient</th><th>In stock</th><th>Reorder at</th><th>Unit cost</th><th>Adjust</th><th></th></tr>
          </thead>
          <tbody>
            {inputs.map((i) => {
              const isLow = i.reorderAt != null && Number(i.quantity) <= Number(i.reorderAt);
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{i.type}</td>
                  <td>{i.activeIngredient || '—'}</td>
                  <td className="mono">
                    <span className={isLow ? 'tag rust' : 'tag green'}>{num(i.quantity, 1)} {i.unit}</span>
                  </td>
                  <td className="mono">{i.reorderAt != null ? `${num(i.reorderAt, 1)} ${i.unit}` : '—'}</td>
                  <td className="mono">{i.unitCost != null ? `GH₵ ${num(i.unitCost, 2)}` : '—'}</td>
                  <td>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button className="link-btn" onClick={() => onUpdate(i.id, { quantity: Math.max(0, Number(i.quantity) - 1) })}>−1</button>
                      <button className="link-btn" onClick={() => onUpdate(i.id, { quantity: Number(i.quantity) + 1 })}>+1</button>
                    </span>
                  </td>
                  <td><button className="link-btn rust" onClick={() => onDelete(i.id)}>Delete</button></td>
                </tr>
              );
            })}
            {inputs.length === 0 && <tr><td colSpan={8} className="empty">No inputs tracked yet — add your sprays and fertilisers with a reorder level so you never run dry mid-season.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="stat-foot">
        Set a reorder level a little above what one full spray round uses, so a warning gives you time
        to buy before the next application is due.
      </p>
    </>
  );
}

function InputForm({ onClose, onSave }) {
  const [f, setF] = useState({ name: '', type: 'Insecticide', activeIngredient: '', quantity: '', unit: 'L', reorderAt: '', unitCost: '', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  function submit() {
    if (!f.name || f.quantity === '') return;
    onSave({
      id: newId(), name: f.name, type: f.type, activeIngredient: f.activeIngredient || null,
      quantity: Number(f.quantity), unit: f.unit,
      reorderAt: f.reorderAt === '' ? null : Number(f.reorderAt),
      unitCost: f.unitCost === '' ? null : Number(f.unitCost),
      notes: f.notes || null,
    });
  }
  return (
    <Modal title="Add input to stock" sub="Sprays, fertilisers and foliar feeds you keep on hand." onClose={onClose}>
      <div className="form-grid">
        <Field label="Name" span2><input value={f.name} onChange={set('name')} placeholder="e.g. Imida Super" /></Field>
        <Field label="Type">
          <select value={f.type} onChange={set('type')}>
            {INPUT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Active ingredient"><input value={f.activeIngredient} onChange={set('activeIngredient')} placeholder="e.g. Imidacloprid" /></Field>
        <Field label="Quantity in stock"><input type="number" step="0.1" value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Unit">
          <select value={f.unit} onChange={set('unit')}>
            {INPUT_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Warn me at"><input type="number" step="0.1" value={f.reorderAt} onChange={set('reorderAt')} placeholder="reorder level" /></Field>
        <Field label="Unit cost (GH₵)"><input type="number" step="0.01" value={f.unitCost} onChange={set('unitCost')} /></Field>
        <Field label="Notes" span2><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-green" onClick={submit}>Save input</button>
      </div>
    </Modal>
  );
}

/* ============================================================= */
/* ==================== INSTALL PROMPT (PWA) =================== */
/* ============================================================= */

/**
 * Android/Chrome fire `beforeinstallprompt`, so we can show a real
 * install button. iOS Safari has no such event — there we show the
 * manual Share -> Add to Home Screen instruction instead.
 */
function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('aifarms_install_dismissed') === '1'
  );

  const standalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
  );
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    function onPrompt(e) {
      e.preventDefault();
      setDeferred(e);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function hide() {
    localStorage.setItem('aifarms_install_dismissed', '1');
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    hide();
  }

  if (standalone || dismissed) return null;
  if (!deferred && !isIos) return null;

  return (
    <div className="install-bar">
      <span className="install-text">
        {showIosHelp
          ? 'In Safari: tap the Share button, then "Add to Home Screen".'
          : 'Install AI Farms on your phone to open it like an app, even offline.'}
      </span>
      <span className="install-actions">
        {deferred
          ? <button className="btn btn-gold" onClick={install}>Install</button>
          : <button className="btn btn-gold" onClick={() => setShowIosHelp(true)}>How?</button>}
        <button className="link-btn" onClick={hide}>Not now</button>
      </span>
    </div>
  );
}

/* ---------------- Cloud connection setup ---------------- */

/**
 * Shown when the app was built without Supabase env vars, or when you want
 * to point a device at a different project. Entering details here saves them
 * on the device, so a deploy that forgot its env vars is still usable.
 */
function CloudSetupScreen({ onDone, onCancel }) {
  const current = getCloudConfig();
  const [url, setUrl] = useState(current.source === 'device' ? current.url : '');
  const [key, setKey] = useState(current.source === 'device' ? current.key : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fromEnv = current.source === 'env';

  async function save() {
    setError(''); setBusy(true);
    try {
      await testCloudConfig(url, key);
      saveCloudConfig({ url, key });
      onDone();
    } catch (err) {
      setError(err.message || 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    clearCloudConfig();
    onDone();
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <p className="brand-eyebrow">AI Farms</p>
        <h1 className="brand-title" style={{ fontSize: 24, marginBottom: 4 }}>Connect cloud sync</h1>
        <p className="brand-sub" style={{ marginBottom: 20 }}>
          So your phone and PC share the same farm records.
        </p>

        {fromEnv ? (
          <>
            <p className="auth-notice">
              This app was built with cloud details already included — there is nothing to enter.
            </p>
            <button className="btn btn-gold auth-submit" onClick={onCancel}>Back</button>
          </>
        ) : (
          <>
            <p className="stat-foot" style={{ marginTop: 0, marginBottom: 16 }}>
              Paste these from your Supabase project under
              <strong> Project Settings → API</strong>. Use the <strong>anon public</strong> key —
              never the service_role key.
            </p>

            <div className="field">
              <label>Project URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://xxxx.supabase.co" autoComplete="off" />
            </div>
            <div className="field">
              <label>Anon public key</label>
              <input value={key} onChange={(e) => setKey(e.target.value)}
                placeholder="eyJhbGciOi…" autoComplete="off" />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button className="btn btn-gold auth-submit" onClick={save} disabled={busy}>
              {busy ? 'Checking…' : 'Connect'}
            </button>

            <div className="auth-links">
              <button className="link-btn" onClick={onCancel}>← Back</button>
              {current.source === 'device' && (
                <button className="link-btn rust" onClick={disconnect}>Disconnect this device</button>
              )}
            </div>

            <p className="auth-foot">
              Saved on this device only. Setting <code>VITE_SUPABASE_URL</code> and
              <code> VITE_SUPABASE_ANON_KEY</code> in Vercel means you never have to type them again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
