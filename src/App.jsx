import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCloudSync } from "./sync/useCloudSync.js";

// ─── LICENCE KEY SCHEME ───────────────────────────────────────
// Keys are self-validating — they carry their own type and expiry date,
// checked against a signature, so any key produced by the EduSmart Licence
// Generator works immediately without needing to be added to a list here.
// This constant MUST match the same constant in the Licence Generator app —
// changing it invalidates every key issued before the change.
// Single source of truth for the version shown throughout the app —
// keep this in sync with package.json's version each release, since
// nothing wires them together automatically at build time.
const APP_VERSION = "5.5.7";

const LICENCE_SECRET = "EAGLEEYE-EDUSMART-2026-LIC";

function simpleHash(str) {
  // Small deterministic non-cryptographic checksum (FNV-1a), fine for
  // licence-gating a desktop product — not meant to resist a determined
  // attacker decompiling the app, only to stop typos/guessing and let
  // keys be generated offline without a server round-trip.
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

const DAY_MS = 86400000;
const dayNum = (date) => Math.floor(new Date(date).getTime() / DAY_MS);
const numToDay = (n) => new Date(n * DAY_MS);

// type: "B" (Basic) or "P" (Pro). expiryDayNum: integer day number, or the
// string "LIFE" for a lifetime licence.
function buildLicenceKey(type, expiryDayNum) {
  const issued = dayNum(new Date()).toString(36).toUpperCase();
  const expiry = expiryDayNum === "LIFE" ? "LIFE" : expiryDayNum.toString(36).toUpperCase();
  const payload = `${type}-${issued}-${expiry}`;
  const checksum = simpleHash(payload + LICENCE_SECRET).slice(0, 5);
  return `EDU-${payload}-${checksum}`;
}

function parseLicenceKey(key) {
  const parts = (key || "").trim().toUpperCase().split("-");
  if (parts.length !== 5 || parts[0] !== "EDU") return null;
  const [, type, issued, expiry, checksum] = parts;
  if (type !== "B" && type !== "P") return null;
  const payload = `${type}-${issued}-${expiry}`;
  if (simpleHash(payload + LICENCE_SECRET).slice(0, 5) !== checksum) return null;
  let expiryDate = null;
  if (expiry !== "LIFE") {
    const expiryDayNum = parseInt(expiry, 36);
    if (isNaN(expiryDayNum)) return null;
    expiryDate = numToDay(expiryDayNum);
  }
  return { type: type === "P" ? "pro" : "basic", expiry: expiryDate, lifetime: expiry === "LIFE" };
}

// ─── ROLE ACCESS ─────────────────────────────────────────────
const ROLE_ACCESS = {
  "Admin":                ["dashboard","students","staff","grades","attendance","finance","library","timetable","reports","idcards","archive","audit","settings","payroll","communication","nursery","kindergarten","exams","promotion","history"],
  "Headmaster":           ["dashboard","students","staff","grades","attendance","finance","library","timetable","reports","idcards","archive","audit","settings","payroll","communication","nursery","kindergarten","exams","promotion","history"],
  "HOD":                  ["dashboard","students","staff","grades","attendance","finance","library","timetable","reports","idcards","archive","audit","settings","payroll","communication","nursery","kindergarten","exams","promotion","history"],
  "Teacher":              ["dashboard","grades","attendance","timetable","exams","communication"],
  "Account Office":       ["finance","payroll"],
  "Librarian":            ["library"],
  "Non-Teaching Staff":   ["dashboard"],
};

const ROLES = ["Admin","Headmaster","HOD","Teacher","Account Office","Librarian","Non-Teaching Staff"];

const DEFAULT_CLASSES = ["Creche","Nursery 1","Nursery 2","KG 1","KG 2","Class 1A","Class 1B","Class 2A","Class 2B","Class 3A","Class 3B","Class 4A","Class 4B","Class 5A","Class 5B","Class 6A","Class 6B","JHS 1","JHS 2","JHS 3"];
const NURSERY_CLASSES = ["Creche","Nursery 1","Nursery 2"];
const KINDERGARTEN_CLASSES = ["KG 1","KG 2"];
const KG_CLASSES = NURSERY_CLASSES.concat(KINDERGARTEN_CLASSES); // legacy combined group — still used for fee-band/section logic
const PRIMARY_CLASSES = ["Class 1A","Class 1B","Class 2A","Class 2B","Class 3A","Class 3B","Class 4A","Class 4B","Class 5A","Class 5B","Class 6A","Class 6B"];
const JHS_CLASSES = ["JHS 1","JHS 2","JHS 3"];
const CLASS_LEVELS = ["Nursery","Kindergarten","Primary","JHS"];
// Maps every default class to its level, so admin-added classes can be
// slotted into the right level too (stored the same way in classLevels state).
const DEFAULT_CLASS_LEVELS = {};
NURSERY_CLASSES.forEach(c=>DEFAULT_CLASS_LEVELS[c]="Nursery");
KINDERGARTEN_CLASSES.forEach(c=>DEFAULT_CLASS_LEVELS[c]="Kindergarten");
PRIMARY_CLASSES.forEach(c=>DEFAULT_CLASS_LEVELS[c]="Primary");
JHS_CLASSES.forEach(c=>DEFAULT_CLASS_LEVELS[c]="JHS");

const DEFAULT_SUBJECTS = ["Mathematics","English Language","Science","Social Studies","ICT","French","RME","Creative Arts","Ghanaian Language","Physical Education","History","Pre-Technical Skills"];
const NON_EXAM_SUBJECTS = ["Physical Education","Creative Arts"]; // excluded from formal exam scheduling
function getExamSubjects(subjectList) { return subjectList.filter(s=>!NON_EXAM_SUBJECTS.includes(s)); }

const MILESTONE_CATEGORIES = {
  "Motor Skills":    ["Crawling","Walking steadily","Running","Jumping","Climbing stairs","Holding pencil","Drawing shapes","Using scissors","Stacking blocks","Self-feeding"],
  "Language":        ["Babbling","Saying first words","Two-word phrases","Simple sentences","Full sentences","Recognising own name","Following instructions","Storytelling","Singing songs"],
  "Social":          ["Eye contact","Smiling at others","Playing alongside peers","Sharing toys","Taking turns","Following class rules","Greeting teachers","Making friends"],
  "Cognitive":       ["Recognising colours","Counting 1-10","Recognising shapes","Sorting objects","Puzzles","Name recognition","Letter recognition","Number recognition"],
  "Self-Care":       ["Potty trained","Washing hands","Dressing self","Packing bag","Eating independently","Drinking from cup","Brushing teeth"],
};

const MILESTONE_RATINGS = ["Not Yet","Emerging","Developing","Achieved"];

// ─── SEED DATA ────────────────────────────────────────────────
const INITIAL_SCHOOL = {
  name:"", address:"", phone:"", email:"", motto:"",
  currentTerm:"Term 1", currentYear:"", principalName:"",
};

const INITIAL_USERS = []; // first-run wizard creates the initial Admin account

const INITIAL_STUDENTS = [];
const INITIAL_GRADES = [];
const INITIAL_MOCK_EXAMS = [];
const INITIAL_ATTENDANCE = [];
const INITIAL_FEES = [];
const INITIAL_EXPENSES = [];
const INITIAL_PAYROLL = [];
const INITIAL_BOOKS = [];
const INITIAL_BORROWS = [];
const INITIAL_NURSERY_LOGS = [];
const INITIAL_MILESTONES = [];
const INITIAL_EXAM_SCHEDULE = [];

// Auto-generate a Monday-Friday timetable for every class so all 20 classes
// (Creche through JHS 3) have a starting timetable instead of just 2 hardcoded ones.
// Admin/HOD can still edit any cell via the Timetable Builder. `subjectList` and
// `levelOf` let this work for admin-added classes too (see Settings > Classes & Subjects).
function generateTimetable(cls, subjectList, levelOf) {
  const level = levelOf ? levelOf(cls) : (DEFAULT_CLASS_LEVELS[cls] || "Primary");
  const isKG = level === "Nursery" || level === "Kindergarten";
  const isJHS = level === "JHS";
  const slots = isKG
    ? ["7:30-8:15","8:15-9:00","9:00-9:45","9:45-10:15","10:15-11:00","11:00-12:00","12:00-13:00","13:00-13:45"]
    : ["7:30-8:30","8:30-9:30","9:30-10:30","10:30-11:00","11:00-12:00","12:00-13:00","13:00-14:00","14:00-15:00"];
  const kgSubjects = ["Number Work","Literacy","Creative Play","Break","Music & Movement","Lunch","Story Time","Outdoor Play"];
  const pool = isJHS ? getExamSubjects(subjectList).concat(["Pre-Technical Skills","Physical Education"]) : subjectList;
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
  // Simple deterministic rotation per class so each class gets a distinct but stable pattern
  const seed = cls.split("").reduce((a,c)=>a+c.charCodeAt(0),0);
  return days.map((day,di)=>({
    day,
    periods: slots.map((time,pi)=>{
      if (isKG) return { time, subject: kgSubjects[pi] };
      if (time==="10:30-11:00") return { time, subject:"Break" };
      if (time==="12:00-13:00") return { time, subject:"Lunch" };
      const idx = (seed + di*3 + pi*2) % (pool.length||1);
      return { time, subject: pool[idx] };
    })
  }));
}

const DEFAULT_TIMETABLES = DEFAULT_CLASSES.reduce((acc,cls)=>{ acc[cls]=generateTimetable(cls, DEFAULT_SUBJECTS); return acc; },{});


// ─── PROMOTION MAPPING ────────────────────────────────────────
// Defines what class a student moves into after passing the academic year.
// Single-stream levels move straight to the next single-stream level.
// Streamed levels (Class 1–6, A/B) keep their stream letter going up.
// Class 6 (both streams) merges into JHS 1, which has no streams.
// JHS 3 passers graduate out of the roll entirely.
const PROMOTION_MAP = {
  "Creche":"Nursery 1", "Nursery 1":"Nursery 2", "Nursery 2":"KG 1", "KG 1":"KG 2",
  "Class 1A":"Class 2A", "Class 1B":"Class 2B",
  "Class 2A":"Class 3A", "Class 2B":"Class 3B",
  "Class 3A":"Class 4A", "Class 3B":"Class 4B",
  "Class 4A":"Class 5A", "Class 4B":"Class 5B",
  "Class 5A":"Class 6A", "Class 5B":"Class 6B",
  "Class 6A":"JHS 1", "Class 6B":"JHS 1",
  "JHS 1":"JHS 2", "JHS 2":"JHS 3",
  // "JHS 3" has no entry here — it's handled as graduation, not a class move.
};
// KG 2 splits its single class into the two Class 1 streams (alternating so
// they come out roughly balanced) since Class 1 is the first streamed level.
function nextClassFor(currentClass, indexInBatch) {
  if (currentClass === "KG 2") return indexInBatch % 2 === 0 ? "Class 1A" : "Class 1B";
  return PROMOTION_MAP[currentClass] || null;
}
function nextAcademicYear(yearStr) {
  const m = /^(\d{4})\/(\d{4})$/.exec(yearStr||"");
  if (!m) return yearStr;
  return `${+m[1]+1}/${+m[2]+1}`;
}


const AUDIT_LOG_INITIAL = [];

// ─── HELPERS ──────────────────────────────────────────────────
const calcGrade = s => s>=80?"A":s>=70?"B":s>=60?"C":s>=50?"D":s>=45?"E":"F";
const calcCA    = ca  => Math.round((ca/30)*30);  // CA out of 30
const calcExam  = ex  => Math.round((ex/70)*70);  // Exam out of 70
const formatGHS = n   => `GH₵ ${Number(n||0).toFixed(2)}`;
const todayStr  = ()  => new Date().toISOString().split("T")[0];
const nowStr    = ()  => new Date().toLocaleString("en-GB");
const uid       = pre => `${pre}${Date.now().toString().slice(-7)}`;

// Ghana PAYE tax bands 2024 (monthly)
const calcPAYE = (monthly) => {
  if (monthly <= 490)  return 0;
  if (monthly <= 700)  return (monthly - 490) * 0.05;
  if (monthly <= 1500) return 10.5 + (monthly - 700) * 0.10;
  if (monthly <= 3500) return 90.5 + (monthly - 1500) * 0.175;
  if (monthly <= 6000) return 440.5 + (monthly - 3500) * 0.25;
  return 1065.5 + (monthly - 6000) * 0.30;
};

// ─── SHARED UI ────────────────────────────────────────────────
const inp = { width:"100%", padding:"8px 12px", borderRadius:8, border:"1.5px solid #d1d5db", fontSize:13, boxSizing:"border-box", fontFamily:"inherit" };
const btnP = { padding:"9px 20px", background:"#1e40af", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 };
const btnS = { padding:"9px 20px", background:"#e5e7eb", color:"#374151", border:"none", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 };
const btnSm = { padding:"5px 10px", border:"none", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600 };

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
      <div style={{ background:"#fff",borderRadius:14,padding:24,maxWidth:wide?680:520,width:"100%",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18 }}>
          <h3 style={{ margin:0,fontSize:16,fontWeight:700,color:"#0f172a" }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#6b7280",lineHeight:1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:"block",fontSize:12,fontWeight:600,color:"#374151",marginBottom:4 }}>{label}</label>
      {children}
    </div>
  );
}

// Reusable photo picker: reads the chosen image as a base64 data URL (kept small
// via canvas downscaling) so it can sit directly in the record and print on ID cards.
function PhotoUpload({ value, onChange, size=90 }) {
  const inputRef = useRef(null);
  const handleFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        // downscale to keep stored size reasonable across hundreds of records
        const maxDim = 300;
        const scale = Math.min(1, maxDim/Math.max(img.width,img.height));
        const canvas = document.createElement("canvas");
        canvas.width = img.width*scale; canvas.height = img.height*scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        onChange(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  return (
    <div style={{ display:"flex",alignItems:"center",gap:12 }}>
      <div onClick={()=>inputRef.current?.click()} style={{ width:size,height:size,borderRadius:10,background:"#f1f5f9",
        border:"1.5px dashed #cbd5e1",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",flexShrink:0 }}>
        {value ? <img src={value} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }}/> : <span style={{ fontSize:22,color:"#94a3b8" }}>📷</span>}
      </div>
      <div>
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display:"none" }}/>
        <button type="button" onClick={()=>inputRef.current?.click()} style={{ ...btnSm,background:"#dbeafe",color:"#1d4ed8",padding:"6px 12px" }}>{value?"Change Photo":"Upload Photo"}</button>
        {value && <button type="button" onClick={()=>onChange("")} style={{ ...btnSm,background:"#fee2e2",color:"#991b1b",padding:"6px 12px",marginLeft:6 }}>Remove</button>}
      </div>
    </div>
  );
}

function Card({ children, style, className }) {
  return <div className={className} style={{ background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.08)",...style }}>{children}</div>;
}

function StatCard({ icon, label, value, color, sub }) {
  return (
    <div style={{ background:"#fff",borderRadius:12,padding:18,boxShadow:"0 1px 4px rgba(0,0,0,0.08)",borderLeft:`4px solid ${color}` }}>
      <div style={{ fontSize:22,marginBottom:4 }}>{icon}</div>
      <div style={{ fontSize:20,fontWeight:700,color }}>{value}</div>
      <div style={{ fontSize:12,color:"#64748b" }}>{label}</div>
      {sub&&<div style={{ fontSize:11,color:"#9ca3af",marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function Badge({ text, color, bg }) {
  return <span style={{ background:bg||color+"22",color,padding:"2px 8px",borderRadius:10,fontSize:11,fontWeight:600 }}>{text}</span>;
}

function Table({ cols, rows, emptyMsg, sortState, colKeys }) {
  return (
    <div style={{ background:"#fff",borderRadius:12,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
        <thead>
          <tr style={{ background:"#f8fafc" }}>
            {cols.map((c,i)=>{
              const key = colKeys?.[i];
              const sortable = sortState && key;
              const active = sortable && sortState.sortKey===key;
              return (
                <th key={c} onClick={()=>sortable&&sortState.onSort(key)}
                  style={{ padding:"10px 12px",textAlign:"left",fontWeight:600,color:"#374151",borderBottom:"1px solid #e5e7eb",whiteSpace:"nowrap",
                    cursor:sortable?"pointer":"default",userSelect:"none" }}>
                  {c}{sortable&&<span style={{ marginLeft:4,fontSize:10,color:active?"#1e40af":"#cbd5e1" }}>{active?(sortState.sortDir==="asc"?"▲":"▼"):"▲▼"}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      {(!rows||rows.length===0)&&<p style={{ textAlign:"center",color:"#9ca3af",padding:24 }}>{emptyMsg||"No records found."}</p>}
    </div>
  );
}

// Generic client-side sort: pass the raw array, get back a sorted copy plus
// header click state. Handles strings, numbers, and null/undefined gracefully.
function useSort(data, defaultKey=null, defaultDir="asc") {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const arr = [...data];
    arr.sort((a,b) => {
      let av = a?.[sortKey], bv = b?.[sortKey];
      if (av==null && bv==null) return 0;
      if (av==null) return 1;
      if (bv==null) return -1;
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return sortDir==="asc"?-1:1;
      if (av > bv) return sortDir==="asc"?1:-1;
      return 0;
    });
    return arr;
  }, [data, sortKey, sortDir]);
  return { sorted, sortKey, sortDir, onSort: toggleSort };
}

function TD({ children, bold, color, small }) {
  return <td style={{ padding:"8px 12px",fontWeight:bold?600:400,color:color||"#374151",fontSize:small?11:13 }}>{children}</td>;
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display:"flex",gap:6,marginBottom:16,flexWrap:"wrap" }}>
      {tabs.map(t=>(
        <button key={t.key} onClick={()=>onChange(t.key)}
          style={{ padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:13,
            background:active===t.key?"#1e40af":"#e5e7eb",color:active===t.key?"#fff":"#374151" }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────
// ─── LOCAL PERSISTENCE ──────────────────────────────────────────
// Everything used to live only in memory — closing the app lost all data,
// even a paid licence activation. This saves the whole app state to the
// device's local storage and reloads it on startup. It's per-device only;
// it is NOT multi-device sync (that's a separate, larger project).
const STORAGE_KEY = "edusmart_appdata_v1";
function loadPersisted() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export default function EduSmart() {
  const persisted = loadPersisted();

  const [licenced,  setLicenced]  = useState(!!persisted?.licenced);
  const [licKey,    setLicKey]    = useState("");
  const [licInfo,   setLicInfo]   = useState(persisted?.licInfo || null);
  const [licErr,    setLicErr]    = useState("");
  const [loggedIn,  setLoggedIn]  = useState(false);
  const [curUser,   setCurUser]   = useState(null);
  const [selUser,   setSelUser]   = useState("");
  const [pin,       setPin]       = useState("");
  const [authErr,   setAuthErr]   = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [section,   setSection]   = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [jumpSearch, setJumpSearch] = useState("");
  const [notif,     setNotif]     = useState(null);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [failedLogins, setFailedLogins] = useState(persisted?.failedLogins ?? {});

  const [school,     setSchool]     = useState(persisted?.school ?? INITIAL_SCHOOL);
  const [users,      setUsers]      = useState(persisted?.users ?? INITIAL_USERS);
  const [students,   setStudents]   = useState(persisted?.students ?? INITIAL_STUDENTS);
  const [grades,     setGrades]     = useState(persisted?.grades ?? INITIAL_GRADES);
  const [mockExams,  setMockExams]  = useState(persisted?.mockExams ?? INITIAL_MOCK_EXAMS);
  const [attendance, setAttendance] = useState(persisted?.attendance ?? INITIAL_ATTENDANCE);
  const [fees,       setFees]       = useState(persisted?.fees ?? INITIAL_FEES);
  const [expenses,   setExpenses]   = useState(persisted?.expenses ?? INITIAL_EXPENSES);
  const [payroll,    setPayroll]    = useState(persisted?.payroll ?? INITIAL_PAYROLL);
  const [books,      setBooks]      = useState(persisted?.books ?? INITIAL_BOOKS);
  const [borrows,    setBorrows]    = useState(persisted?.borrows ?? INITIAL_BORROWS);
  const [nurseryLogs,setNurseryLogs]= useState(persisted?.nurseryLogs ?? INITIAL_NURSERY_LOGS);
  const [milestones, setMilestones] = useState(persisted?.milestones ?? INITIAL_MILESTONES);
  const [examSchedule,setExamSchedule]=useState(persisted?.examSchedule ?? INITIAL_EXAM_SCHEDULE);
  const [timetables, setTimetables] = useState(persisted?.timetables ?? DEFAULT_TIMETABLES);
  const [classes, setClasses] = useState(persisted?.classes ?? [...DEFAULT_CLASSES]);
  const [classLevels, setClassLevels] = useState(persisted?.classLevels ?? {...DEFAULT_CLASS_LEVELS});
  const [subjects, setSubjects] = useState(persisted?.subjects ?? [...DEFAULT_SUBJECTS]);
  const [yearArchive, setYearArchive] = useState(persisted?.yearArchive ?? {}); // year -> snapshot, populated at each promotion run
  const [auditLog,   setAuditLog]   = useState(persisted?.auditLog ?? AUDIT_LOG_INITIAL);

  // Cloud sync — a no-op layer when not enabled, so nothing below this
  // point changes app behavior unless the school has actually turned it on.
  // "staff" is the key used for the sync table (matching the backend);
  // the app's own state variable for the same data is "users" — mapped
  // here so useCloudSync's internals can stay consistently keyed by
  // table name throughout.
  const cloudSync = useCloudSync({
    appState: { students, attendance, grades, fees, staff: users, school },
    appSetters: { students: setStudents, attendance: setAttendance, grades: setGrades, fees: setFees, staff: setUsers, school: setSchool },
  });

  // Save everything back to local storage shortly after any change.
  // Debounced so rapid typing doesn't write to disk on every keystroke.
  const saveTimer = useRef(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const blob = { licenced, licInfo, school, users, students, grades, mockExams, attendance, fees,
          expenses, payroll, books, borrows, nurseryLogs, milestones, examSchedule, timetables,
          classes, classLevels, subjects, yearArchive, auditLog, failedLogins };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
      } catch (e) { /* storage full or unavailable — data stays in memory for this session */ }
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [licenced, licInfo, school, users, students, grades, mockExams, attendance, fees, expenses,
      payroll, books, borrows, nurseryLogs, milestones, examSchedule, timetables,
      classes, classLevels, subjects, yearArchive, auditLog, failedLogins]);

  const notify = (msg, type="success") => { setNotif({msg,type}); setTimeout(()=>setNotif(null),3500); };

  // Re-check expiry on every launch — a persisted licence that has since
  // expired should re-lock the app rather than staying active forever.
  useEffect(() => {
    if (licenced && licInfo && !licInfo.lifetime && licInfo.expiry) {
      if (new Date(licInfo.expiry) < new Date()) {
        setLicenced(false);
        setLicErr("Your licence has expired. Please enter a new key to continue.");
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addAudit = useCallback((action, sec) => {
    if (!curUser) return;
    setAuditLog(p=>[...p,{ id:uid("AUD"), user:curUser.code, action, section:sec, timestamp:nowStr() }]);
  },[curUser]);

  // Session timeout — 15 min
  useEffect(() => {
    const track = () => setLastActivity(Date.now());
    window.addEventListener("mousemove",track); window.addEventListener("keydown",track);
    const check = setInterval(()=>{ if(loggedIn && Date.now()-lastActivity>900000){ setLoggedIn(false);setCurUser(null);notify("Session expired — please log in again","error"); }},30000);
    return ()=>{ window.removeEventListener("mousemove",track); window.removeEventListener("keydown",track); clearInterval(check); };
  },[loggedIn,lastActivity]);

  // ─── LOCKOUT: 15-minute auto-expiry, so a single-admin school can
  // never be locked out permanently, while still meaning something —
  // unlike a purely in-memory lockout, this survives an app restart,
  // so restarting can't be used to bypass PIN guessing attempts.
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
  function isLocked(userId) {
    const rec = failedLogins[userId];
    if (!rec || !rec.lockedAt) return false;
    return (Date.now() - rec.lockedAt) < LOCKOUT_DURATION_MS;
  }
  function lockoutRemaining(userId) {
    const rec = failedLogins[userId];
    if (!rec || !rec.lockedAt) return 0;
    return Math.max(0, Math.ceil((LOCKOUT_DURATION_MS - (Date.now()-rec.lockedAt))/60000));
  }

  async function doLogin() {
    const u = users.find(x=>x.id===selUser && x.active);
    if (!u) { setAuthErr("User not found or inactive."); return; }
    if (isLocked(selUser)) { setAuthErr(`Account locked. Try again in ${lockoutRemaining(selUser)} minute(s), or use the recovery option below.`); return; }
    const fails = failedLogins[selUser]?.count||0;

    setLoggingIn(true);
    let pinCorrect;
    if (cloudSync?.enabled) {
      try {
        pinCorrect = (await cloudSync.verifyPin(u.id, pin)) === true;
      } catch (e) {
        // No internet right now — fall back to whatever PIN this
        // device last saw locally, rather than blocking login outright.
        // Login staying offline-capable matters as much for cloud-sync
        // schools as it does for local-only ones. A brand new device
        // that joined via Connect Code and has never seen this staff
        // member's PIN locally genuinely can't verify it offline —
        // that's a narrow, honest limitation, not a silent failure.
        if (u.pin) { pinCorrect = u.pin === pin; }
        else { setLoggingIn(false); setAuthErr("Can't verify this PIN while offline on a device that hasn't seen it before. Try again once you're back online."); return; }
      }
    } else {
      pinCorrect = u.pin === pin;
    }
    setLoggingIn(false);

    if (!pinCorrect) {
      const newFails = fails+1;
      const locked = newFails>=3;
      setFailedLogins(p=>({...p,[selUser]:{ count:newFails, lockedAt: locked?Date.now():null }}));
      setAuthErr(locked?`Account locked for 15 minutes after 3 failed attempts.`:`Wrong PIN. ${3-newFails} attempt(s) remaining.`);
      return;
    }
    setFailedLogins(p=>({...p,[selUser]:{count:0,lockedAt:null}}));
    setCurUser(u); setLoggedIn(true); setPin(""); setAuthErr("");
    const secs = ROLE_ACCESS[u.role]||[];
    setSection(secs[0]||"dashboard");
  }

  function doLogout() { setLoggedIn(false); setCurUser(null); setPin(""); setSelUser(""); }

  const unlockUser = (uid2) => { setFailedLogins(p=>({...p,[uid2]:{count:0,lockedAt:null}})); notify("Account unlocked"); };

  // Last-resort recovery when there's no other Admin available to click
  // "Unlock" in Staff — only the paying school actually has this key,
  // so it's a reasonable proof that whoever's asking is legitimate.
  const recoverWithLicenceKey = (enteredKey) => {
    if (enteredKey.trim().toUpperCase() !== licInfo?.key) { return false; }
    setFailedLogins({});
    notify("All account lockouts cleared using your licence key ✅");
    return true;
  };

  // ─── LICENCE SCREEN ───
  if (!licenced) return (
    <div style={{ minHeight:"100vh",background:"linear-gradient(135deg,#0f172a,#1e3a5f)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ background:"#fff",borderRadius:16,padding:40,maxWidth:480,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <div style={{ fontSize:52 }}>🏫</div>
          <h1 style={{ fontSize:28,fontWeight:700,color:"#0f172a",margin:"8px 0 4px" }}>EduSmart</h1>
          <p style={{ color:"#64748b",margin:0,fontSize:13 }}>School Manager v{APP_VERSION}</p>
        </div>
        <Row label="Licence Key">
          <input value={licKey} onChange={e=>setLicKey(e.target.value.toUpperCase())} placeholder="EDU-XXXXX-XXXXX-XXXXX-XXXXX"
            style={inp} onKeyDown={e=>e.key==="Enter"&&activateLicence()}/>
        </Row>
        {licErr&&<p style={{ color:"#dc2626",fontSize:13,marginBottom:10 }}>{licErr}</p>}
        <button onClick={activateLicence} style={{ ...btnP,width:"100%",padding:12,fontSize:15 }}>Activate & Continue</button>
        <p style={{ textAlign:"center",fontSize:11,color:"#9ca3af",marginTop:12 }}>Purchase: 0597147460 | eagleeyefx1@gmail.com</p>
      </div>
    </div>
  );

  function activateLicence() {
    const k = parseLicenceKey(licKey);
    if (!k) { setLicErr("Invalid licence key. Please check it and try again, or contact EduSmart support."); return; }
    if (!k.lifetime && k.expiry && k.expiry < new Date()) { setLicErr("This licence key has expired. Please renew."); return; }
    setLicInfo({ type:k.type, expiry:k.lifetime?null:k.expiry?.toISOString().split("T")[0], lifetime:k.lifetime, key:licKey.trim().toUpperCase() });
    setLicenced(true); setLicErr("");
  }

  // ─── FIRST-RUN SETUP WIZARD ───
  // Runs once: when the licence is active but no staff exist yet (a brand new
  // install). Creates the school profile and the first Admin account.
  if (users.length === 0) return (
    <FirstRunWizard
      onComplete={({ schoolInfo, adminUser }) => {
        setSchool(prev=>({ ...prev, ...schoolInfo }));
        setUsers([adminUser]);
        setAuditLog(p=>[...p,{ id:uid("AUD"), user:adminUser.code, action:"First-run setup completed — school and admin account created", section:"Settings", timestamp:nowStr() }]);
      }}
      licInfo={licInfo}
      cloudSync={cloudSync}
      notify={notify}
    />
  );

  // ─── LOGIN SCREEN ───
  if (!loggedIn) return (
    <div style={{ minHeight:"100vh",background:"linear-gradient(135deg,#0f172a,#1e3a5f)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ background:"#fff",borderRadius:16,padding:40,maxWidth:440,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <div style={{ fontSize:36 }}>🔐</div>
          <h2 style={{ fontSize:22,fontWeight:700,color:"#0f172a",margin:"8px 0 4px" }}>Staff Login</h2>
          <p style={{ color:"#64748b",fontSize:13,margin:"0 0 6px" }}>{school.name}</p>
          <Badge text={`${licInfo?.type?.toUpperCase()} LICENCE${licInfo?.lifetime?" · LIFETIME":""}`} color={licInfo?.type==="pro"?"#166534":"#1d4ed8"} bg={licInfo?.type==="pro"?"#dcfce7":"#dbeafe"}/>
        </div>
        <Row label="Select Your Name">
          <select value={selUser} onChange={e=>setSelUser(e.target.value)} style={inp}>
            <option value="">-- Select name --</option>
            {users.filter(u=>u.active).map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        </Row>
        <Row label="PIN">
          <input type="password" value={pin} onChange={e=>setPin(e.target.value)} placeholder="4-digit PIN"
            style={inp} onKeyDown={e=>e.key==="Enter"&&doLogin()} maxLength={4}/>
        </Row>
        {authErr&&<p style={{ color:"#dc2626",fontSize:13,marginBottom:10 }}>{authErr}</p>}
        <button onClick={doLogin} disabled={loggingIn} style={{ ...btnP,width:"100%",padding:12,fontSize:15,opacity:loggingIn?0.7:1 }}>{loggingIn?"Checking...":"Login"}</button>

        {selUser && isLocked(selUser) && (
          <div style={{ marginTop:14,paddingTop:14,borderTop:"1px solid #e5e7eb" }}>
            {!showRecovery ? (
              <button onClick={()=>setShowRecovery(true)} style={{ background:"none",border:"none",color:"#1e40af",fontSize:12,cursor:"pointer",textDecoration:"underline",padding:0 }}>
                No other Admin available to unlock this account?
              </button>
            ) : (
              <>
                <p style={{ fontSize:12,color:"#64748b",marginBottom:8 }}>Enter your EduSmart licence key to clear all account lockouts. Only the school that purchased this licence has this key.</p>
                <input value={recoveryKey} onChange={e=>setRecoveryKey(e.target.value.toUpperCase())} placeholder="EDU-X-XXXXX-XXXXX-XXXXX" style={{ ...inp,marginBottom:8 }}/>
                <button onClick={()=>{
                  if(recoverWithLicenceKey(recoveryKey)){ setShowRecovery(false); setRecoveryKey(""); setAuthErr(""); }
                  else notify("That licence key doesn't match — lockouts were not cleared.","error");
                }} style={{ ...btnS,width:"100%" }}>Clear All Lockouts</button>
              </>
            )}
          </div>
        )}
        <p style={{ textAlign:"center",fontSize:11,color:"#9ca3af",marginTop:10 }}>EduSmart v{APP_VERSION} | {school.name}</p>
      </div>
    </div>
  );

  // ─── ALERTS ───────────────────────────────────────────────
  const access = ROLE_ACCESS[curUser?.role]||[];
  const activeStudents = students.filter(s=>s.status==="active");

  // 3+ consecutive absences
  const absentAlerts = activeStudents.filter(s=>{
    const sAtt = attendance.filter(a=>a.studentId===s.id).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
    return sAtt.length>=3 && sAtt.every(a=>a.status==="Absent");
  });
  const feeAlerts   = activeStudents.filter(s=>s.fees-s.paid>0);
  const overdueBooks= borrows.filter(b=>!b.returnDate&&b.dueDate<todayStr());
  const noStock     = books.filter(b=>b.available===0);

  // ─── GLOBAL QUICK SEARCH ────────────────────────────────────
  const canSearchStudents = access.includes("students");
  const canSearchStaff = access.includes("staff");
  const quickResults = (() => {
    const q = quickQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const results = [];
    if (canSearchStudents) {
      students.filter(s=>s.name.toLowerCase().includes(q)||s.id.toLowerCase().includes(q)).slice(0,5)
        .forEach(s=>results.push({ kind:"student", id:s.id, label:s.name, sub:`${s.class} · ${s.status}` }));
    }
    if (canSearchStaff) {
      users.filter(u=>u.name.toLowerCase().includes(q)||u.code.toLowerCase().includes(q)).slice(0,5)
        .forEach(u=>results.push({ kind:"staff", id:u.id, label:u.name, sub:`${u.role}${u.classAssigned?" · "+u.classAssigned:""}` }));
    }
    return results.slice(0,8);
  })();

  const jumpTo = (result) => {
    setJumpSearch(result.label);
    setSection(result.kind === "student" ? "students" : "staff");
    setQuickQuery(""); setMobileNavOpen(false);
  };

  const navigate = (key) => { setSection(key); setJumpSearch(""); setMobileNavOpen(false); };

  // ─── NAV ─────────────────────────────────────────────────
  const navItems = [
    { key:"dashboard",     label:"Dashboard",     icon:"📊" },
    { key:"students",      label:"Students",       icon:"🎒" },
    { key:"nursery",       label:"Nursery",        icon:"🍼" },
    { key:"kindergarten",  label:"Kindergarten",   icon:"🧸" },
    { key:"staff",         label:"Staff",          icon:"👥" },
    { key:"grades",        label:"Grades",         icon:"📝" },
    { key:"exams",         label:"Exams",          icon:"📖" },
    { key:"promotion",     label:"Promotion",      icon:"🎓" },
    { key:"history",       label:"History",        icon:"📜" },
    { key:"attendance",    label:"Attendance",     icon:"✅" },
    { key:"finance",       label:"Finance",        icon:"💰" },
    { key:"payroll",       label:"Payroll",        icon:"💼" },
    { key:"library",       label:"Library",        icon:"📚" },
    { key:"timetable",     label:"Timetable",      icon:"📅" },
    { key:"communication", label:"Communication",  icon:"💬" },
    { key:"reports",       label:"Reports",        icon:"📋" },
    { key:"idcards",       label:"ID Cards",       icon:"🪪" },
    { key:"archive",       label:"Archive",        icon:"🗄️" },
    { key:"audit",         label:"Audit Log",      icon:"🔍" },
    { key:"settings",      label:"Settings",       icon:"⚙️" },
  ].filter(n=>access.includes(n.key));

  const alertCount = absentAlerts.length + overdueBooks.length;

  const sharedProps = { school,students,setStudents,users,setUsers,grades,setGrades,mockExams,setMockExams,
    attendance,setAttendance,fees,setFees,expenses,setExpenses,payroll,setPayroll,books,setBooks,borrows,setBorrows,
    nurseryLogs,setNurseryLogs,milestones,setMilestones,examSchedule,setExamSchedule,timetables,setTimetables,
    auditLog,setAuditLog,curUser,notify,addAudit,absentAlerts,feeAlerts,overdueBooks,noStock,unlockUser,failedLogins,
    setSchool,licInfo,classes,setClasses,classLevels,setClassLevels,subjects,setSubjects,yearArchive,setYearArchive,
    cloudSync };

  return (
    <div style={{ display:"flex",minHeight:"100vh",fontFamily:"'Segoe UI',sans-serif",background:"#f1f5f9" }}>
      <style>{`
        @media (max-width: 860px) {
          .edusmart-sidebar { position:fixed !important; left:0; top:0; height:100vh; z-index:400;
            transform: translateX(${mobileNavOpen?"0":"-100%"}); transition: transform 0.25s ease; box-shadow: 4px 0 20px rgba(0,0,0,0.3); }
          .edusmart-hamburger { display:flex !important; }
          .edusmart-main-pad { padding:14px !important; padding-bottom:70px !important; }
          .edusmart-overlay { display:${mobileNavOpen?"block":"none"} !important; }
        }
      `}</style>
      {/* MOBILE OVERLAY */}
      <div className="edusmart-overlay" onClick={()=>setMobileNavOpen(false)}
        style={{ display:"none",position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:399 }}/>

      {/* SIDEBAR */}
      <div className="edusmart-sidebar" style={{ width:210,background:"#0f172a",display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh",overflowY:"auto",flexShrink:0 }}>
        <div style={{ padding:"18px 14px 12px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:20,fontWeight:700,color:"#fff" }}>🏫 EduSmart</div>
            <div style={{ fontSize:11,color:"#64748b",marginTop:2 }}>{school.name}</div>
            <div style={{ fontSize:11,color:"#475569" }}>{school.currentTerm} · {school.currentYear}</div>
          </div>
        </div>
        <div style={{ padding:"8px 0",flex:1 }}>
          {navItems.map(n=>(
            <button key={n.key} onClick={()=>navigate(n.key)}
              style={{ display:"block",width:"100%",textAlign:"left",padding:"9px 16px",
                background:section===n.key?"#1e40af":"transparent",
                color:section===n.key?"#fff":"#94a3b8",border:"none",cursor:"pointer",fontSize:13,
                fontWeight:section===n.key?600:400 }}>
              {n.icon} {n.label}
              {n.key==="dashboard"&&alertCount>0&&<span style={{ float:"right",background:"#dc2626",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:10 }}>{alertCount}</span>}
            </button>
          ))}
        </div>
        <div style={{ padding:12,borderTop:"1px solid #1e293b" }}>
          {cloudSync?.enabled && (
            <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8,fontSize:11 }}>
              <span style={{
                width:8,height:8,borderRadius:"50%",display:"inline-block",
                background:cloudSync.status.phase==="online"?"#22c55e":cloudSync.status.phase==="offline"?"#ef4444":"#f59e0b",
              }}/>
              <span style={{ color:"#94a3b8" }}>
                {cloudSync.status.phase==="online"?"Synced":cloudSync.status.phase==="offline"?"Offline":"Connecting"}
                {cloudSync.status.pending>0?` · ${cloudSync.status.pending} pending`:""}
              </span>
            </div>
          )}
          <div style={{ fontSize:12,color:"#94a3b8",marginBottom:2 }}>{curUser?.name}</div>
          <div style={{ fontSize:11,color:"#475569",marginBottom:6 }}>{curUser?.role} · {curUser?.code}</div>
          <button onClick={doLogout} style={{ width:"100%",padding:7,background:"#7f1d1d",color:"#fca5a5",border:"none",borderRadius:6,cursor:"pointer",fontSize:12 }}>Logout</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex:1,overflow:"auto" }}>
        {/* MOBILE TOP BAR */}
        <div className="edusmart-hamburger" style={{ display:"none",alignItems:"center",gap:10,padding:"12px 16px",background:"#0f172a",position:"sticky",top:0,zIndex:100 }}>
          <button onClick={()=>setMobileNavOpen(true)} style={{ background:"none",border:"none",color:"#fff",fontSize:22,cursor:"pointer",padding:"2px 8px" }}>☰</button>
          <div style={{ color:"#fff",fontSize:14,fontWeight:700 }}>🏫 EduSmart</div>
        </div>
        {notif&&<div style={{ position:"fixed",top:16,right:16,zIndex:9999,padding:"12px 20px",borderRadius:10,
          background:notif.type==="success"?"#16a34a":"#dc2626",color:"#fff",fontSize:13,boxShadow:"0 4px 12px rgba(0,0,0,0.3)" }}>{notif.msg}</div>}

        {/* GLOBAL QUICK SEARCH — jump straight to a student or staff member by name/ID */}
        {(canSearchStudents||canSearchStaff) && (
          <div style={{ padding:"14px 24px 0", position:"relative", maxWidth:420 }}>
            <input value={quickQuery} onChange={e=>setQuickQuery(e.target.value)}
              placeholder="🔍 Quick find a student or staff member..."
              style={{ ...inp, background:"#fff" }}/>
            {quickResults.length>0 && (
              <div style={{ position:"absolute", top:"calc(100% - 4px)", left:24, right:24, background:"#fff", borderRadius:10,
                boxShadow:"0 8px 24px rgba(0,0,0,0.15)", zIndex:200, overflow:"hidden", border:"1px solid #e5e7eb" }}>
                {quickResults.map(r=>(
                  <div key={r.kind+r.id} onClick={()=>jumpTo(r)}
                    style={{ padding:"10px 14px", cursor:"pointer", borderBottom:"1px solid #f1f5f9", display:"flex", justifyContent:"space-between", alignItems:"center" }}
                    onMouseDown={e=>e.preventDefault()}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:"#0f172a" }}>{r.label}</div>
                      <div style={{ fontSize:11, color:"#64748b" }}>{r.sub}</div>
                    </div>
                    <Badge text={r.kind==="student"?"Student":"Staff"} color={r.kind==="student"?"#1d4ed8":"#7c3aed"} bg={r.kind==="student"?"#dbeafe":"#ede9fe"}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="edusmart-main-pad" style={{ padding:24 }}>
          {section==="dashboard"    && <Dashboard    {...sharedProps}/>}
          {section==="students"     && <Students     {...sharedProps} initialSearch={jumpSearch}/>}
          {section==="nursery"      && <Nursery      {...sharedProps} levelFilter={["Nursery"]} pageTitle="Nursery" pageIcon="🍼"/>}
          {section==="kindergarten" && <Nursery      {...sharedProps} levelFilter={["Kindergarten"]} pageTitle="Kindergarten" pageIcon="🧸"/>}
          {section==="staff"        && <Staff        {...sharedProps} initialSearch={jumpSearch}/>}
          {section==="grades"       && <Grades       {...sharedProps}/>}
          {section==="exams"        && <Exams        {...sharedProps}/>}
          {section==="promotion"    && <Promotion    {...sharedProps}/>}
          {section==="history"      && <YearHistory  {...sharedProps}/>}
          {section==="attendance"   && <Attendance   {...sharedProps}/>}
          {section==="finance"      && <Finance      {...sharedProps}/>}
          {section==="payroll"      && <Payroll      {...sharedProps}/>}
          {section==="library"      && <Library      {...sharedProps}/>}
          {section==="timetable"    && <Timetable    {...sharedProps}/>}
          {section==="communication"&& <Communication {...sharedProps}/>}
          {section==="reports"      && <Reports      {...sharedProps}/>}
          {section==="idcards"      && <IDCards      {...sharedProps}/>}
          {section==="archive"      && <Archive      {...sharedProps}/>}
          {section==="audit"        && <AuditLog     {...sharedProps}/>}
          {section==="settings"     && <Settings     {...sharedProps}/>}
        </div>
      </div>
    </div>
  );
}

// ─── FIRST-RUN SETUP WIZARD ────────────────────────────────────
// Shown once on a brand new install: no staff exist yet, so there's no one
// to log in as. Branches into two paths: a genuinely new school (the
// original flow — School Profile → Create Admin Account), or adding
// another device to a school that's already using EduSmart elsewhere
// (just a Connect Code — no school details or admin account needed,
// since that data already exists in the cloud).
function FirstRunWizard({ onComplete, licInfo, cloudSync, notify }) {
  const [path, setPath] = useState(null); // null | "new" | "join"
  const [step, setStep] = useState(1);
  const [schoolInfo, setSchoolInfo] = useState({ name:"", address:"", phone:"", email:"", motto:"", currentYear:"", principalName:"" });
  const [admin, setAdmin] = useState({ name:"", pin:"", confirmPin:"", email:"" });
  const [err, setErr] = useState("");
  const [connectCodeInput, setConnectCodeInput] = useState("");
  const [joining, setJoining] = useState(false);

  const nextFromSchool = () => {
    if (!schoolInfo.name.trim()) { setErr("Enter your school's name to continue."); return; }
    setErr(""); setStep(2);
  };

  const finish = () => {
    if (!admin.name.trim()) { setErr("Enter your name."); return; }
    if (!/^\d{4}$/.test(admin.pin)) { setErr("PIN must be exactly 4 digits."); return; }
    if (admin.pin !== admin.confirmPin) { setErr("PINs don't match."); return; }
    setErr("");
    const adminUser = {
      id: uid("USR"), name: admin.name.trim(), role: "Admin", pin: admin.pin,
      code: "ADM001", email: admin.email.trim(), active: true,
      salary: 0, transport: 0, housing: 0, ssnit: true,
    };
    onComplete({
      schoolInfo: { ...schoolInfo, principalName: schoolInfo.principalName || admin.name.trim() },
      adminUser,
    });
  };

  const handleJoin = async () => {
    if (!connectCodeInput.trim()) { setErr("Paste the Connect Code you were given."); return; }
    setJoining(true); setErr("");
    try {
      await cloudSync.joinWithConnectCode(connectCodeInput.trim());
      // No onComplete() call here — joining pulls real staff down
      // directly into app state, so the app naturally proceeds straight
      // to the normal staff login screen once this component unmounts
      // (users.length is no longer 0).
    } catch (e) {
      setJoining(false);
      setErr(e?.message || "Couldn't connect with that code. Double-check it and try again.");
    }
  };

  // ─── Path chooser ───
  if (!path) return (
    <div style={{ minHeight:"100vh",background:"linear-gradient(135deg,#0f172a,#1e3a5f)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',sans-serif",padding:16 }}>
      <div style={{ background:"#fff",borderRadius:16,padding:40,maxWidth:480,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign:"center",marginBottom:28 }}>
          <div style={{ fontSize:44 }}>🎉</div>
          <h1 style={{ fontSize:24,fontWeight:700,color:"#0f172a",margin:"8px 0 4px" }}>Welcome to EduSmart</h1>
          <p style={{ color:"#64748b",margin:0,fontSize:13 }}>Is this a new school, or are you adding a device to a school already using EduSmart?</p>
        </div>
        <button onClick={()=>setPath("new")} style={{ ...btnP,width:"100%",padding:16,fontSize:15,marginBottom:12,textAlign:"left" }}>
          🏫 New School<div style={{ fontWeight:400,fontSize:12,opacity:0.85,marginTop:4 }}>Set up EduSmart for the first time — school profile and your admin account</div>
        </button>
        <button onClick={()=>setPath("join")} style={{ ...btnS,width:"100%",padding:16,fontSize:15,textAlign:"left" }}>
          💻 Add This Device<div style={{ fontWeight:400,fontSize:12,color:"#64748b",marginTop:4 }}>This school already uses EduSmart elsewhere — connect with a Connect Code</div>
        </button>
      </div>
    </div>
  );

  // ─── Join an existing school ───
  if (path === "join") return (
    <div style={{ minHeight:"100vh",background:"linear-gradient(135deg,#0f172a,#1e3a5f)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',sans-serif",padding:16 }}>
      <div style={{ background:"#fff",borderRadius:16,padding:40,maxWidth:480,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <div style={{ fontSize:40 }}>💻</div>
          <h1 style={{ fontSize:22,fontWeight:700,color:"#0f172a",margin:"8px 0 4px" }}>Add This Device</h1>
          <p style={{ color:"#64748b",margin:0,fontSize:13 }}>Enter the Connect Code from a device that's already set up for this school (Settings → Cloud Sync).</p>
        </div>
        <Row label="Connect Code">
          <textarea value={connectCodeInput} onChange={e=>setConnectCodeInput(e.target.value)} style={{ ...inp,height:80,fontFamily:"monospace",fontSize:12,resize:"vertical" }} placeholder="EDUCONNECT-..."/>
        </Row>
        {err&&<p style={{ color:"#dc2626",fontSize:13,marginBottom:10 }}>{err}</p>}
        {err&&(
          <button onClick={()=>{cloudSync.disable();setErr("");notify("This device has been reset — try Connect again.");}}
            style={{ background:"none",border:"none",color:"#1e40af",fontSize:12,cursor:"pointer",textDecoration:"underline",padding:0,marginBottom:14,display:"block" }}>
            Stuck, or tried before and it didn't work? Reset this device and try again
          </button>
        )}
        <div style={{ display:"flex",gap:8 }}>
          <button onClick={()=>{setPath(null);setErr("");}} style={{ ...btnS,flex:1 }} disabled={joining}>← Back</button>
          <button onClick={handleJoin} style={{ ...btnP,flex:2,opacity:joining?0.7:1 }} disabled={joining}>{joining?"Connecting...":"Connect This Device"}</button>
        </div>
      </div>
    </div>
  );

  // ─── New school setup (original flow, unchanged) ───
  return (
    <div style={{ minHeight:"100vh",background:"linear-gradient(135deg,#0f172a,#1e3a5f)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Segoe UI',sans-serif",padding:16 }}>
      <div style={{ background:"#fff",borderRadius:16,padding:40,maxWidth:480,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <div style={{ fontSize:44 }}>🎉</div>
          <h1 style={{ fontSize:24,fontWeight:700,color:"#0f172a",margin:"8px 0 4px" }}>Welcome to EduSmart</h1>
          <p style={{ color:"#64748b",margin:0,fontSize:13 }}>Let's set up your school — {step===1?"Step 1 of 2":"Step 2 of 2"}</p>
        </div>

        {step===1 && (
          <>
            <h3 style={{ fontSize:15,margin:"0 0 14px",color:"#0f172a" }}>🏫 School Profile</h3>
            <Row label="School Name"><input value={schoolInfo.name} onChange={e=>setSchoolInfo(p=>({...p,name:e.target.value}))} style={inp} placeholder="e.g. Eikwe Private Basic School"/></Row>
            <Row label="Address"><input value={schoolInfo.address} onChange={e=>setSchoolInfo(p=>({...p,address:e.target.value}))} style={inp} placeholder="e.g. Eikwe, Western Region, Ghana"/></Row>
            <Row label="Phone"><input value={schoolInfo.phone} onChange={e=>setSchoolInfo(p=>({...p,phone:e.target.value}))} style={inp}/></Row>
            <Row label="Email"><input value={schoolInfo.email} onChange={e=>setSchoolInfo(p=>({...p,email:e.target.value}))} style={inp}/></Row>
            <Row label="Academic Year"><input value={schoolInfo.currentYear} onChange={e=>setSchoolInfo(p=>({...p,currentYear:e.target.value}))} style={inp} placeholder="e.g. 2025/2026"/></Row>
            {err&&<p style={{ color:"#dc2626",fontSize:13,marginBottom:10 }}>{err}</p>}
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={()=>setPath(null)} style={{ ...btnS,flex:1 }}>← Back</button>
              <button onClick={nextFromSchool} style={{ ...btnP,flex:2 }}>Continue →</button>
            </div>
          </>
        )}

        {step===2 && (
          <>
            <h3 style={{ fontSize:15,margin:"0 0 14px",color:"#0f172a" }}>👤 Create Your Admin Account</h3>
            <p style={{ fontSize:12,color:"#64748b",marginBottom:14 }}>This is your own login — you'll use it every time you open EduSmart, and you can add other staff accounts once you're in.</p>
            <Row label="Your Full Name"><input value={admin.name} onChange={e=>setAdmin(p=>({...p,name:e.target.value}))} style={inp} placeholder="e.g. Gilbert Oscar Prah"/></Row>
            <Row label="Email (optional)"><input value={admin.email} onChange={e=>setAdmin(p=>({...p,email:e.target.value}))} style={inp}/></Row>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              <Row label="Choose a 4-digit PIN"><input type="password" maxLength={4} value={admin.pin} onChange={e=>setAdmin(p=>({...p,pin:e.target.value.replace(/\D/g,"")}))} style={inp}/></Row>
              <Row label="Confirm PIN"><input type="password" maxLength={4} value={admin.confirmPin} onChange={e=>setAdmin(p=>({...p,confirmPin:e.target.value.replace(/\D/g,"")}))} style={inp}/></Row>
            </div>
            {err&&<p style={{ color:"#dc2626",fontSize:13,marginBottom:10 }}>{err}</p>}
            <div style={{ display:"flex",gap:8,marginTop:8 }}>
              <button onClick={()=>setStep(1)} style={{ ...btnS,flex:1 }}>← Back</button>
              <button onClick={finish} style={{ ...btnP,flex:2 }}>Finish Setup</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function Dashboard({ school,students,fees,expenses,attendance,grades,books,borrows,users,curUser,absentAlerts,feeAlerts,overdueBooks,noStock,payroll,examSchedule,mockExams }) {
  if (curUser?.role === "Teacher") {
    return <TeacherDashboard school={school} students={students} grades={grades} attendance={attendance}
      examSchedule={examSchedule} mockExams={mockExams} curUser={curUser}/>;
  }
  const active = students.filter(s=>s.status==="active");
  const totalPaid = fees.reduce((a,f)=>a+f.paid,0);
  const totalExp  = expenses.reduce((a,e)=>a+e.amount,0);
  const todayAtt  = attendance.filter(a=>a.date===todayStr());
  const present   = todayAtt.filter(a=>a.status==="Present").length;
  const classPerf = {};
  grades.forEach(g=>{ const s=students.find(x=>x.id===g.studentId); if(s){ if(!classPerf[s.class])classPerf[s.class]=[]; classPerf[s.class].push(g.score); }});
  const bestClass = Object.entries(classPerf).sort((a,b)=>{ const av=arr=>arr.reduce((x,y)=>x+y,0)/arr.length; return av(b[1])-av(a[1]); })[0];

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:22,fontWeight:700,color:"#0f172a",margin:0 }}>Good day, {curUser?.name.split(" ")[0]} 👋</h2>
        <p style={{ color:"#64748b",margin:"4px 0 0",fontSize:13 }}>{school.name} · {school.currentTerm} {school.currentYear}</p>
      </div>

      {/* ALERTS */}
      {(absentAlerts.length>0||overdueBooks.length>0||noStock.length>0)&&(
        <div style={{ marginBottom:20 }}>
          {absentAlerts.map(s=>(
            <div key={s.id} style={{ background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:10,padding:"10px 16px",marginBottom:8,fontSize:13,color:"#9a3412" }}>
              ⚠️ <strong>{s.name}</strong> ({s.class}) has been absent 3+ consecutive days
            </div>
          ))}
          {overdueBooks.map(b=>{ const bk=books?.find(x=>x.id===b.bookId); return (
            <div key={b.id} style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 16px",marginBottom:8,fontSize:13,color:"#991b1b" }}>
              📚 Overdue: <strong>{bk?.title}</strong> — due {b.dueDate}
            </div>
          );})}
          {noStock.map(b=>(
            <div key={b.id} style={{ background:"#fef9c3",border:"1px solid #fde047",borderRadius:10,padding:"10px 16px",marginBottom:8,fontSize:13,color:"#713f12" }}>
              📦 Out of stock: <strong>{b.title}</strong> (0 copies available)
            </div>
          ))}
        </div>
      )}

      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12,marginBottom:24 }}>
        <StatCard icon="🎒" label="Active Students"  value={active.length}              color="#3b82f6"/>
        <StatCard icon="👥" label="Active Staff"     value={users.filter(u=>u.active).length} color="#8b5cf6"/>
        <StatCard icon="💰" label="Fees Collected"   value={formatGHS(totalPaid)}        color="#10b981"/>
        <StatCard icon="📤" label="Total Expenses"   value={formatGHS(totalExp)}          color="#f59e0b"/>
        <StatCard icon="🏦" label="Net Balance"      value={formatGHS(totalPaid-totalExp)} color={(totalPaid-totalExp)>=0?"#0369a1":"#dc2626"}/>
        <StatCard icon="✅" label="Present Today"    value={`${present}/${active.length}`} color="#0ea5e9"/>
        <StatCard icon="⚠️" label="Fee Arrears"      value={feeAlerts.length}             color="#ef4444" sub="students with balance"/>
        <StatCard icon="📚" label="Overdue Books"    value={overdueBooks.length}          color="#dc2626"/>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16 }}>
        <Card style={{ padding:18 }}>
          <h3 style={{ margin:"0 0 12px",fontSize:15,color:"#0f172a" }}>📊 Class Performance</h3>
          {Object.entries(classPerf).slice(0,6).map(([cls,scores])=>{
            const avg=Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
            return (
              <div key={cls} style={{ marginBottom:8 }}>
                <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3 }}>
                  <span>{cls}</span><span style={{ fontWeight:600,color:avg>=70?"#16a34a":avg>=50?"#d97706":"#dc2626" }}>{avg}%</span>
                </div>
                <div style={{ height:6,background:"#f1f5f9",borderRadius:4 }}>
                  <div style={{ height:6,borderRadius:4,background:avg>=70?"#16a34a":avg>=50?"#f59e0b":"#dc2626",width:`${avg}%` }}/>
                </div>
              </div>
            );
          })}
          {bestClass&&<p style={{ margin:"10px 0 0",fontSize:12,color:"#0369a1" }}>🏆 Best: <strong>{bestClass[0]}</strong> ({Math.round(bestClass[1].reduce((a,b)=>a+b,0)/bestClass[1].length)}% avg)</p>}
        </Card>
        <Card style={{ padding:18 }}>
          <h3 style={{ margin:"0 0 12px",fontSize:15,color:"#0f172a" }}>💸 Fee Arrears</h3>
          {feeAlerts.slice(0,6).map(s=>(
            <div key={s.id} style={{ display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
              <span>{s.name} <span style={{ color:"#9ca3af",fontSize:11 }}>({s.class})</span></span>
              <span style={{ color:"#dc2626",fontWeight:600 }}>{formatGHS(s.fees-s.paid)}</span>
            </div>
          ))}
          {feeAlerts.length===0&&<p style={{ color:"#16a34a",fontSize:13 }}>✅ All fees cleared!</p>}
        </Card>
      </div>
    </div>
  );
}

// ─── TEACHER DASHBOARD ─────────────────────────────────────────
// A focused view for Teacher-role users: their own class only, not the whole school.
function TeacherDashboard({ school,students,grades,attendance,examSchedule,mockExams,curUser }) {
  const myClass = curUser?.classAssigned;
  const roster = students.filter(s=>s.status==="active" && s.class===myClass);
  const todayAtt = attendance.filter(a=>a.class===myClass && a.date===todayStr());
  const present = todayAtt.filter(a=>a.status==="Present").length;
  const absent = todayAtt.filter(a=>a.status==="Absent").length;
  const marked = todayAtt.length;

  const classGrades = grades.filter(g=>g.class===myClass);
  const currentTermGrades = classGrades.filter(g=>g.term===school.currentTerm && g.year===school.currentYear);
  const classAvg = currentTermGrades.length ? Math.round(currentTermGrades.reduce((a,g)=>a+g.score,0)/currentTermGrades.length) : null;

  // per-student average for this term, to find top/at-risk performers
  const studentAverages = roster.map(s=>{
    const sg = currentTermGrades.filter(g=>g.studentId===s.id);
    const avg = sg.length ? Math.round(sg.reduce((a,g)=>a+g.score,0)/sg.length) : null;
    return { ...s, avg, gradeCount:sg.length };
  });
  const ranked = studentAverages.filter(s=>s.avg!==null).sort((a,b)=>b.avg-a.avg);
  const topPerformers = ranked.slice(0,5);
  const needsAttention = ranked.slice(-5).reverse().filter(s=>s.avg<60);
  const noGradesYet = studentAverages.filter(s=>s.avg===null);

  // attendance rate per student (all-time) — flag anyone under 75%
  const lowAttendance = roster.map(s=>{
    const all = attendance.filter(a=>a.studentId===s.id);
    const rate = all.length ? Math.round(all.filter(a=>a.status==="Present").length/all.length*100) : 100;
    return { ...s, rate, total:all.length };
  }).filter(s=>s.total>0 && s.rate<75).sort((a,b)=>a.rate-b.rate);

  const upcomingExams = (examSchedule||[]).filter(e=>e.class===myClass && e.date>=todayStr()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);

  if (!myClass) {
    return (
      <div>
        <h2 style={{ fontSize:22,fontWeight:700,color:"#0f172a",margin:0 }}>Good day, {curUser?.name.split(" ")[0]} 👋</h2>
        <p style={{ color:"#64748b",marginTop:10 }}>You don't have a class assigned yet. Contact an Admin to assign you a class.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:22,fontWeight:700,color:"#0f172a",margin:0 }}>Good day, {curUser?.name.split(" ")[0]} 👋</h2>
        <p style={{ color:"#64748b",margin:"4px 0 0",fontSize:13 }}>{school.name} · {school.currentTerm} {school.currentYear} · Class Teacher: <strong>{myClass}</strong></p>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12,marginBottom:24 }}>
        <StatCard icon="🎒" label="Class Size" value={roster.length} color="#3b82f6"/>
        <StatCard icon="✅" label="Present Today" value={marked?`${present}/${roster.length}`:"Not marked"} color="#0ea5e9"/>
        <StatCard icon="❌" label="Absent Today" value={marked?absent:"—"} color="#dc2626"/>
        <StatCard icon="📊" label="Class Average" value={classAvg!==null?classAvg+"%":"No grades yet"} color={classAvg===null?"#9ca3af":classAvg>=70?"#16a34a":classAvg>=50?"#d97706":"#dc2626"}/>
        <StatCard icon="⚠️" label="Low Attendance" value={lowAttendance.length} color="#ef4444" sub="students under 75%"/>
        <StatCard icon="📖" label="Upcoming Exams" value={upcomingExams.length} color="#7c3aed"/>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16 }}>
        <Card style={{ padding:18 }}>
          <h3 style={{ margin:"0 0 12px",fontSize:15,color:"#0f172a" }}>🏆 Top Performers ({school.currentTerm})</h3>
          {topPerformers.length>0 ? topPerformers.map((s,i)=>(
            <div key={s.id} style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
              <span>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`} {s.name}</span>
              <span style={{ fontWeight:700,color:"#16a34a" }}>{s.avg}%</span>
            </div>
          )) : <p style={{ fontSize:13,color:"#9ca3af" }}>No grades entered for {school.currentTerm} yet.</p>}
        </Card>
        <Card style={{ padding:18 }}>
          <h3 style={{ margin:"0 0 12px",fontSize:15,color:"#0f172a" }}>⚠️ Needs Attention</h3>
          {needsAttention.length>0 ? needsAttention.map(s=>(
            <div key={s.id} style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
              <span>{s.name}</span>
              <span style={{ fontWeight:700,color:"#dc2626" }}>{s.avg}%</span>
            </div>
          )) : <p style={{ fontSize:13,color:"#16a34a" }}>✅ No students scoring below 60% this term.</p>}
          {noGradesYet.length>0&&<p style={{ fontSize:11,color:"#94a3b8",marginTop:10 }}>{noGradesYet.length} student(s) have no grades entered yet this term.</p>}
        </Card>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
        <Card style={{ padding:18 }}>
          <h3 style={{ margin:"0 0 12px",fontSize:15,color:"#0f172a" }}>📉 Attendance Concerns</h3>
          {lowAttendance.length>0 ? lowAttendance.slice(0,6).map(s=>(
            <div key={s.id} style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
              <span>{s.name}</span>
              <span style={{ fontWeight:700,color:"#dc2626" }}>{s.rate}%</span>
            </div>
          )) : <p style={{ fontSize:13,color:"#16a34a" }}>✅ Everyone's attending well.</p>}
        </Card>
        <Card style={{ padding:18 }}>
          <h3 style={{ margin:"0 0 12px",fontSize:15,color:"#0f172a" }}>📖 Upcoming Exams</h3>
          {upcomingExams.length>0 ? upcomingExams.map(e=>(
            <div key={e.id} style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
              <span>{e.subject}</span>
              <span style={{ color:"#64748b" }}>{e.date} · {e.startTime}</span>
            </div>
          )) : <p style={{ fontSize:13,color:"#9ca3af" }}>No exams scheduled for {myClass} yet.</p>}
        </Card>
      </div>
    </div>
  );
}


function Students({ students,setStudents,notify,addAudit,curUser,classes,classLevels,initialSearch,cloudSync }) {
  const [search,setSearch]=useState(initialSearch||""); const [fc,setFc]=useState(""); const [fs,setFs]=useState("all");
  const [showForm,setShowForm]=useState(false); const [editId,setEditId]=useState(null);
  const blank = { name:"",class:"Class 1A",dob:"",gender:"Male",guardian:"",phone:"",fees:500,paid:0,status:"active",section:"primary",photo:"" };
  const [form,setForm]=useState(blank);

  const filtered = students.filter(s=>{
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase())||s.id.includes(search);
    const matchClass  = !fc||s.class===fc;
    const matchStatus = fs==="all"||s.status===fs;
    return matchSearch&&matchClass&&matchStatus;
  });
  const sort = useSort(filtered, "name");

  const save = () => {
    if(!form.name||!form.class){ notify("Name and Class required","error"); return; }
    const section = KG_CLASSES.includes(form.class)?"nursery":JHS_CLASSES.includes(form.class)?"jhs":"primary";
    if(editId){
      const updated = {...students.find(s=>s.id===editId),...form,section};
      setStudents(p=>p.map(s=>s.id===editId?updated:s));
      cloudSync?.writeThrough("students", updated);
      addAudit(`Edited: ${form.name}`,"Students"); notify("Student updated");
    } else {
      const newStudent = {...form,section,id:uid("STU")};
      setStudents(p=>[...p,newStudent]);
      cloudSync?.writeThrough("students", newStudent);
      addAudit(`Added: ${form.name}`,"Students"); notify("Student added");
    }
    setShowForm(false); setEditId(null); setForm(blank);
  };

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <h2 style={{ margin:0,fontSize:20,fontWeight:700,color:"#0f172a" }}>🎒 Students</h2>
        <button onClick={()=>{setShowForm(true);setEditId(null);setForm(blank);}} style={btnP}>+ Add Student</button>
      </div>
      <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name/ID..." style={{ ...inp,width:200 }}/>
        <select value={fc} onChange={e=>setFc(e.target.value)} style={{ ...inp,width:160 }}>
          <option value="">All Classes</option>
          {classes.map(c=><option key={c}>{c}</option>)}
        </select>
        <select value={fs} onChange={e=>setFs(e.target.value)} style={{ ...inp,width:140 }}>
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="dropout">Dropout</option>
          <option value="graduated">Graduated</option>
        </select>
      </div>
      {showForm&&(
        <Modal title={editId?"Edit Student":"Add Student"} onClose={()=>{setShowForm(false);setEditId(null);}}>
          <Row label="Photo"><PhotoUpload value={form.photo} onChange={p=>setForm(prev=>({...prev,photo:p}))}/></Row>
          <Row label="Full Name"><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={inp}/></Row>
          <Row label="Class"><select value={form.class} onChange={e=>setForm(p=>({...p,class:e.target.value}))} style={inp}>{classes.map(c=><option key={c}>{c}</option>)}</select></Row>
          <Row label="Date of Birth"><input type="date" value={form.dob} onChange={e=>setForm(p=>({...p,dob:e.target.value}))} style={inp}/></Row>
          <Row label="Gender"><select value={form.gender} onChange={e=>setForm(p=>({...p,gender:e.target.value}))} style={inp}><option>Male</option><option>Female</option></select></Row>
          <Row label="Guardian Name"><input value={form.guardian} onChange={e=>setForm(p=>({...p,guardian:e.target.value}))} style={inp}/></Row>
          <Row label="Guardian Phone"><input value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} style={inp}/></Row>
          <Row label="Fees (GH₵)"><input type="number" value={form.fees} onChange={e=>setForm(p=>({...p,fees:+e.target.value}))} style={inp}/></Row>
          <Row label="Amount Paid (GH₵)"><input type="number" value={form.paid} onChange={e=>setForm(p=>({...p,paid:+e.target.value}))} style={inp}/></Row>
          <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:16 }}>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={btnS}>Cancel</button>
            <button onClick={save} style={btnP}>Save</button>
          </div>
        </Modal>
      )}
      <Table cols={["ID","Name","Class","Gender","Guardian","Phone","Fees","Paid","Balance","Status","Actions"]}
        colKeys={[null,"name","class","gender","guardian","phone","fees","paid",null,"status",null]}
        sortState={sort}
        rows={sort.sorted.map(s=>(
          <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
            <TD small color="#6b7280">{s.id}</TD>
            <TD bold>{s.name}</TD>
            <TD>{s.class}</TD>
            <TD>{s.gender}</TD>
            <TD>{s.guardian}</TD>
            <TD small>{s.phone}</TD>
            <TD>{formatGHS(s.fees)}</TD>
            <TD color="#16a34a" bold>{formatGHS(s.paid)}</TD>
            <TD color={s.fees-s.paid>0?"#dc2626":"#16a34a"} bold>{formatGHS(s.fees-s.paid)}</TD>
            <td style={{ padding:"8px 12px" }}>
              <Badge text={s.status} color={s.status==="active"?"#166534":s.status==="graduated"?"#1d4ed8":"#991b1b"} bg={s.status==="active"?"#dcfce7":s.status==="graduated"?"#dbeafe":"#fee2e2"}/>
            </td>
            <td style={{ padding:"8px 12px",display:"flex",gap:4 }}>
              <button onClick={()=>{setEditId(s.id);setForm({name:s.name,class:s.class,dob:s.dob||"",gender:s.gender,guardian:s.guardian,phone:s.phone,fees:s.fees,paid:s.paid,status:s.status,photo:s.photo||""});setShowForm(true);}} style={{ ...btnSm,background:"#dbeafe",color:"#1d4ed8" }}>Edit</button>
              {s.status==="active"&&<button onClick={()=>{if(confirm(`Mark ${s.name} as dropout?`)){setStudents(p=>p.map(x=>x.id===s.id?{...x,status:"dropout"}:x));addAudit(`Dropout: ${s.name}`,"Students");notify("Moved to archive");}}} style={{ ...btnSm,background:"#fee2e2",color:"#991b1b" }}>Dropout</button>}
            </td>
          </tr>
        ))} emptyMsg="No students found."/>
      <p style={{ fontSize:12,color:"#94a3b8",marginTop:8 }}>{filtered.length} records shown</p>
    </div>
  );
}

// ─── NURSERY / KG ────────────────────────────────────────────
function Nursery({ students,nurseryLogs,setNurseryLogs,milestones,setMilestones,curUser,notify,addAudit,classLevels,levelFilter,pageTitle,pageIcon }) {
  const [tab,setTab]=useState("daily");
  const [selStu,setSelStu]=useState("");
  const [selDate,setSelDate]=useState(todayStr());
  const [selTerm,setSelTerm]=useState("Term 2");
  const [showLog,setShowLog]=useState(false);
  const [showMilestone,setShowMilestone]=useState(false);
  const blank = { napStart:"",napEnd:"",feedingTimes:"",feedingNotes:"",hygiene:"No incidents",mood:"Happy",notes:"" };
  const [logForm,setLogForm]=useState(blank);
  const [msForm,setMsForm]=useState({ category:"Motor Skills",milestone:"",rating:"Emerging" });

  // levelFilter: array of level names this page covers, e.g. ["Nursery"] or ["Kindergarten"].
  // Falls back to the old combined Nursery+KG group if not provided (backward compatible).
  const kgStudents = students.filter(s=>s.status==="active"&&(
    levelFilter ? levelFilter.includes(classLevels?.[s.class]) : KG_CLASSES.includes(s.class)
  ));
  const selStudent  = students.find(s=>s.id===selStu);
  const stuLogs     = nurseryLogs.filter(l=>l.studentId===selStu).sort((a,b)=>b.date.localeCompare(a.date));
  const stuMilestones= milestones.filter(m=>m.studentId===selStu);

  const saveLog = () => {
    const existing = nurseryLogs.find(l=>l.studentId===selStu&&l.date===selDate);
    if(existing){ setNurseryLogs(p=>p.map(l=>l.id===existing.id?{...l,...logForm,enteredBy:curUser.code}:l)); }
    else { setNurseryLogs(p=>[...p,{id:uid("NRS"),studentId:selStu,date:selDate,...logForm,enteredBy:curUser.code}]); }
    addAudit(`Daily log: ${selStudent?.name} ${selDate}`,"Nursery"); notify("Log saved"); setShowLog(false); setLogForm(blank);
  };

  const saveMilestone = () => {
    if(!msForm.milestone){ notify("Select milestone","error"); return; }
    const existing = milestones.find(m=>m.studentId===selStu&&m.milestone===msForm.milestone&&m.term===selTerm);
    if(existing){ setMilestones(p=>p.map(m=>m.id===existing.id?{...m,rating:msForm.rating,enteredBy:curUser.code,date:todayStr()}:m)); }
    else { setMilestones(p=>[...p,{id:uid("MLS"),studentId:selStu,term:selTerm,year:"2024/2025",...msForm,enteredBy:curUser.code,date:todayStr()}]); }
    addAudit(`Milestone: ${selStudent?.name}`,"Nursery"); notify("Milestone saved"); setShowMilestone(false);
  };

  const ratingColor = r=>r==="Achieved"?"#16a34a":r==="Developing"?"#0369a1":r==="Emerging"?"#d97706":"#9ca3af";

  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>{pageIcon||"🍼"} {pageTitle||"Nursery & KG"}</h2>
      <div style={{ display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center" }}>
        <select value={selStu} onChange={e=>setSelStu(e.target.value)} style={{ ...inp,width:220 }}>
          <option value="">Select child</option>
          {kgStudents.map(s=><option key={s.id} value={s.id}>{s.name} — {s.class}</option>)}
        </select>
        <Tabs tabs={[{key:"daily",label:"📋 Daily Log"},{key:"milestones",label:"🌟 Milestones"},{key:"report",label:"📄 KG Report"}]} active={tab} onChange={setTab}/>
      </div>

      {!selStu&&<div style={{ background:"#f0f9ff",borderRadius:12,padding:32,textAlign:"center",color:"#0369a1" }}><div style={{ fontSize:40,marginBottom:8 }}>{pageIcon||"🍼"}</div><p>Select a child above to view or enter records</p><p style={{ fontSize:13,color:"#64748b" }}>{kgStudents.length} {pageTitle||"Nursery/KG"} children enrolled</p></div>}

      {selStu&&tab==="daily"&&(
        <div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
            <div style={{ display:"flex",gap:8,alignItems:"center" }}>
              <input type="date" value={selDate} onChange={e=>setSelDate(e.target.value)} style={{ ...inp,width:170 }}/>
            </div>
            <button onClick={()=>{const e=nurseryLogs.find(l=>l.studentId===selStu&&l.date===selDate);if(e)setLogForm({napStart:e.napStart,napEnd:e.napEnd,feedingTimes:e.feedingTimes,feedingNotes:e.feedingNotes,hygiene:e.hygiene,mood:e.mood,notes:e.notes});else setLogForm(blank);setShowLog(true);}} style={btnP}>+ Add/Edit Log</button>
          </div>
          {showLog&&(
            <Modal title={`Daily Log — ${selStudent?.name} — ${selDate}`} onClose={()=>setShowLog(false)}>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <Row label="Nap Start"><input type="time" value={logForm.napStart} onChange={e=>setLogForm(p=>({...p,napStart:e.target.value}))} style={inp}/></Row>
                <Row label="Nap End"><input type="time" value={logForm.napEnd} onChange={e=>setLogForm(p=>({...p,napEnd:e.target.value}))} style={inp}/></Row>
              </div>
              <Row label="Feeding Times (e.g. 07:30, 12:00)"><input value={logForm.feedingTimes} onChange={e=>setLogForm(p=>({...p,feedingTimes:e.target.value}))} style={inp}/></Row>
              <Row label="Feeding Notes"><input value={logForm.feedingNotes} onChange={e=>setLogForm(p=>({...p,feedingNotes:e.target.value}))} style={inp}/></Row>
              <Row label="Hygiene / Potty"><select value={logForm.hygiene} onChange={e=>setLogForm(p=>({...p,hygiene:e.target.value}))} style={inp}>
                {["No incidents","1 accident","2+ accidents","Used potty successfully","Needed assistance"].map(o=><option key={o}>{o}</option>)}
              </select></Row>
              <Row label="Mood"><select value={logForm.mood} onChange={e=>setLogForm(p=>({...p,mood:e.target.value}))} style={inp}>
                {["Happy","Calm","Fussy","Crying","Tired","Energetic","Anxious"].map(o=><option key={o}>{o}</option>)}
              </select></Row>
              <Row label="Notes"><textarea value={logForm.notes} onChange={e=>setLogForm(p=>({...p,notes:e.target.value}))} style={{ ...inp,height:60,resize:"vertical" }}/></Row>
              <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}>
                <button onClick={()=>setShowLog(false)} style={btnS}>Cancel</button>
                <button onClick={saveLog} style={btnP}>Save Log</button>
              </div>
            </Modal>
          )}
          <div style={{ display:"grid",gap:10 }}>
            {stuLogs.slice(0,10).map(l=>(
              <Card key={l.id} style={{ padding:16 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                  <strong style={{ color:"#0f172a" }}>{l.date}</strong>
                  <div style={{ display:"flex",gap:8 }}>
                    <Badge text={l.mood} color="#0369a1" bg="#dbeafe"/>
                    <Badge text={l.hygiene} color={l.hygiene==="No incidents"?"#166534":"#991b1b"} bg={l.hygiene==="No incidents"?"#dcfce7":"#fee2e2"}/>
                  </div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,fontSize:13 }}>
                  <div><span style={{ color:"#64748b" }}>Nap:</span> {l.napStart||"—"} – {l.napEnd||"—"}</div>
                  <div><span style={{ color:"#64748b" }}>Feeding:</span> {l.feedingTimes||"—"}</div>
                  <div><span style={{ color:"#64748b" }}>Entered by:</span> {l.enteredBy}</div>
                </div>
                {l.feedingNotes&&<p style={{ margin:"8px 0 0",fontSize:12,color:"#64748b" }}>🍽️ {l.feedingNotes}</p>}
                {l.notes&&<p style={{ margin:"4px 0 0",fontSize:12,color:"#475569" }}>📝 {l.notes}</p>}
              </Card>
            ))}
            {stuLogs.length===0&&<div style={{ textAlign:"center",color:"#9ca3af",padding:32 }}>No logs yet for {selStudent?.name}</div>}
          </div>
        </div>
      )}

      {selStu&&tab==="milestones"&&(
        <div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
            <select value={selTerm} onChange={e=>setSelTerm(e.target.value)} style={{ ...inp,width:140 }}>
              <option>Term 1</option><option>Term 2</option><option>Term 3</option>
            </select>
            <button onClick={()=>setShowMilestone(true)} style={btnP}>+ Rate Milestone</button>
          </div>
          {showMilestone&&(
            <Modal title="Rate Milestone" onClose={()=>setShowMilestone(false)}>
              <Row label="Category"><select value={msForm.category} onChange={e=>setMsForm(p=>({...p,category:e.target.value,milestone:""}))} style={inp}>
                {Object.keys(MILESTONE_CATEGORIES).map(c=><option key={c}>{c}</option>)}
              </select></Row>
              <Row label="Milestone"><select value={msForm.milestone} onChange={e=>setMsForm(p=>({...p,milestone:e.target.value}))} style={inp}>
                <option value="">Select...</option>
                {(MILESTONE_CATEGORIES[msForm.category]||[]).map(m=><option key={m}>{m}</option>)}
              </select></Row>
              <Row label="Rating"><div style={{ display:"flex",gap:8 }}>
                {MILESTONE_RATINGS.map(r=>(
                  <button key={r} onClick={()=>setMsForm(p=>({...p,rating:r}))}
                    style={{ ...btnSm,flex:1,padding:"8px 4px",background:msForm.rating===r?ratingColor(r):"#f1f5f9",color:msForm.rating===r?"#fff":"#374151",fontSize:12 }}>{r}</button>
                ))}
              </div></Row>
              <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}>
                <button onClick={()=>setShowMilestone(false)} style={btnS}>Cancel</button>
                <button onClick={saveMilestone} style={btnP}>Save</button>
              </div>
            </Modal>
          )}
          {Object.entries(MILESTONE_CATEGORIES).map(([cat,items])=>(
            <Card key={cat} style={{ padding:16,marginBottom:12 }}>
              <h4 style={{ margin:"0 0 12px",color:"#0f172a",fontSize:14 }}>{cat}</h4>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8 }}>
                {items.map(item=>{
                  const ms = stuMilestones.find(m=>m.milestone===item&&m.term===selTerm);
                  return (
                    <div key={item} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",borderRadius:8,background:"#f8fafc",fontSize:12 }}>
                      <span style={{ color:"#374151" }}>{item}</span>
                      {ms?<Badge text={ms.rating} color={ratingColor(ms.rating)}/>:<Badge text="Not Rated" color="#9ca3af" bg="#f3f4f6"/>}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {selStu&&tab==="report"&&(
        <Card style={{ padding:24 }}>
          <div style={{ textAlign:"center",marginBottom:16,borderBottom:"2px solid #e5e7eb",paddingBottom:16 }}>
            <div style={{ fontSize:18,fontWeight:700 }}>🍼 KG Progress Report</div>
            <div style={{ fontSize:13,color:"#64748b" }}>Child: <strong>{selStudent?.name}</strong> | Class: {selStudent?.class} | {selTerm} 2024/2025</div>
          </div>
          <div style={{ marginBottom:16 }}>
            <h4 style={{ margin:"0 0 10px",fontSize:14 }}>Daily Log Summary ({stuLogs.length} days recorded)</h4>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,fontSize:13 }}>
              <div><strong>Happy days:</strong> {stuLogs.filter(l=>l.mood==="Happy"||l.mood==="Calm").length}</div>
              <div><strong>No accidents:</strong> {stuLogs.filter(l=>l.hygiene==="No incidents").length}</div>
              <div><strong>Avg nap:</strong> {stuLogs.filter(l=>l.napStart&&l.napEnd).length>0?"Recorded":"N/A"}</div>
            </div>
          </div>
          {Object.entries(MILESTONE_CATEGORIES).map(([cat,items])=>{
            const achieved = items.filter(i=>stuMilestones.find(m=>m.milestone===i&&m.rating==="Achieved")).length;
            const total = items.length;
            return (
              <div key={cat} style={{ marginBottom:10 }}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4,fontSize:13 }}>
                  <span><strong>{cat}</strong></span>
                  <span style={{ color:achieved/total>=0.7?"#16a34a":"#d97706" }}>{achieved}/{total} achieved</span>
                </div>
                <div style={{ height:8,background:"#f1f5f9",borderRadius:4 }}>
                  <div style={{ height:8,borderRadius:4,background:achieved/total>=0.7?"#16a34a":"#f59e0b",width:`${total>0?(achieved/total)*100:0}%` }}/>
                </div>
              </div>
            );
          })}
          <button onClick={()=>window.print()} style={{ ...btnP,marginTop:16 }}>🖨️ Print Report</button>
        </Card>
      )}
    </div>
  );
}

// ─── STAFF ───────────────────────────────────────────────────
function Staff({ users,setUsers,notify,addAudit,failedLogins,unlockUser,classes,initialSearch,cloudSync }) {
  const [filterRole,setFilterRole]=useState("");
  const [showForm,setShowForm]=useState(false); const [editId,setEditId]=useState(null);
  const blank = { name:"",role:"Teacher",pin:"",code:"",email:"",classAssigned:"",active:true,salary:1500,transport:150,housing:0,ssnit:true,photo:"" };
  const [form,setForm]=useState(blank);

  const roleColors = { Admin:"#7c3aed",Headmaster:"#1d4ed8",HOD:"#0369a1",Teacher:"#059669","Account Office":"#d97706",Librarian:"#6d28d9","Non-Teaching Staff":"#6b7280" };

  const save = () => {
    if(!form.name||!form.pin||!form.code){ notify("Name, PIN and Code required","error"); return; }
    if(editId){
      const updated = {...users.find(u=>u.id===editId),...form};
      setUsers(p=>p.map(u=>u.id===editId?updated:u));
      cloudSync?.writeThrough("staff", updated);
      addAudit(`Edited: ${form.name}`,"Staff"); notify("Staff updated");
    } else {
      const newStaff = {...form,id:uid("USR")};
      setUsers(p=>[...p,newStaff]);
      cloudSync?.writeThrough("staff", newStaff);
      addAudit(`Added: ${form.name}`,"Staff"); notify("Staff added");
    }
    setShowForm(false); setEditId(null); setForm(blank);
  };

  const [staffSearch,setStaffSearch]=useState(initialSearch||"");
  const filtered = users.filter(u=>(!filterRole||u.role===filterRole)&&(!staffSearch||u.name.toLowerCase().includes(staffSearch.toLowerCase())||u.code.toLowerCase().includes(staffSearch.toLowerCase())));
  const sort = useSort(filtered, "name");

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <h2 style={{ margin:0,fontSize:20,fontWeight:700,color:"#0f172a" }}>👥 Staff Management</h2>
        <button onClick={()=>{setShowForm(true);setEditId(null);setForm(blank);}} style={btnP}>+ Add Staff</button>
      </div>
      <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap" }}>
        <input value={staffSearch} onChange={e=>setStaffSearch(e.target.value)} placeholder="Search name/code..." style={{ ...inp,width:200 }}/>
        <select value={filterRole} onChange={e=>setFilterRole(e.target.value)} style={{ ...inp,width:200 }}>
          <option value="">All Roles</option>
          {ROLES.map(r=><option key={r}>{r}</option>)}
        </select>
      </div>
      {showForm&&(
        <Modal title={editId?"Edit Staff":"Add Staff"} onClose={()=>{setShowForm(false);setEditId(null);}}>
          <Row label="Photo"><PhotoUpload value={form.photo} onChange={p=>setForm(prev=>({...prev,photo:p}))}/></Row>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
            <Row label="Full Name"><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={inp}/></Row>
            <Row label="Staff Code"><input value={form.code} onChange={e=>setForm(p=>({...p,code:e.target.value.toUpperCase()}))} style={inp}/></Row>
            <Row label="Role"><select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} style={inp}>{ROLES.map(r=><option key={r}>{r}</option>)}</select></Row>
            <Row label="PIN (4 digits)"><input type="password" value={form.pin} onChange={e=>setForm(p=>({...p,pin:e.target.value}))} maxLength={4} style={inp}/></Row>
            <Row label="Email"><input value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} style={inp}/></Row>
            {form.role==="Teacher"&&<Row label="Class"><select value={form.classAssigned||""} onChange={e=>setForm(p=>({...p,classAssigned:e.target.value}))} style={inp}><option value="">None</option>{classes.map(c=><option key={c}>{c}</option>)}</select></Row>}
            <Row label="Base Salary (GH₵)"><input type="number" value={form.salary||0} onChange={e=>setForm(p=>({...p,salary:+e.target.value}))} style={inp}/></Row>
            <Row label="Transport (GH₵)"><input type="number" value={form.transport||0} onChange={e=>setForm(p=>({...p,transport:+e.target.value}))} style={inp}/></Row>
            <Row label="Housing (GH₵)"><input type="number" value={form.housing||0} onChange={e=>setForm(p=>({...p,housing:+e.target.value}))} style={inp}/></Row>
            <Row label="SSNIT"><select value={form.ssnit?"yes":"no"} onChange={e=>setForm(p=>({...p,ssnit:e.target.value==="yes"}))} style={inp}><option value="yes">Yes</option><option value="no">No</option></select></Row>
            <Row label="Active"><select value={form.active?"yes":"no"} onChange={e=>setForm(p=>({...p,active:e.target.value==="yes"}))} style={inp}><option value="yes">Yes</option><option value="no">No (Archive)</option></select></Row>
          </div>
          <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:16 }}>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={btnS}>Cancel</button>
            <button onClick={save} style={btnP}>Save</button>
          </div>
        </Modal>
      )}
      <Table cols={["ID","Code","Name","Role","Class","Email","Status","Locked","Actions"]}
        colKeys={[null,"code","name","role","classAssigned","email","active",null,null]}
        sortState={sort}
        rows={sort.sorted.map(u=>{
          const locked=failedLogins[u.id]?.lockedAt && (Date.now()-failedLogins[u.id].lockedAt)<15*60*1000;
          return (
            <tr key={u.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
              <TD small color="#6b7280">{u.id}</TD>
              <TD bold color="#1e40af">{u.code}</TD>
              <TD bold>{u.name}</TD>
              <td style={{ padding:"8px 12px" }}><Badge text={u.role} color={roleColors[u.role]||"#6b7280"}/></td>
              <TD small color="#6b7280">{u.classAssigned||"—"}</TD>
              <TD small color="#6b7280">{u.email}</TD>
              <td style={{ padding:"8px 12px" }}><Badge text={u.active?"Active":"Inactive"} color={u.active?"#166534":"#991b1b"} bg={u.active?"#dcfce7":"#fee2e2"}/></td>
              <td style={{ padding:"8px 12px" }}>{locked?<Badge text="LOCKED" color="#991b1b" bg="#fee2e2"/>:<Badge text="OK" color="#166534" bg="#dcfce7"/>}</td>
              <td style={{ padding:"8px 12px",display:"flex",gap:4 }}>
                <button onClick={()=>{setEditId(u.id);setForm({name:u.name,role:u.role,pin:u.pin,code:u.code,email:u.email,classAssigned:u.classAssigned||"",active:u.active,salary:u.salary||0,transport:u.transport||0,housing:u.housing||0,ssnit:u.ssnit!==false,photo:u.photo||""});setShowForm(true);}} style={{ ...btnSm,background:"#dbeafe",color:"#1d4ed8" }}>Edit</button>
                {locked&&<button onClick={()=>unlockUser(u.id)} style={{ ...btnSm,background:"#dcfce7",color:"#166534" }}>Unlock</button>}
              </td>
            </tr>
          );
        })}/>
    </div>
  );
}

// ─── GRADES ──────────────────────────────────────────────────
function Grades({ grades,setGrades,students,curUser,notify,addAudit,classes,subjects,cloudSync }) {
  const isTeacher=curUser?.role==="Teacher"; const myClass=isTeacher?curUser?.classAssigned:null;
  const [fc,setFc]=useState(myClass||""); const [fsub,setFsub]=useState(""); const [fterm,setFterm]=useState("");
  const [showForm,setShowForm]=useState(false); const [editId,setEditId]=useState(null);
  const blank={ studentId:"",subject:subjects[0],ca:"",exam:"",term:"Term 2",year:"2024/2025" };
  const [form,setForm]=useState(blank);

  const avStudents=students.filter(s=>s.status==="active"&&(!fc||s.class===fc)&&(!isTeacher||s.class===myClass));
  const filtered=grades.filter(g=>{
    const s=students.find(x=>x.id===g.studentId);
    return (!fc||s?.class===fc)&&(!fsub||g.subject===fsub)&&(!fterm||g.term===fterm)&&(!isTeacher||s?.class===myClass);
  }).map(g=>({ ...g, studentName: students.find(x=>x.id===g.studentId)?.name||g.studentId, className: students.find(x=>x.id===g.studentId)?.class }));
  const sort = useSort(filtered, "studentName");

  const totalScore=(ca,exam)=>Math.min(30,+ca)+Math.min(70,+exam);

  const save=()=>{
    if(!form.studentId||!form.subject||form.ca===""||form.exam===""){ notify("All fields required","error"); return; }
    if(+form.ca<0||+form.ca>30){ notify("CA must be 0–30","error"); return; }
    if(+form.exam<0||+form.exam>70){ notify("Exam must be 0–70","error"); return; }
    const score=totalScore(form.ca,form.exam); const grade=calcGrade(score);
    if(editId){
      const updated = {...grades.find(g=>g.id===editId),...form,ca:+form.ca,exam:+form.exam,score,grade,enteredBy:curUser.code,date:todayStr()};
      setGrades(p=>p.map(g=>g.id===editId?updated:g));
      cloudSync?.writeThrough("grades", updated);
      addAudit(`Edited grade`,"Grades"); notify("Grade updated");
    } else {
      const newGrade = {id:uid("GRD"),...form,ca:+form.ca,exam:+form.exam,score,grade,enteredBy:curUser.code,date:todayStr()};
      setGrades(p=>[...p,newGrade]);
      cloudSync?.writeThrough("grades", newGrade);
      addAudit(`Grade entered: ${form.subject}`,"Grades"); notify("Grade saved");
    }
    setShowForm(false); setEditId(null); setForm(blank);
  };

  const gradeColor=g=>g==="A"?"#16a34a":g==="B"?"#0369a1":g==="C"?"#d97706":g==="D"?"#ea580c":"#dc2626";

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <h2 style={{ margin:0,fontSize:20,fontWeight:700,color:"#0f172a" }}>📝 Grades (CA 30 + Exam 70)</h2>
        <button onClick={()=>{setShowForm(true);setEditId(null);setForm(blank);}} style={btnP}>+ Enter Grade</button>
      </div>
      <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap" }}>
        {isTeacher?<div style={{ padding:"8px 14px",background:"#dbeafe",borderRadius:8,fontSize:13,color:"#1d4ed8",fontWeight:600 }}>📌 {myClass}</div>:
          <select value={fc} onChange={e=>setFc(e.target.value)} style={{ ...inp,width:160 }}><option value="">All Classes</option>{classes.map(c=><option key={c}>{c}</option>)}</select>}
        <select value={fsub} onChange={e=>setFsub(e.target.value)} style={{ ...inp,width:180 }}><option value="">All Subjects</option>{subjects.map(s=><option key={s}>{s}</option>)}</select>
        <select value={fterm} onChange={e=>setFterm(e.target.value)} style={{ ...inp,width:120 }}><option value="">All Terms</option><option>Term 1</option><option>Term 2</option><option>Term 3</option></select>
      </div>
      {showForm&&(
        <Modal title={editId?"Edit Grade":"Enter Grade"} onClose={()=>{setShowForm(false);setEditId(null);}}>
          <Row label="Student"><select value={form.studentId} onChange={e=>setForm(p=>({...p,studentId:e.target.value}))} style={inp}><option value="">Select</option>{avStudents.map(s=><option key={s.id} value={s.id}>{s.name} — {s.class}</option>)}</select></Row>
          <Row label="Subject"><select value={form.subject} onChange={e=>setForm(p=>({...p,subject:e.target.value}))} style={inp}>{subjects.map(s=><option key={s}>{s}</option>)}</select></Row>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
            <Row label="CA Score (out of 30)"><input type="number" min={0} max={30} value={form.ca} onChange={e=>setForm(p=>({...p,ca:e.target.value}))} style={inp}/></Row>
            <Row label="Exam Score (out of 70)"><input type="number" min={0} max={70} value={form.exam} onChange={e=>setForm(p=>({...p,exam:e.target.value}))} style={inp}/></Row>
          </div>
          {form.ca!==""&&form.exam!==""&&(
            <div style={{ background:"#f0fdf4",borderRadius:8,padding:12,textAlign:"center",marginBottom:8 }}>
              <span style={{ fontSize:28,fontWeight:700,color:gradeColor(calcGrade(totalScore(form.ca,form.exam))) }}>{calcGrade(totalScore(form.ca,form.exam))}</span>
              <span style={{ color:"#6b7280",fontSize:13,marginLeft:8 }}>Total: {totalScore(form.ca,form.exam)}/100</span>
            </div>
          )}
          <Row label="Term"><select value={form.term} onChange={e=>setForm(p=>({...p,term:e.target.value}))} style={inp}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></Row>
          <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={btnS}>Cancel</button>
            <button onClick={save} style={btnP}>Save</button>
          </div>
        </Modal>
      )}
      <Table cols={["Student","Class","Subject","CA/30","Exam/70","Total","Grade","Term","By","Date","Actions"]}
        colKeys={["studentName","className","subject","ca","exam","score","grade","term","enteredBy","date",null]}
        sortState={sort}
        rows={sort.sorted.map(g=>{
          const s=students.find(x=>x.id===g.studentId);
          return (
            <tr key={g.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
              <TD bold>{s?.name||g.studentId}</TD>
              <TD small>{s?.class}</TD>
              <TD>{g.subject}</TD>
              <TD>{g.ca??"-"}</TD>
              <TD>{g.exam??"-"}</TD>
              <TD bold>{g.score}</TD>
              <td style={{ padding:"8px 12px" }}><Badge text={g.grade} color={gradeColor(g.grade)}/></td>
              <TD small>{g.term}</TD>
              <TD small color="#6b7280">{g.enteredBy}</TD>
              <TD small color="#6b7280">{g.date}</TD>
              <td style={{ padding:"8px 12px" }}>
                <button onClick={()=>{setEditId(g.id);setForm({studentId:g.studentId,subject:g.subject,ca:g.ca??0,exam:g.exam??0,term:g.term,year:g.year||"2024/2025"});setShowForm(true);}} style={{ ...btnSm,background:"#dbeafe",color:"#1d4ed8" }}>Edit</button>
              </td>
            </tr>
          );
        })} emptyMsg="No grades found."/>
    </div>
  );
}

// ─── EXAMS ───────────────────────────────────────────────────
function Exams({ examSchedule,setExamSchedule,mockExams,setMockExams,students,curUser,notify,addAudit,classes,subjects }) {
  const [tab,setTab]=useState("schedule");
  const [showSched,setShowSched]=useState(false); const [showMock,setShowMock]=useState(false);
  const schedBlank={ class:"JHS 3",subject:getExamSubjects(subjects)[0],date:"",startTime:"08:00",endTime:"10:00",venue:"Main Hall" };
  const mockBlank={ studentId:"",subject:getExamSubjects(subjects)[0],score:"",examType:"Mock 1",term:"Term 2",year:"2024/2025" };
  const [sf,setSf]=useState(schedBlank); const [mf,setMf]=useState(mockBlank);

  const jhs3 = students.filter(s=>s.class==="JHS 3"&&s.status==="active");
  const examSort = useSort(examSchedule, "date");
  const mockEnriched = mockExams.map(m=>({ ...m, studentName: students.find(x=>x.id===m.studentId)?.name||m.studentId, className: students.find(x=>x.id===m.studentId)?.class }));
  const mockSort = useSort(mockEnriched, "date", "desc");

  const saveSched=()=>{
    if(!sf.date||!sf.subject){ notify("Date and subject required","error"); return; }
    setExamSchedule(p=>[...p,{id:uid("EXM"),...sf,createdBy:curUser.code}]);
    addAudit(`Exam scheduled: ${sf.subject} ${sf.class}`,"Exams"); notify("Exam added"); setShowSched(false); setSf(schedBlank);
  };

  const saveMock=()=>{
    if(!mf.studentId||mf.score===""){ notify("Student and score required","error"); return; }
    setMockExams(p=>[...p,{id:uid("MCK"),...mf,score:+mf.score,enteredBy:curUser.code,date:todayStr()}]);
    addAudit(`Mock result: ${mf.subject}`,"Exams"); notify("Mock result saved"); setShowMock(false); setMf(mockBlank);
  };

  // BECE prediction based on mock averages
  const beceRisk = jhs3.map(s=>{
    const mocks = mockExams.filter(m=>m.studentId===s.id);
    if(!mocks.length) return { ...s, avg:null, risk:"No Data" };
    const avg = Math.round(mocks.reduce((a,m)=>a+m.score,0)/mocks.length);
    const risk = avg>=70?"Low Risk":avg>=50?"Watch":"At Risk";
    return { ...s, avg, risk };
  });

  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>📖 Exam Management & BECE Prep</h2>
      <Tabs tabs={[{key:"schedule",label:"📅 Exam Timetable"},{key:"mock",label:"📝 Mock Results"},{key:"bece",label:"🎯 BECE Prediction"}]} active={tab} onChange={setTab}/>

      {tab==="schedule"&&(
        <div>
          <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:12 }}>
            {(curUser?.role!=="Teacher")&&<button onClick={()=>setShowSched(true)} style={btnP}>+ Add Exam</button>}
          </div>
          {showSched&&(
            <Modal title="Schedule Exam" onClose={()=>setShowSched(false)}>
              <Row label="Class"><select value={sf.class} onChange={e=>setSf(p=>({...p,class:e.target.value}))} style={inp}>{classes.map(c=><option key={c}>{c}</option>)}</select></Row>
              <Row label="Subject"><select value={sf.subject} onChange={e=>setSf(p=>({...p,subject:e.target.value}))} style={inp}>{getExamSubjects(subjects).map(s=><option key={s}>{s}</option>)}</select></Row>
              <Row label="Date"><input type="date" value={sf.date} onChange={e=>setSf(p=>({...p,date:e.target.value}))} style={inp}/></Row>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <Row label="Start Time"><input type="time" value={sf.startTime} onChange={e=>setSf(p=>({...p,startTime:e.target.value}))} style={inp}/></Row>
                <Row label="End Time"><input type="time" value={sf.endTime} onChange={e=>setSf(p=>({...p,endTime:e.target.value}))} style={inp}/></Row>
              </div>
              <Row label="Venue"><input value={sf.venue} onChange={e=>setSf(p=>({...p,venue:e.target.value}))} style={inp}/></Row>
              <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}>
                <button onClick={()=>setShowSched(false)} style={btnS}>Cancel</button>
                <button onClick={saveSched} style={btnP}>Save</button>
              </div>
            </Modal>
          )}
          <Table cols={["Class","Subject","Date","Time","Venue","Added By"]}
            colKeys={["class","subject","date","startTime","venue","createdBy"]}
            sortState={examSort}
            rows={examSort.sorted.map(e=>(
              <tr key={e.id} style={{ borderBottom:"1px solid #f1f5f9",background:e.date===todayStr()?"#fffbeb":"#fff" }}>
                <td style={{ padding:"8px 12px" }}><Badge text={e.class} color="#1d4ed8" bg="#dbeafe"/></td>
                <TD bold>{e.subject}</TD>
                <TD>{e.date}{e.date===todayStr()&&<span style={{ color:"#d97706",marginLeft:6,fontSize:11 }}>TODAY</span>}</TD>
                <TD small>{e.startTime} – {e.endTime}</TD>
                <TD>{e.venue}</TD>
                <TD small color="#6b7280">{e.createdBy}</TD>
              </tr>
            ))} emptyMsg="No exams scheduled."/>
        </div>
      )}

      {tab==="mock"&&(
        <div>
          <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:12 }}>
            <button onClick={()=>setShowMock(true)} style={btnP}>+ Enter Mock Result</button>
          </div>
          {showMock&&(
            <Modal title="Enter Mock Result" onClose={()=>setShowMock(false)}>
              <Row label="Student"><select value={mf.studentId} onChange={e=>setMf(p=>({...p,studentId:e.target.value}))} style={inp}><option value="">Select</option>{students.filter(s=>s.status==="active").map(s=><option key={s.id} value={s.id}>{s.name} — {s.class}</option>)}</select></Row>
              <Row label="Subject"><select value={mf.subject} onChange={e=>setMf(p=>({...p,subject:e.target.value}))} style={inp}>{getExamSubjects(subjects).map(s=><option key={s}>{s}</option>)}</select></Row>
              <Row label="Score (0–100)"><input type="number" min={0} max={100} value={mf.score} onChange={e=>setMf(p=>({...p,score:e.target.value}))} style={inp}/></Row>
              <Row label="Exam Type"><select value={mf.examType} onChange={e=>setMf(p=>({...p,examType:e.target.value}))} style={inp}><option>Mock 1</option><option>Mock 2</option><option>Mock 3</option><option>Pre-BECE</option></select></Row>
              <Row label="Term"><select value={mf.term} onChange={e=>setMf(p=>({...p,term:e.target.value}))} style={inp}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></Row>
              <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}>
                <button onClick={()=>setShowMock(false)} style={btnS}>Cancel</button>
                <button onClick={saveMock} style={btnP}>Save</button>
              </div>
            </Modal>
          )}
          <Table cols={["Student","Class","Subject","Score","Grade","Type","Term","By","Date"]}
            colKeys={["studentName","className","subject","score",null,"examType","term","enteredBy","date"]}
            sortState={mockSort}
            rows={mockSort.sorted.map(m=>{
              const s=students.find(x=>x.id===m.studentId);
              return (
                <tr key={m.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <TD bold>{s?.name}</TD><TD small>{s?.class}</TD><TD>{m.subject}</TD>
                  <TD bold>{m.score}</TD>
                  <td style={{ padding:"8px 12px" }}><Badge text={calcGrade(m.score)} color={m.score>=70?"#16a34a":m.score>=50?"#d97706":"#dc2626"}/></td>
                  <TD small>{m.examType}</TD><TD small>{m.term}</TD><TD small color="#6b7280">{m.enteredBy}</TD><TD small color="#6b7280">{m.date}</TD>
                </tr>
              );
            })} emptyMsg="No mock results."/>
        </div>
      )}

      {tab==="bece"&&(
        <div>
          <div style={{ background:"#f0f9ff",borderRadius:10,padding:14,marginBottom:16,fontSize:13,color:"#0369a1" }}>
            📊 BECE risk prediction based on mock exam averages for JHS 3 students.
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:20 }}>
            {[["🟢 Low Risk","Low Risk","#dcfce7","#166534"],["🟡 Watch","Watch","#fef3c7","#92400e"],["🔴 At Risk","At Risk","#fee2e2","#991b1b"]].map(([icon,risk,bg,color])=>(
              <div key={risk} style={{ background:bg,borderRadius:10,padding:14,textAlign:"center" }}>
                <div style={{ fontSize:22,marginBottom:4 }}>{icon}</div>
                <div style={{ fontSize:22,fontWeight:700,color }}>{beceRisk.filter(s=>s.risk===risk).length}</div>
                <div style={{ fontSize:12,color }}>{risk}</div>
              </div>
            ))}
          </div>
          <Table cols={["Student","Mock Avg","Risk Level","Subjects Taken","Recommendation"]}
            rows={beceRisk.map(s=>(
              <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <TD bold>{s.name}</TD>
                <TD bold color={s.avg>=70?"#16a34a":s.avg>=50?"#d97706":"#dc2626"}>{s.avg!==null?s.avg+"%":"—"}</TD>
                <td style={{ padding:"8px 12px" }}>
                  <Badge text={s.risk} color={s.risk==="Low Risk"?"#166534":s.risk==="Watch"?"#92400e":"#991b1b"} bg={s.risk==="Low Risk"?"#dcfce7":s.risk==="Watch"?"#fef3c7":"#fee2e2"}/>
                </td>
                <TD>{mockExams.filter(m=>m.studentId===s.id).length}</TD>
                <TD small color="#64748b">{s.risk==="Low Risk"?"Keep up good work":s.risk==="Watch"?"Extra support needed":"Urgent intervention required"}</TD>
              </tr>
            ))} emptyMsg="No JHS 3 students found."/>
        </div>
      )}
    </div>
  );
}

// ─── PROMOTION ───────────────────────────────────────────────
function Promotion({ students,setStudents,grades,mockExams,attendance,fees,payroll,examSchedule,school,setSchool,curUser,notify,addAudit,yearArchive,setYearArchive }) {
  const [passMark,setPassMark]=useState(50);
  const [evalYear,setEvalYear]=useState(school.currentYear);
  const [preview,setPreview]=useState(null); // array of { student, avg, hasData, defaultResult, override }
  const [showConfirm,setShowConfirm]=useState(false);
  const [done,setDone]=useState(null); // summary after running

  const activeStudents = students.filter(s=>s.status==="active");

  const buildPreview = () => {
    // group by class to compute batch index for KG2 -> Class1A/1B split
    const byClass = {};
    activeStudents.forEach(s=>{ (byClass[s.class]=byClass[s.class]||[]).push(s); });

    const rows = [];
    Object.entries(byClass).forEach(([cls,list])=>{
      list.forEach((s,idx)=>{
        const sGrades = grades.filter(g=>g.studentId===s.id && g.year===evalYear);
        const hasData = sGrades.length>0;
        const avg = hasData ? Math.round(sGrades.reduce((a,g)=>a+g.score,0)/sGrades.length) : null;
        const willPass = hasData ? avg>=passMark : false;
        const isJHS3 = cls==="JHS 3";
        const hasPath = isJHS3 || !!nextClassFor(cls, idx);
        let defaultResult;
        if (!hasData) defaultResult = "Review"; // no grades on record — needs manual decision
        else if (isJHS3) defaultResult = willPass ? "Graduate" : "Repeat";
        else if (willPass && !hasPath) defaultResult = "Review"; // custom class with no defined next class
        else defaultResult = willPass ? "Promote" : "Repeat";
        const nextClass = isJHS3 ? null : (willPass ? nextClassFor(cls, idx) : cls);
        rows.push({ student:s, currentClass:cls, avg, hasData, defaultResult, nextClass, override:defaultResult });
      });
    });
    rows.sort((a,b)=>a.currentClass.localeCompare(b.currentClass)||a.student.name.localeCompare(b.student.name));
    setPreview(rows); setDone(null);
  };

  const setOverride = (studentId, value) => {
    setPreview(prev=>prev.map(r=>r.student.id===studentId?{...r,override:value}:r));
  };

  const counts = preview ? {
    Promote: preview.filter(r=>r.override==="Promote").length,
    Graduate: preview.filter(r=>r.override==="Graduate").length,
    Repeat: preview.filter(r=>r.override==="Repeat").length,
    Review: preview.filter(r=>r.override==="Review").length,
  } : null;

  const runPromotion = () => {
    if (!preview) return;
    const closingYear = school.currentYear;

    // Snapshot everything for this closing year into the archive before anything changes,
    // so History can show a permanent record of the year — including every term in it.
    const yearGrades = grades.filter(g=>g.year===closingYear);
    const yearMock = (mockExams||[]).filter(m=>m.year===closingYear);
    const yearFees = fees.filter(f=>f.year===closingYear);
    const yearPayroll = (payroll||[]).filter(p=>p.year===closingYear.split("/")[0] || p.year===closingYear);
    const terms = ["Term 1","Term 2","Term 3"];
    const termBreakdown = terms.map(term=>{
      const tg = yearGrades.filter(g=>g.term===term);
      const tf = yearFees.filter(f=>f.term===term);
      return {
        term,
        gradeCount: tg.length,
        avgScore: tg.length ? Math.round(tg.reduce((a,g)=>a+g.score,0)/tg.length) : null,
        feesCollected: tf.reduce((a,f)=>a+f.paid,0),
      };
    }).filter(t=>t.gradeCount>0 || t.feesCollected>0);

    setYearArchive(prev=>({
      ...prev,
      [closingYear]: {
        closedDate: nowStr(),
        closedBy: curUser?.code,
        studentsSnapshot: students.map(s=>({ id:s.id,name:s.name,class:s.class,status:s.status })),
        termBreakdown,
        totalStudents: activeStudents.length,
        totalFeesCollected: yearFees.reduce((a,f)=>a+f.paid,0),
        totalPayroll: yearPayroll.reduce((a,p)=>a+(p.netPay||0),0),
        promotionSummary: counts,
      }
    }));

    let byClass = {}; // recompute nextClass for Promote rows honoring KG2 split order at execution time
    const classCounters = {};
    setStudents(prevStudents=>{
      const map = new Map(prevStudents.map(s=>[s.id,{...s}]));
      preview.forEach(r=>{
        const s = map.get(r.student.id); if(!s) return;
        if (r.override==="Graduate") { s.status="graduated"; }
        else if (r.override==="Promote") {
          const idx = classCounters[r.currentClass] = (classCounters[r.currentClass]||0);
          classCounters[r.currentClass]++;
          const nc = nextClassFor(r.currentClass, idx);
          if (nc) s.class = nc;
        }
        // "Repeat" and "Review" leave the student's class unchanged
      });
      return Array.from(map.values());
    });
    const newYear = nextAcademicYear(school.currentYear);
    setSchool(prev=>({ ...prev, currentYear:newYear, currentTerm:"Term 1" }));
    addAudit(`Year-end promotion run: ${counts.Promote} promoted, ${counts.Graduate} graduated, ${counts.Repeat} repeated, ${counts.Review} flagged for review. New year: ${newYear}. Year ${closingYear} archived to History.`,"Promotion");
    setDone({ ...counts, newYear });
    notify("Promotion completed ✅ — year archived to History");
    setShowConfirm(false);
  };

  const resultColor = r=>r==="Promote"?"#16a34a":r==="Graduate"?"#7c3aed":r==="Repeat"?"#dc2626":"#d97706";
  const resultBg = r=>r==="Promote"?"#dcfce7":r==="Graduate"?"#ede9fe":r==="Repeat"?"#fee2e2":"#fef3c7";

  return (
    <div>
      <h2 style={{ margin:"0 0 8px",fontSize:20,fontWeight:700,color:"#0f172a" }}>🎓 Year-End Promotion</h2>
      <p style={{ margin:"0 0 16px",fontSize:13,color:"#64748b" }}>
        Automatically promotes students who meet the pass mark to their next class, moves JHS 3 passers to Graduated, and leaves students below the pass mark in their current class to repeat. Review every result before confirming — nothing is applied until you click Confirm.
      </p>

      {done&&(
        <Card style={{ padding:20,marginBottom:20,borderLeft:"4px solid #16a34a" }}>
          <h3 style={{ margin:"0 0 10px",fontSize:15,color:"#166534" }}>✅ Promotion completed</h3>
          <div style={{ display:"flex",gap:20,fontSize:13,flexWrap:"wrap" }}>
            <div><strong style={{ color:"#16a34a" }}>{done.Promote}</strong> promoted</div>
            <div><strong style={{ color:"#7c3aed" }}>{done.Graduate}</strong> graduated</div>
            <div><strong style={{ color:"#dc2626" }}>{done.Repeat}</strong> repeating</div>
            <div><strong style={{ color:"#d97706" }}>{done.Review}</strong> flagged for review (unchanged)</div>
          </div>
          <p style={{ fontSize:12,color:"#64748b",marginTop:8 }}>Academic year advanced to <strong>{done.newYear}</strong>, Term 1. Check Students and Archive to confirm class assignments.</p>
        </Card>
      )}

      {!preview&&(
        <Card style={{ padding:20,maxWidth:480 }}>
          <Row label="Academic Year to Evaluate">
            <input value={evalYear} onChange={e=>setEvalYear(e.target.value)} style={inp}/>
          </Row>
          <Row label="Pass Mark (average score % required)">
            <input type="number" min={0} max={100} value={passMark} onChange={e=>setPassMark(+e.target.value)} style={inp}/>
          </Row>
          <div style={{ background:"#f0f9ff",borderRadius:8,padding:12,fontSize:12,color:"#0369a1",marginBottom:14 }}>
            A student's average is calculated across all grade entries recorded for them in <strong>{evalYear}</strong>. Students with no grades on record are flagged <strong>Review</strong> rather than auto-promoted or held back.
          </div>
          <button onClick={buildPreview} style={{ ...btnP,width:"100%" }}>Build Promotion Preview</button>
        </Card>
      )}

      {preview&&!done&&(
        <div>
          <div style={{ display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center" }}>
            <StatCard icon="✅" label="Promote" value={counts.Promote} color="#16a34a"/>
            <StatCard icon="🎓" label="Graduate" value={counts.Graduate} color="#7c3aed"/>
            <StatCard icon="🔁" label="Repeat" value={counts.Repeat} color="#dc2626"/>
            <StatCard icon="⚠️" label="Review" value={counts.Review} color="#d97706"/>
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
            <p style={{ margin:0,fontSize:12,color:"#64748b" }}>Change any student's outcome using the dropdown before confirming.</p>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={()=>setPreview(null)} style={btnS}>Back</button>
              <button onClick={()=>setShowConfirm(true)} style={{ ...btnP,background:"#7c3aed" }}>Confirm & Run Promotion</button>
            </div>
          </div>
          <Table cols={["Student","Current Class","Avg Score","Data?","Next Class","Result"]}
            rows={preview.map(r=>(
              <tr key={r.student.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <TD bold>{r.student.name}</TD>
                <TD small>{r.currentClass}</TD>
                <TD bold color={r.avg===null?"#9ca3af":r.avg>=passMark?"#16a34a":"#dc2626"}>{r.avg===null?"—":r.avg+"%"}</TD>
                <td style={{ padding:"8px 12px" }}>{r.hasData?<Badge text="Yes" color="#166534" bg="#dcfce7"/>:<Badge text="No grades" color="#92400e" bg="#fef3c7"/>}</td>
                <TD small color="#6b7280">{r.override==="Promote"?(r.currentClass==="JHS 3"?"—":(nextClassFor(r.currentClass,0)||"—")):r.override==="Graduate"?"Graduated":r.currentClass}</TD>
                <td style={{ padding:"6px 12px" }}>
                  <select value={r.override} onChange={e=>setOverride(r.student.id,e.target.value)}
                    style={{ padding:"5px 8px",borderRadius:6,border:"1.5px solid #d1d5db",fontSize:12,fontWeight:600,
                      color:resultColor(r.override),background:resultBg(r.override) }}>
                    {r.currentClass==="JHS 3"
                      ? <><option value="Graduate">Graduate</option><option value="Repeat">Repeat</option><option value="Review">Review</option></>
                      : <><option value="Promote">Promote</option><option value="Repeat">Repeat</option><option value="Review">Review</option></>}
                  </select>
                </td>
              </tr>
            ))} emptyMsg="No active students found."/>
        </div>
      )}

      {showConfirm&&(
        <Modal title="Confirm Year-End Promotion" onClose={()=>setShowConfirm(false)}>
          <p style={{ fontSize:13,color:"#374151",marginBottom:14 }}>This will immediately update class assignments for all affected students and cannot be automatically undone. Please confirm the numbers below are correct.</p>
          <div style={{ background:"#fef2f2",borderRadius:8,padding:14,fontSize:13,lineHeight:2,marginBottom:14 }}>
            <div><strong style={{ color:"#16a34a" }}>{counts.Promote}</strong> students will be promoted to their next class</div>
            <div><strong style={{ color:"#7c3aed" }}>{counts.Graduate}</strong> JHS 3 students will be marked Graduated</div>
            <div><strong style={{ color:"#dc2626" }}>{counts.Repeat}</strong> students will repeat their current class</div>
            <div><strong style={{ color:"#d97706" }}>{counts.Review}</strong> students are flagged for manual review and will be left unchanged</div>
            <div style={{ marginTop:6 }}>Academic year will advance from <strong>{school.currentYear}</strong> to <strong>{nextAcademicYear(school.currentYear)}</strong>, Term 1.</div>
          </div>
          <div style={{ display:"flex",justifyContent:"flex-end",gap:8 }}>
            <button onClick={()=>setShowConfirm(false)} style={btnS}>Cancel</button>
            <button onClick={runPromotion} style={{ ...btnP,background:"#dc2626" }}>⚠️ Yes, Run Promotion</button>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ─── YEAR HISTORY ────────────────────────────────────────────
// Browse the archive that gets created automatically each time Promotion is run.
function YearHistory({ yearArchive }) {
  const years = Object.keys(yearArchive||{}).sort().reverse();
  const [selYear,setSelYear] = useState(years[0]||"");
  const archive = selYear ? yearArchive[selYear] : null;
  const [classFilter,setClassFilter] = useState("");

  const snapshotClasses = archive ? [...new Set(archive.studentsSnapshot.map(s=>s.class))].sort() : [];
  const filteredSnapshot = archive ? archive.studentsSnapshot.filter(s=>!classFilter||s.class===classFilter) : [];
  const rosterSort = useSort(filteredSnapshot, "name");

  return (
    <div>
      <h2 style={{ margin:"0 0 8px",fontSize:20,fontWeight:700,color:"#0f172a" }}>📜 Year History</h2>
      <p style={{ margin:"0 0 16px",fontSize:13,color:"#64748b" }}>
        A permanent record of each academic year, created automatically whenever Year-End Promotion is run. Includes a term-by-term breakdown and a snapshot of every student's class and status at year-close.
      </p>

      {years.length===0 && (
        <div style={{ background:"#f0f9ff",borderRadius:12,padding:32,textAlign:"center",color:"#0369a1" }}>
          <div style={{ fontSize:40,marginBottom:8 }}>📜</div>
          <p>No archived years yet.</p>
          <p style={{ fontSize:13,color:"#64748b" }}>Run Year-End Promotion once a school year closes, and it'll appear here automatically.</p>
        </div>
      )}

      {years.length>0 && (
        <div style={{ display:"flex",gap:16 }}>
          <div style={{ width:180,flexShrink:0 }}>
            {years.map(y=>(
              <button key={y} onClick={()=>{setSelYear(y);setClassFilter("");}}
                style={{ display:"block",width:"100%",textAlign:"left",padding:"10px 14px",marginBottom:6,borderRadius:8,border:"none",cursor:"pointer",
                  background:selYear===y?"#1e40af":"#f1f5f9",color:selYear===y?"#fff":"#374151",fontWeight:600,fontSize:13 }}>
                {y}
              </button>
            ))}
          </div>

          {archive && (
            <div style={{ flex:1 }}>
              <Card style={{ padding:18,marginBottom:16 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                  <h3 style={{ margin:0,fontSize:16,color:"#0f172a" }}>Academic Year {selYear}</h3>
                  <span style={{ fontSize:11,color:"#94a3b8" }}>Closed {archive.closedDate} by {archive.closedBy}</span>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10 }}>
                  <StatCard icon="🎒" label="Students at Close" value={archive.totalStudents} color="#3b82f6"/>
                  <StatCard icon="💰" label="Fees Collected" value={formatGHS(archive.totalFeesCollected)} color="#16a34a"/>
                  <StatCard icon="💼" label="Payroll Paid" value={formatGHS(archive.totalPayroll)} color="#7c3aed"/>
                  <StatCard icon="🎓" label="Promoted/Graduated" value={`${archive.promotionSummary?.Promote||0}/${archive.promotionSummary?.Graduate||0}`} color="#d97706"/>
                </div>
              </Card>

              <Card style={{ padding:18,marginBottom:16 }}>
                <h3 style={{ margin:"0 0 12px",fontSize:15,color:"#0f172a" }}>Term Breakdown</h3>
                {archive.termBreakdown.length>0 ? (
                  <Table cols={["Term","Grade Records","Class Average","Fees Collected"]}
                    rows={archive.termBreakdown.map(t=>(
                      <tr key={t.term} style={{ borderBottom:"1px solid #f1f5f9" }}>
                        <TD bold>{t.term}</TD>
                        <TD>{t.gradeCount}</TD>
                        <TD bold color={t.avgScore===null?"#9ca3af":t.avgScore>=70?"#16a34a":t.avgScore>=50?"#d97706":"#dc2626"}>{t.avgScore!==null?t.avgScore+"%":"—"}</TD>
                        <TD>{formatGHS(t.feesCollected)}</TD>
                      </tr>
                    ))}/>
                ) : <p style={{ fontSize:13,color:"#9ca3af" }}>No term data recorded for this year.</p>}
              </Card>

              <Card style={{ padding:18 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                  <h3 style={{ margin:0,fontSize:15,color:"#0f172a" }}>Student Roster at Year-Close</h3>
                  <select value={classFilter} onChange={e=>setClassFilter(e.target.value)} style={{ ...inp,width:160 }}>
                    <option value="">All Classes</option>
                    {snapshotClasses.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <Table cols={["Student","Class at Close","Status"]}
                  colKeys={["name","class","status"]}
                  sortState={rosterSort}
                  rows={rosterSort.sorted.map(s=>(
                    <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                      <TD bold>{s.name}</TD><TD>{s.class}</TD>
                      <td style={{ padding:"8px 12px" }}><Badge text={s.status} color={s.status==="active"?"#166534":s.status==="graduated"?"#1d4ed8":"#991b1b"} bg={s.status==="active"?"#dcfce7":s.status==="graduated"?"#dbeafe":"#fee2e2"}/></td>
                    </tr>
                  ))} emptyMsg="No students in this filter."/>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ATTENDANCE ──────────────────────────────────────────────
function Attendance({ attendance,setAttendance,students,curUser,notify,addAudit,classes,cloudSync }) {
  const isTeacher=curUser?.role==="Teacher"; const myClass=isTeacher?curUser?.classAssigned:null;
  const [date,setDate]=useState(todayStr()); const [selClass,setSelClass]=useState(myClass||classes[5]);
  const [view,setView]=useState("mark");

  const classStu=students.filter(s=>s.status==="active"&&s.class===selClass);
  const forDate=attendance.filter(a=>a.date===date&&a.class===selClass);
  const getStatus=sid=>forDate.find(a=>a.studentId===sid)?.status||"";

  const mark=(sid,status)=>{
    const ex=attendance.find(a=>a.date===date&&a.class===selClass&&a.studentId===sid);
    if(ex){
      const updated = {...ex,status,enteredBy:curUser.code};
      setAttendance(p=>p.map(a=>a.id===ex.id?updated:a));
      cloudSync?.writeThrough("attendance", updated);
    } else {
      const newRecord = {id:uid("ATT"),studentId:sid,class:selClass,date,status,enteredBy:curUser.code};
      setAttendance(p=>[...p,newRecord]);
      cloudSync?.writeThrough("attendance", newRecord);
    }
  };

  const markAll=st=>{ classStu.forEach(s=>mark(s.id,st)); notify(`All marked ${st}`); };

  const statusColor=s=>s==="Present"?"#16a34a":s==="Absent"?"#dc2626":s==="Late"?"#d97706":"#6b7280";
  const statusBg=s=>s==="Present"?"#dcfce7":s==="Absent"?"#fee2e2":s==="Late"?"#fef3c7":"#f3f4f6";

  const history=[...attendance].sort((a,b)=>b.date.localeCompare(a.date)).filter(a=>!isTeacher||a.class===myClass)
    .map(a=>({ ...a, studentName: students.find(x=>x.id===a.studentId)?.name||a.studentId }));
  const historySort = useSort(history.slice(0,60), "date", "desc");

  // Attendance summary per student
  const summary=students.filter(s=>s.status==="active"&&(!isTeacher||s.class===myClass)).map(s=>{
    const all=attendance.filter(a=>a.studentId===s.id);
    const present=all.filter(a=>a.status==="Present").length;
    const rate=all.length?Math.round((present/all.length)*100):100;
    return {...s,total:all.length,present,rate};
  }).sort((a,b)=>a.rate-b.rate);
  const summarySort = useSort(summary, "rate");

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <h2 style={{ margin:0,fontSize:20,fontWeight:700,color:"#0f172a" }}>✅ Attendance</h2>
        <Tabs tabs={[{key:"mark",label:"Mark"},{key:"history",label:"History"},{key:"summary",label:"Summary"}]} active={view} onChange={setView}/>
      </div>

      {view==="mark"&&(
        <>
          <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center" }}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ ...inp,width:170 }}/>
            {isTeacher?<div style={{ padding:"8px 14px",background:"#dbeafe",borderRadius:8,fontSize:13,color:"#1d4ed8",fontWeight:600 }}>📌 {selClass}</div>:
              <select value={selClass} onChange={e=>setSelClass(e.target.value)} style={{ ...inp,width:160 }}>{classes.map(c=><option key={c}>{c}</option>)}</select>}
            <button onClick={()=>markAll("Present")} style={{ ...btnSm,background:"#dcfce7",color:"#166534",padding:"8px 14px" }}>✅ All Present</button>
            <button onClick={()=>markAll("Absent")} style={{ ...btnSm,background:"#fee2e2",color:"#991b1b",padding:"8px 14px" }}>❌ All Absent</button>
            <button onClick={()=>{ addAudit(`Attendance saved: ${selClass} ${date}`,"Attendance"); notify("Attendance saved ✅"); }} style={{ ...btnP,padding:"8px 14px" }}>💾 Save</button>
          </div>
          <Card>
            <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
              <thead><tr style={{ background:"#f8fafc" }}>
                {["#","Student","Present","Absent","Late","Excused"].map(h=><th key={h} style={{ padding:"10px 12px",textAlign:"left",fontWeight:600,color:"#374151",borderBottom:"1px solid #e5e7eb" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {classStu.map((s,i)=>{
                  const st=getStatus(s.id);
                  return (
                    <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9",background:st?statusBg(st):"#fff" }}>
                      <TD small color="#9ca3af">{i+1}</TD>
                      <TD bold>{s.name}</TD>
                      {["Present","Absent","Late","Excused"].map(opt=>(
                        <td key={opt} style={{ padding:"6px 12px" }}>
                          <button onClick={()=>mark(s.id,opt)} style={{ padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontWeight:600,fontSize:11,
                            background:st===opt?statusColor(opt):statusBg(opt),color:st===opt?"#fff":statusColor(opt) }}>{opt}</button>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {view==="history"&&(
        <Table cols={["Date","Student","Class","Status","By"]}
          colKeys={["date","studentName","class","status","enteredBy"]}
          sortState={historySort}
          rows={historySort.sorted.map(a=>{
            const s=students.find(x=>x.id===a.studentId);
            return (
              <tr key={a.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <TD>{a.date}</TD><TD bold>{s?.name}</TD><TD small>{a.class}</TD>
                <td style={{ padding:"8px 12px" }}><Badge text={a.status} color={statusColor(a.status)} bg={statusBg(a.status)}/></td>
                <TD small color="#6b7280">{a.enteredBy}</TD>
              </tr>
            );
          })} emptyMsg="No attendance records."/>
      )}

      {view==="summary"&&(
        <Table cols={["Student","Class","Days Recorded","Present","Rate","Alert"]}
          colKeys={["name","class","total","present","rate",null]}
          sortState={summarySort}
          rows={summarySort.sorted.map(s=>(
            <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9",background:s.rate<70?"#fff7f7":"#fff" }}>
              <TD bold>{s.name}</TD><TD small>{s.class}</TD><TD>{s.total}</TD><TD>{s.present}</TD>
              <td style={{ padding:"8px 12px" }}>
                <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                  <div style={{ flex:1,height:8,background:"#f1f5f9",borderRadius:4,minWidth:80 }}>
                    <div style={{ height:8,borderRadius:4,background:s.rate>=80?"#16a34a":s.rate>=60?"#f59e0b":"#dc2626",width:`${s.rate}%` }}/>
                  </div>
                  <span style={{ fontSize:12,fontWeight:600,color:s.rate>=80?"#16a34a":s.rate>=60?"#d97706":"#dc2626" }}>{s.rate}%</span>
                </div>
              </td>
              <td style={{ padding:"8px 12px" }}>{s.rate<70&&<Badge text="Low Attendance" color="#991b1b" bg="#fee2e2"/>}</td>
            </tr>
          ))} emptyMsg="No students."/>
      )}
    </div>
  );
}

// ─── FINANCE ─────────────────────────────────────────────────
function Finance({ fees,setFees,expenses,setExpenses,students,setStudents,school,curUser,notify,addAudit,cloudSync }) {
  const [tab,setTab]=useState("fees");
  const [receipt,setReceipt]=useState(null);
  const [showFee,setShowFee]=useState(false); const [showExp,setShowExp]=useState(false);
  const [feeForm,setFeeForm]=useState({ studentId:"",amount:"",paid:"",term:"Term 2",year:"2024/2025" });
  const [expForm,setExpForm]=useState({ description:"",amount:"",category:"Supplies",date:todayStr() });
  const [period,setPeriod]=useState("monthly");
  const feesEnriched = fees.map(f=>({ ...f, studentName: students.find(x=>x.id===f.studentId)?.name, className: students.find(x=>x.id===f.studentId)?.class }));
  const feesSort = useSort(feesEnriched, "date", "desc");
  const expensesSort = useSort(expenses, "date", "desc");

  const saveFee=()=>{
    if(!feeForm.studentId||!feeForm.paid){ notify("Student and amount required","error"); return; }
    const stu=students.find(s=>s.id===feeForm.studentId);
    const rec={ id:uid("FEE"),studentId:feeForm.studentId,amount:+feeForm.amount||+feeForm.paid,paid:+feeForm.paid,
      balance:(+feeForm.amount||+feeForm.paid)-(+feeForm.paid),term:feeForm.term,year:feeForm.year,
      receiptNo:`RCP${Date.now().toString().slice(-5)}`,date:todayStr(),enteredBy:curUser.code };
    setFees(p=>[...p,rec]);
    cloudSync?.writeThrough("fees", rec);
    if (stu) {
      const updatedStudent = {...stu, paid: stu.paid+(+feeForm.paid)};
      setStudents&&setStudents(p=>p.map(s=>s.id===feeForm.studentId?updatedStudent:s));
      cloudSync?.writeThrough("students", updatedStudent);
    }
    addAudit(`Fee: ${stu?.name} ${formatGHS(+feeForm.paid)}`,"Finance");
    setReceipt({...rec,studentName:stu?.name,studentClass:stu?.class,guardian:stu?.guardian});
    setShowFee(false); setFeeForm({studentId:"",amount:"",paid:"",term:"Term 2",year:"2024/2025"}); notify("Payment recorded ✅");
  };

  const saveExp=()=>{
    if(!expForm.description||!expForm.amount){ notify("Description and amount required","error"); return; }
    setExpenses(p=>[...p,{id:uid("EXP"),...expForm,amount:+expForm.amount,enteredBy:curUser.code}]);
    addAudit(`Expense: ${expForm.description} ${formatGHS(+expForm.amount)}`,"Finance"); notify("Expense recorded");
    setShowExp(false); setExpForm({description:"",amount:"",category:"Supplies",date:todayStr()});
  };

  const totalPaid=fees.reduce((a,f)=>a+f.paid,0);
  const totalExp=expenses.reduce((a,e)=>a+e.amount,0);

  const getReport=()=>{
    const now=new Date();
    const filt=(arr,df)=>arr.filter(item=>{
      const d=new Date(item[df]);
      if(period==="weekly") return (now-d)/(86400000)<=7;
      if(period==="monthly") return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
      if(period==="quarterly") return Math.floor(d.getMonth()/3)===Math.floor(now.getMonth()/3)&&d.getFullYear()===now.getFullYear();
      if(period==="yearly") return d.getFullYear()===now.getFullYear();
      if(period==="term1") return item.term==="Term 1";
      if(period==="term2") return item.term==="Term 2";
      if(period==="term3") return item.term==="Term 3";
      return true;
    });
    const rf=filt(fees,"date"); const re=filt(expenses,"date");
    return { income:rf.reduce((a,f)=>a+f.paid,0), expenses:re.reduce((a,e)=>a+e.amount,0), feeCount:rf.length, expCount:re.length };
  };
  const rep=getReport();

  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>💰 Finance</h2>
      <Tabs tabs={[{key:"fees",label:"📥 Fees"},{key:"expenses",label:"📤 Expenses"},{key:"report",label:"📊 Reports"}]} active={tab} onChange={setTab}/>

      {receipt&&(
        <Modal title="Payment Receipt" onClose={()=>setReceipt(null)}>
          <div style={{ textAlign:"center",marginBottom:16 }}>
            <div style={{ fontSize:20,fontWeight:700 }}>{school.name}</div>
            <div style={{ fontSize:12,color:"#64748b" }}>{school.address}</div>
            <div style={{ fontSize:12,color:"#64748b" }}>{school.phone} | {school.email}</div>
            <div style={{ borderTop:"2px dashed #e5e7eb",marginTop:10,paddingTop:10 }}>
              <div style={{ fontWeight:700,color:"#1e40af",fontSize:15 }}>OFFICIAL FEE RECEIPT</div>
              <div style={{ fontSize:12,color:"#6b7280" }}>Receipt No: {receipt.receiptNo}</div>
            </div>
          </div>
          <div style={{ fontSize:13,lineHeight:2.2,background:"#f8fafc",borderRadius:8,padding:14 }}>
            <div><strong>Student:</strong> {receipt.studentName}</div>
            <div><strong>Class:</strong> {receipt.studentClass}</div>
            <div><strong>Guardian:</strong> {receipt.guardian}</div>
            <div><strong>Term:</strong> {receipt.term} — {receipt.year}</div>
            <div><strong>Date:</strong> {receipt.date}</div>
            <div style={{ borderTop:"1px solid #e5e7eb",marginTop:6,paddingTop:6 }}>
              <div><strong>Amount Due:</strong> {formatGHS(receipt.amount)}</div>
              <div style={{ color:"#16a34a",fontWeight:700 }}><strong>Amount Paid:</strong> {formatGHS(receipt.paid)}</div>
              <div style={{ color:receipt.balance>0?"#dc2626":"#16a34a",fontWeight:700 }}><strong>Balance:</strong> {formatGHS(receipt.balance)}</div>
            </div>
          </div>
          <div style={{ fontSize:11,color:"#9ca3af",textAlign:"center",marginTop:10 }}>Issued by: {receipt.enteredBy} | {school.name}</div>
          <div style={{ display:"flex",gap:8,marginTop:14 }}>
            <button onClick={()=>window.print()} style={{ ...btnP,flex:1 }}>🖨️ Print</button>
            <button onClick={()=>setReceipt(null)} style={{ ...btnS,flex:1 }}>Close</button>
          </div>
        </Modal>
      )}

      {tab==="fees"&&(
        <>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
            <div style={{ display:"flex",gap:10 }}>
              <StatCard icon="💰" label="Total Collected" value={formatGHS(totalPaid)} color="#16a34a"/>
              <StatCard icon="⚠️" label="Outstanding" value={formatGHS(students.filter(s=>s.status==="active").reduce((a,s)=>a+(s.fees-s.paid),0))} color="#dc2626"/>
            </div>
            <button onClick={()=>setShowFee(true)} style={btnP}>+ Record Payment</button>
          </div>
          {showFee&&(
            <Modal title="Record Fee Payment" onClose={()=>setShowFee(false)}>
              <Row label="Student"><select value={feeForm.studentId} onChange={e=>setFeeForm(p=>({...p,studentId:e.target.value}))} style={inp}>
                <option value="">Select</option>
                {students.filter(s=>s.status==="active").map(s=><option key={s.id} value={s.id}>{s.name} — {s.class} (Bal: {formatGHS(s.fees-s.paid)})</option>)}
              </select></Row>
              <Row label="Total Fees (GH₵)"><input type="number" value={feeForm.amount} onChange={e=>setFeeForm(p=>({...p,amount:e.target.value}))} style={inp}/></Row>
              <Row label="Amount Paying Now (GH₵)"><input type="number" value={feeForm.paid} onChange={e=>setFeeForm(p=>({...p,paid:e.target.value}))} style={inp}/></Row>
              <Row label="Term"><select value={feeForm.term} onChange={e=>setFeeForm(p=>({...p,term:e.target.value}))} style={inp}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></Row>
              <Row label="Year"><input value={feeForm.year} onChange={e=>setFeeForm(p=>({...p,year:e.target.value}))} style={inp}/></Row>
              <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}>
                <button onClick={()=>setShowFee(false)} style={btnS}>Cancel</button>
                <button onClick={saveFee} style={btnP}>Record & Print Receipt</button>
              </div>
            </Modal>
          )}
          <Table cols={["Receipt","Student","Class","Amount","Paid","Balance","Term","Date","By"]}
            colKeys={["receiptNo","studentName","className","amount","paid","balance","term","date","enteredBy"]}
            sortState={feesSort}
            rows={feesSort.sorted.map(f=>{ const s=students.find(x=>x.id===f.studentId); return (
              <tr key={f.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <TD small color="#6b7280">{f.receiptNo}</TD>
                <TD bold>{s?.name}</TD><TD small>{s?.class}</TD>
                <TD>{formatGHS(f.amount)}</TD>
                <TD color="#16a34a" bold>{formatGHS(f.paid)}</TD>
                <TD color={f.balance>0?"#dc2626":"#16a34a"} bold>{formatGHS(f.balance)}</TD>
                <TD small>{f.term}</TD><TD small>{f.date}</TD><TD small color="#6b7280">{f.enteredBy}</TD>
              </tr>
            );})} emptyMsg="No payments recorded."/>
        </>
      )}

      {tab==="expenses"&&(
        <>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
            <StatCard icon="📤" label="Total Expenses" value={formatGHS(totalExp)} color="#d97706"/>
            <button onClick={()=>setShowExp(true)} style={btnP}>+ Add Expense</button>
          </div>
          {showExp&&(
            <Modal title="Record Expense" onClose={()=>setShowExp(false)}>
              <Row label="Description"><input value={expForm.description} onChange={e=>setExpForm(p=>({...p,description:e.target.value}))} style={inp}/></Row>
              <Row label="Amount (GH₵)"><input type="number" value={expForm.amount} onChange={e=>setExpForm(p=>({...p,amount:e.target.value}))} style={inp}/></Row>
              <Row label="Category"><select value={expForm.category} onChange={e=>setExpForm(p=>({...p,category:e.target.value}))} style={inp}>
                {["Supplies","Utilities","Maintenance","Staff","Infrastructure","Events","ICT","Security","Other"].map(c=><option key={c}>{c}</option>)}
              </select></Row>
              <Row label="Date"><input type="date" value={expForm.date} onChange={e=>setExpForm(p=>({...p,date:e.target.value}))} style={inp}/></Row>
              <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}>
                <button onClick={()=>setShowExp(false)} style={btnS}>Cancel</button>
                <button onClick={saveExp} style={btnP}>Save</button>
              </div>
            </Modal>
          )}
          <Table cols={["Description","Amount","Category","Date","By"]}
            colKeys={["description","amount","category","date","enteredBy"]}
            sortState={expensesSort}
            rows={expensesSort.sorted.map(e=>(
              <tr key={e.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <TD bold>{e.description}</TD>
                <TD color="#d97706" bold>{formatGHS(e.amount)}</TD>
                <td style={{ padding:"8px 12px" }}><Badge text={e.category} color="#374151" bg="#f1f5f9"/></td>
                <TD>{e.date}</TD><TD small color="#6b7280">{e.enteredBy}</TD>
              </tr>
            ))} emptyMsg="No expenses."/>
        </>
      )}

      {tab==="report"&&(
        <div>
          <div style={{ display:"flex",gap:6,marginBottom:16,flexWrap:"wrap" }}>
            {[["weekly","Weekly"],["monthly","Monthly"],["quarterly","Quarterly"],["yearly","Yearly"],["term1","Term 1"],["term2","Term 2"],["term3","Term 3"]].map(([k,l])=>(
              <button key={k} onClick={()=>setPeriod(k)} style={{ padding:"7px 14px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,background:period===k?"#1e40af":"#e5e7eb",color:period===k?"#fff":"#374151" }}>{l}</button>
            ))}
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20 }}>
            <StatCard icon="📥" label={`Income (${period})`} value={formatGHS(rep.income)} color="#16a34a" sub={`${rep.feeCount} payments`}/>
            <StatCard icon="📤" label={`Expenses (${period})`} value={formatGHS(rep.expenses)} color="#dc2626" sub={`${rep.expCount} items`}/>
            <StatCard icon="🏦" label="Net Balance" value={formatGHS(rep.income-rep.expenses)} color={(rep.income-rep.expenses)>=0?"#0369a1":"#dc2626"}/>
          </div>
          <Card style={{ padding:18 }}>
            <h3 style={{ margin:"0 0 12px",fontSize:15 }}>Expense Breakdown</h3>
            {["Supplies","Utilities","Maintenance","Staff","Infrastructure","Events","ICT","Security","Other"].map(cat=>{
              const t=expenses.filter(e=>e.category===cat).reduce((a,e)=>a+e.amount,0);
              return t>0?<div key={cat} style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}><span>{cat}</span><span style={{ fontWeight:600 }}>{formatGHS(t)}</span></div>:null;
            })}
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── PAYROLL ─────────────────────────────────────────────────
function Payroll({ payroll,setPayroll,users,curUser,notify,addAudit }) {
  const [tab,setTab]=useState("process");
  const [selStaff,setSelStaff]=useState("");
  const [selMonth,setSelMonth]=useState("January"); const [selYear,setSelYear]=useState("2025");
  const [showForm,setShowForm]=useState(false);
  const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const payrollEnriched = payroll.map(p=>({ ...p, staffName: users.find(x=>x.id===p.staffId)?.name }));
  const payrollSort = useSort(payrollEnriched, "date", "desc");

  const staff=users.filter(u=>u.active);
  const su=staff.find(u=>u.id===selStaff);

  const calcPayslip=(u,overTime=0,substitution=0,loans=0,absenceDays=0,responsibility=0)=>{
    const base=u.salary||0; const transport=u.transport||0; const housing=u.housing||0;
    const gross=base+transport+housing+responsibility+overTime+substitution;
    const ssnitEmp=u.ssnit?(base*0.055):0;
    const ssnitEr=u.ssnit?(base*0.13):0;
    const dailyRate=base/22;
    const absDeduct=absenceDays*dailyRate;
    const paye=calcPAYE(gross-ssnitEmp);
    const netPay=gross-ssnitEmp-paye-loans-absDeduct;
    return { base,transport,housing,responsibility,overTime,substitution,gross,ssnitEmployee:Math.round(ssnitEmp*100)/100,ssnitEmployer:Math.round(ssnitEr*100)/100,paye:Math.round(paye*100)/100,loans,absenceDeductions:Math.round(absDeduct*100)/100,netPay:Math.round(netPay*100)/100 };
  };

  const [extras,setExtras]=useState({ overtime:0,substitution:0,loans:0,absenceDays:0,responsibility:0 });
  const preview=su?calcPayslip(su,extras.overtime,extras.substitution,extras.loans,extras.absenceDays,extras.responsibility):null;

  const processPayroll=()=>{
    if(!selStaff||!preview){ notify("Select staff member","error"); return; }
    const exists=payroll.find(p=>p.staffId===selStaff&&p.month===selMonth&&p.year===selYear);
    if(exists){ notify("Payroll already processed for this period","error"); return; }
    const entry={ id:uid("PAY"),staffId:selStaff,month:selMonth,year:selYear,...preview,status:"paid",processedBy:curUser.code,date:todayStr() };
    setPayroll(p=>[...p,entry]);
    addAudit(`Payroll: ${su?.name} ${selMonth} ${selYear}`,"Payroll");
    notify("Payroll processed ✅"); setExtras({overtime:0,substitution:0,loans:0,absenceDays:0,responsibility:0});
  };

  const monthlyTotal=payroll.filter(p=>p.month===selMonth&&p.year===selYear);
  const totalWageBill=monthlyTotal.reduce((a,p)=>a+(p.netPay||0),0);
  const totalSSNIT=monthlyTotal.reduce((a,p)=>a+(p.ssnitEmployer||0),0);

  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>💼 Staff Payroll</h2>
      <Tabs tabs={[{key:"process",label:"Process Payroll"},{key:"history",label:"Payroll History"},{key:"summary",label:"Monthly Summary"}]} active={tab} onChange={setTab}/>

      {tab==="process"&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
          <div>
            <Card style={{ padding:18,marginBottom:16 }}>
              <h3 style={{ margin:"0 0 14px",fontSize:15 }}>Select Period & Staff</h3>
              <Row label="Staff Member"><select value={selStaff} onChange={e=>{setSelStaff(e.target.value);setExtras({overtime:0,substitution:0,loans:0,absenceDays:0,responsibility:0});}} style={inp}>
                <option value="">-- Select --</option>
                {staff.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select></Row>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <Row label="Month"><select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={inp}>{months.map(m=><option key={m}>{m}</option>)}</select></Row>
                <Row label="Year"><input value={selYear} onChange={e=>setSelYear(e.target.value)} style={inp}/></Row>
              </div>
            </Card>
            {su&&(
              <Card style={{ padding:18 }}>
                <h3 style={{ margin:"0 0 14px",fontSize:15 }}>Adjustments</h3>
                <Row label="Responsibility Allowance (GH₵)"><input type="number" value={extras.responsibility} onChange={e=>setExtras(p=>({...p,responsibility:+e.target.value}))} style={inp}/></Row>
                <Row label="Overtime Pay (GH₵)"><input type="number" value={extras.overtime} onChange={e=>setExtras(p=>({...p,overtime:+e.target.value}))} style={inp}/></Row>
                <Row label="Substitution Pay (GH₵)"><input type="number" value={extras.substitution} onChange={e=>setExtras(p=>({...p,substitution:+e.target.value}))} style={inp}/></Row>
                <Row label="Days Absent (for deduction)"><input type="number" value={extras.absenceDays} onChange={e=>setExtras(p=>({...p,absenceDays:+e.target.value}))} style={inp}/></Row>
                <Row label="Loan Deduction (GH₵)"><input type="number" value={extras.loans} onChange={e=>setExtras(p=>({...p,loans:+e.target.value}))} style={inp}/></Row>
              </Card>
            )}
          </div>

          {preview&&su&&(
            <Card style={{ padding:20 }}>
              <div style={{ textAlign:"center",marginBottom:16,borderBottom:"2px solid #e5e7eb",paddingBottom:12 }}>
                <div style={{ fontSize:15,fontWeight:700 }}>PAYSLIP PREVIEW</div>
                <div style={{ fontSize:13,color:"#64748b" }}>{su.name} | {selMonth} {selYear}</div>
                <Badge text={su.role} color="#1d4ed8" bg="#dbeafe"/>
              </div>
              <div style={{ fontSize:13 }}>
                <div style={{ background:"#f0fdf4",borderRadius:8,padding:10,marginBottom:10 }}>
                  <div style={{ fontWeight:600,color:"#166534",marginBottom:6 }}>EARNINGS</div>
                  {[["Base Salary",preview.base],["Transport Allowance",preview.transport],["Housing Allowance",preview.housing],["Responsibility Allow.",preview.responsibility],["Overtime",preview.overTime],["Substitution",preview.substitution]].map(([l,v])=>v>0?<div key={l} style={{ display:"flex",justifyContent:"space-between",padding:"3px 0" }}><span>{l}</span><span>{formatGHS(v)}</span></div>:null)}
                  <div style={{ borderTop:"1px solid #bbf7d0",marginTop:6,paddingTop:6,display:"flex",justifyContent:"space-between",fontWeight:700 }}><span>Gross Pay</span><span>{formatGHS(preview.gross)}</span></div>
                </div>
                <div style={{ background:"#fef2f2",borderRadius:8,padding:10,marginBottom:10 }}>
                  <div style={{ fontWeight:600,color:"#991b1b",marginBottom:6 }}>DEDUCTIONS</div>
                  {[["SSNIT (5.5% employee)",preview.ssnitEmployee],["PAYE Tax",preview.paye],["Absence Deductions",preview.absenceDeductions],["Loan Repayment",preview.loans]].map(([l,v])=>v>0?<div key={l} style={{ display:"flex",justifyContent:"space-between",padding:"3px 0" }}><span>{l}</span><span style={{ color:"#dc2626" }}>-{formatGHS(v)}</span></div>:null)}
                </div>
                <div style={{ background:"#eff6ff",borderRadius:8,padding:12,textAlign:"center" }}>
                  <div style={{ fontSize:12,color:"#1d4ed8" }}>NET PAY</div>
                  <div style={{ fontSize:28,fontWeight:700,color:"#1e40af" }}>{formatGHS(preview.netPay)}</div>
                  <div style={{ fontSize:11,color:"#6b7280" }}>SSNIT Employer contribution: {formatGHS(preview.ssnitEmployer)}</div>
                </div>
              </div>
              <button onClick={processPayroll} style={{ ...btnP,width:"100%",marginTop:14 }}>✅ Process & Save Payroll</button>
            </Card>
          )}
        </div>
      )}

      {tab==="history"&&(
        <Table cols={["Staff","Month","Year","Gross","Net Pay","SSNIT(Er)","PAYE","Status","By"]}
          colKeys={["staffName","month","year","gross","netPay","ssnitEmployer","paye","status","processedBy"]}
          sortState={payrollSort}
          rows={payrollSort.sorted.map(p=>{ const u=users.find(x=>x.id===p.staffId); return (
            <tr key={p.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
              <TD bold>{u?.name}</TD><TD>{p.month}</TD><TD>{p.year}</TD>
              <TD>{formatGHS(p.gross)}</TD>
              <TD bold color="#1e40af">{formatGHS(p.netPay)}</TD>
              <TD small>{formatGHS(p.ssnitEmployer)}</TD>
              <TD small>{formatGHS(p.paye)}</TD>
              <td style={{ padding:"8px 12px" }}><Badge text={p.status} color="#166534" bg="#dcfce7"/></td>
              <TD small color="#6b7280">{p.processedBy}</TD>
            </tr>
          );})} emptyMsg="No payroll records."/>
      )}

      {tab==="summary"&&(
        <div>
          <div style={{ display:"flex",gap:10,marginBottom:16 }}>
            <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{ ...inp,width:150 }}>{months.map(m=><option key={m}>{m}</option>)}</select>
            <input value={selYear} onChange={e=>setSelYear(e.target.value)} style={{ ...inp,width:100 }}/>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20 }}>
            <StatCard icon="💼" label="Staff Paid" value={monthlyTotal.length} color="#3b82f6"/>
            <StatCard icon="💰" label="Total Wage Bill" value={formatGHS(totalWageBill)} color="#1e40af"/>
            <StatCard icon="🏛️" label="SSNIT (Employer)" value={formatGHS(totalSSNIT)} color="#7c3aed"/>
          </div>
          <Table cols={["Staff","Role","Base","Net Pay","SSNIT(Er)","PAYE"]}
            rows={monthlyTotal.map(p=>{ const u=users.find(x=>x.id===p.staffId); return (
              <tr key={p.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <TD bold>{u?.name}</TD>
                <td style={{ padding:"8px 12px" }}><Badge text={u?.role||""} color="#374151" bg="#f1f5f9"/></td>
                <TD>{formatGHS(p.base)}</TD>
                <TD bold color="#1e40af">{formatGHS(p.netPay)}</TD>
                <TD small>{formatGHS(p.ssnitEmployer)}</TD>
                <TD small>{formatGHS(p.paye)}</TD>
              </tr>
            );})} emptyMsg="No payroll for this period."/>
        </div>
      )}
    </div>
  );
}

// ─── LIBRARY ─────────────────────────────────────────────────
function Library({ books,setBooks,borrows,setBorrows,students,users,curUser,notify,addAudit }) {
  const [tab,setTab]=useState("books");
  const [search,setSearch]=useState("");
  const [showBook,setShowBook]=useState(false); const [editBk,setEditBk]=useState(null);
  const [showBorrow,setShowBorrow]=useState(false);
  const bkBlank={ title:"",author:"",isbn:"",copies:1,available:1,category:"Textbook" };
  const [bf,setBf]=useState(bkBlank);
  const [borForm,setBorForm]=useState({ bookId:"",borrowerId:"",borrowerType:"Student",borrowDate:todayStr(),dueDate:"" });
  const overdue=borrows.filter(b=>!b.returnDate&&b.dueDate<todayStr());

  const saveBook=()=>{
    if(!bf.title){ notify("Title required","error"); return; }
    if(editBk){ setBooks(p=>p.map(b=>b.id===editBk?{...b,...bf}:b)); notify("Book updated"); }
    else { setBooks(p=>[...p,{id:uid("BK"),...bf}]); addAudit(`Book added: ${bf.title}`,"Library"); notify("Book added"); }
    setShowBook(false); setEditBk(null); setBf(bkBlank);
  };

  const saveBorrow=()=>{
    if(!borForm.bookId||!borForm.borrowerId||!borForm.dueDate){ notify("All fields required","error"); return; }
    const bk=books.find(b=>b.id===borForm.bookId);
    if(!bk||bk.available<1){ notify("No copies available","error"); return; }
    setBorrows(p=>[...p,{id:uid("BOR"),...borForm,returnDate:null,enteredBy:curUser.code}]);
    setBooks(p=>p.map(b=>b.id===borForm.bookId?{...b,available:b.available-1}:b));
    addAudit(`Borrowed: ${bk.title}`,"Library"); notify("Book issued ✅");
    setShowBorrow(false); setBorForm({bookId:"",borrowerId:"",borrowerType:"Student",borrowDate:todayStr(),dueDate:""});
  };

  const returnBook=id=>{
    const bor=borrows.find(b=>b.id===id); if(!bor) return;
    setBorrows(p=>p.map(b=>b.id===id?{...b,returnDate:todayStr()}:b));
    setBooks(p=>p.map(b=>b.id===bor.bookId?{...b,available:b.available+1}:b));
    addAudit(`Returned: book ${id}`,"Library"); notify("Book returned ✅");
  };

  const filtered=books.filter(b=>b.title.toLowerCase().includes(search.toLowerCase())||b.author.toLowerCase().includes(search.toLowerCase()));
  const booksSort = useSort(filtered, "title");
  const borrowsEnriched = borrows.map(b=>({ ...b, bookTitle: books.find(x=>x.id===b.bookId)?.title,
    borrowerName: (b.borrowerType==="Student"?students:users).find(x=>x.id===b.borrowerId)?.name }));
  const borrowsSort = useSort(borrowsEnriched, "borrowDate", "desc");

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <h2 style={{ margin:0,fontSize:20,fontWeight:700,color:"#0f172a" }}>📚 Library</h2>
        <div style={{ display:"flex",gap:8 }}>
          <Tabs tabs={[{key:"books",label:"Books"},{key:"borrows",label:"Borrows"}]} active={tab} onChange={setTab}/>
          {overdue.length>0&&<Badge text={`${overdue.length} Overdue`} color="#991b1b" bg="#fee2e2"/>}
        </div>
      </div>

      {tab==="books"&&(
        <>
          <div style={{ display:"flex",gap:8,marginBottom:14 }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search books..." style={{ ...inp,flex:1 }}/>
            <button onClick={()=>{setShowBook(true);setEditBk(null);setBf(bkBlank);}} style={btnP}>+ Add Book</button>
            <button onClick={()=>setShowBorrow(true)} style={{ ...btnP,background:"#059669" }}>📤 Issue Book</button>
          </div>
          {showBook&&(
            <Modal title={editBk?"Edit Book":"Add Book"} onClose={()=>{setShowBook(false);setEditBk(null);}}>
              <Row label="Title"><input value={bf.title} onChange={e=>setBf(p=>({...p,title:e.target.value}))} style={inp}/></Row>
              <Row label="Author"><input value={bf.author} onChange={e=>setBf(p=>({...p,author:e.target.value}))} style={inp}/></Row>
              <Row label="ISBN"><input value={bf.isbn} onChange={e=>setBf(p=>({...p,isbn:e.target.value}))} style={inp}/></Row>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <Row label="Total Copies"><input type="number" value={bf.copies} onChange={e=>setBf(p=>({...p,copies:+e.target.value,available:+e.target.value}))} style={inp}/></Row>
                <Row label="Category"><select value={bf.category} onChange={e=>setBf(p=>({...p,category:e.target.value}))} style={inp}>{["Textbook","Reference","Fiction","Library","Magazine","Other"].map(c=><option key={c}>{c}</option>)}</select></Row>
              </div>
              <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}><button onClick={()=>{setShowBook(false);setEditBk(null);}} style={btnS}>Cancel</button><button onClick={saveBook} style={btnP}>Save</button></div>
            </Modal>
          )}
          {showBorrow&&(
            <Modal title="Issue Book" onClose={()=>setShowBorrow(false)}>
              <Row label="Book"><select value={borForm.bookId} onChange={e=>setBorForm(p=>({...p,bookId:e.target.value}))} style={inp}><option value="">Select</option>{books.filter(b=>b.available>0).map(b=><option key={b.id} value={b.id}>{b.title} ({b.available} avail.)</option>)}</select></Row>
              <Row label="Borrower Type"><select value={borForm.borrowerType} onChange={e=>setBorForm(p=>({...p,borrowerType:e.target.value,borrowerId:""}))} style={inp}><option>Student</option><option>Staff</option></select></Row>
              <Row label="Borrower"><select value={borForm.borrowerId} onChange={e=>setBorForm(p=>({...p,borrowerId:e.target.value}))} style={inp}><option value="">Select</option>{(borForm.borrowerType==="Student"?students.filter(s=>s.status==="active"):users.filter(u=>u.active)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Row>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <Row label="Borrow Date"><input type="date" value={borForm.borrowDate} onChange={e=>setBorForm(p=>({...p,borrowDate:e.target.value}))} style={inp}/></Row>
                <Row label="Due Date"><input type="date" value={borForm.dueDate} onChange={e=>setBorForm(p=>({...p,dueDate:e.target.value}))} style={inp}/></Row>
              </div>
              <div style={{ display:"flex",justifyContent:"flex-end",gap:8,marginTop:12 }}><button onClick={()=>setShowBorrow(false)} style={btnS}>Cancel</button><button onClick={saveBorrow} style={btnP}>Issue</button></div>
            </Modal>
          )}
          <Table cols={["Title","Author","ISBN","Category","Total","Available","Actions"]}
            colKeys={["title","author","isbn","category","copies","available",null]}
            sortState={booksSort}
            rows={booksSort.sorted.map(b=>(
              <tr key={b.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <TD bold>{b.title}</TD><TD>{b.author}</TD><TD small color="#6b7280">{b.isbn}</TD>
                <td style={{ padding:"8px 12px" }}><Badge text={b.category} color="#374151" bg="#f1f5f9"/></td>
                <TD>{b.copies}</TD>
                <td style={{ padding:"8px 12px" }}><Badge text={String(b.available)} color={b.available>0?"#166534":"#991b1b"} bg={b.available>0?"#dcfce7":"#fee2e2"}/></td>
                <td style={{ padding:"8px 12px" }}><button onClick={()=>{setEditBk(b.id);setBf({title:b.title,author:b.author,isbn:b.isbn,copies:b.copies,available:b.available,category:b.category});setShowBook(true);}} style={{ ...btnSm,background:"#dbeafe",color:"#1d4ed8" }}>Edit</button></td>
              </tr>
            ))} emptyMsg="No books."/>
        </>
      )}

      {tab==="borrows"&&(
        <Table cols={["Book","Borrower","Type","Borrow Date","Due Date","Status","Action"]}
          colKeys={["bookTitle","borrowerName","borrowerType","borrowDate","dueDate",null,null]}
          sortState={borrowsSort}
          rows={borrowsSort.sorted.map(bor=>{
            const bk=books.find(b=>b.id===bor.bookId);
            const brw=bor.borrowerType==="Student"?students.find(s=>s.id===bor.borrowerId):users.find(u=>u.id===bor.borrowerId);
            const od=!bor.returnDate&&bor.dueDate<todayStr();
            return (
              <tr key={bor.id} style={{ borderBottom:"1px solid #f1f5f9",background:od?"#fff7f0":"#fff" }}>
                <TD bold>{bk?.title}</TD><TD>{brw?.name}</TD>
                <td style={{ padding:"8px 12px" }}><Badge text={bor.borrowerType} color="#374151" bg="#f1f5f9"/></td>
                <TD small>{bor.borrowDate}</TD>
                <TD small color={od?"#dc2626":"inherit"}>{bor.dueDate}{od?" ⚠️":""}</TD>
                <td style={{ padding:"8px 12px" }}>
                  {bor.returnDate?<Badge text={`Returned ${bor.returnDate}`} color="#166534" bg="#dcfce7"/>:
                    <Badge text={od?"OVERDUE":"Borrowed"} color={od?"#991b1b":"#92400e"} bg={od?"#fee2e2":"#fef3c7"}/>}
                </td>
                <td style={{ padding:"8px 12px" }}>
                  {!bor.returnDate&&<button onClick={()=>returnBook(bor.id)} style={{ ...btnSm,background:"#dcfce7",color:"#166534" }}>Return</button>}
                </td>
              </tr>
            );
          })} emptyMsg="No borrow records."/>
      )}
    </div>
  );
}

// ─── TIMETABLE ───────────────────────────────────────────────
function Timetable({ timetables,setTimetables,curUser }) {
  const isTeacher=curUser?.role==="Teacher"; const myClass=isTeacher?curUser?.classAssigned:null;
  const [selClass,setSelClass]=useState(myClass||"Class 6A");
  const [editMode,setEditMode]=useState(false);
  const [editCell,setEditCell]=useState(null); // {dayIdx,periodIdx}
  const [editVal,setEditVal]=useState("");
  const [editTimeRow,setEditTimeRow]=useState(null); // periodIdx being time-edited
  const [editTimeVal,setEditTimeVal]=useState("");
  const tt=timetables[selClass];
  const dayColors=["#eff6ff","#f0fdf4","#fefce8","#fdf2f8","#f0fdfa"];

  const saveCell=()=>{
    if(!editCell) return;
    setTimetables(prev=>{
      const newTT={...prev};
      const days=[...(newTT[selClass]||[])];
      const day={...days[editCell.dayIdx]};
      const periods=[...day.periods];
      periods[editCell.periodIdx]={...periods[editCell.periodIdx],subject:editVal};
      days[editCell.dayIdx]={...day,periods};
      newTT[selClass]=days;
      return newTT;
    });
    setEditCell(null); setEditVal("");
  };

  // A period's time slot is the same across all 5 days, so editing it updates every day's row at once.
  const saveTimeRow=(periodIdx)=>{
    setTimetables(prev=>{
      const newTT={...prev};
      const days=(newTT[selClass]||[]).map(day=>{
        const periods=[...day.periods];
        periods[periodIdx]={...periods[periodIdx],time:editTimeVal};
        return {...day,periods};
      });
      newTT[selClass]=days;
      return newTT;
    });
    setEditTimeRow(null); setEditTimeVal("");
  };

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <h2 style={{ margin:0,fontSize:20,fontWeight:700,color:"#0f172a" }}>📅 Timetable</h2>
        <div style={{ display:"flex",gap:8,alignItems:"center" }}>
          {!isTeacher&&<select value={selClass} onChange={e=>setSelClass(e.target.value)} style={{ ...inp,width:160 }}>{Object.keys(timetables).map(c=><option key={c}>{c}</option>)}</select>}
          {isTeacher&&<div style={{ padding:"8px 14px",background:"#dbeafe",borderRadius:8,fontSize:13,color:"#1d4ed8",fontWeight:600 }}>📌 {selClass}</div>}
          {!isTeacher&&<button onClick={()=>setEditMode(!editMode)} style={{ ...editMode?{...btnS}:btnP,padding:"8px 14px" }}>{editMode?"✅ Done Editing":"✏️ Edit Timetable"}</button>}
        </div>
      </div>
      {tt?(
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12,background:"#fff",borderRadius:12,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            <thead><tr style={{ background:"#0f172a" }}>
              <th style={{ padding:"10px 12px",color:"#94a3b8",textAlign:"left",fontSize:13,minWidth:100 }}>Time</th>
              {tt.map(d=><th key={d.day} style={{ padding:"10px 12px",color:"#fff",textAlign:"center",fontSize:13,minWidth:110 }}>{d.day}</th>)}
            </tr></thead>
            <tbody>
              {tt[0].periods.map((p,pi)=>(
                <tr key={pi} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"8px 12px",fontWeight:600,color:"#374151",background:"#f8fafc",whiteSpace:"nowrap",cursor:editMode?"pointer":"default" }}
                    onClick={()=>{ if(editMode){ setEditTimeRow(pi); setEditTimeVal(p.time); } }}>
                    {editTimeRow===pi ? (
                      <input value={editTimeVal} onChange={e=>setEditTimeVal(e.target.value)} placeholder="e.g. 7:30-8:30"
                        style={{ width:100,padding:"3px 6px",borderRadius:4,border:"1px solid #93c5fd",fontSize:11 }}
                        onClick={e=>e.stopPropagation()}
                        onKeyDown={e=>{ if(e.key==="Enter") saveTimeRow(pi); if(e.key==="Escape"){ setEditTimeRow(null);setEditTimeVal(""); }}} autoFocus/>
                    ) : p.time}
                  </td>
                  {tt.map((d,di)=>{
                    const per=d.periods[pi];
                    const isBreak=per.subject==="Break"||per.subject==="Lunch";
                    const isEditing=editMode&&editCell?.dayIdx===di&&editCell?.periodIdx===pi;
                    return (
                      <td key={di} style={{ padding:"6px 10px",textAlign:"center",background:isBreak?"#f1f5f9":dayColors[di%5],cursor:editMode&&!isBreak?"pointer":"default" }}
                        onClick={()=>{ if(editMode&&!isBreak){ setEditCell({dayIdx:di,periodIdx:pi}); setEditVal(per.subject); }}}>
                        {isEditing?(
                          <div onClick={e=>e.stopPropagation()}>
                            <input value={editVal} onChange={e=>setEditVal(e.target.value)} style={{ width:"90%",padding:"3px 6px",borderRadius:4,border:"1px solid #93c5fd",fontSize:11 }}
                              onKeyDown={e=>{ if(e.key==="Enter") saveCell(); if(e.key==="Escape"){ setEditCell(null);setEditVal(""); }}} autoFocus/>
                          </div>
                        ):(
                          <span style={{ fontSize:12,fontWeight:isBreak?400:600,color:isBreak?"#9ca3af":"#0f172a" }}>{per.subject}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ):<div style={{ textAlign:"center",color:"#9ca3af",padding:40 }}>No timetable for {selClass}. Select a class with a timetable or add one.</div>}
      {editMode&&<p style={{ fontSize:12,color:"#64748b",marginTop:8 }}>Click any subject cell to edit it, or click a time in the left column to change that period's time for all 5 days. Press Enter to save, Escape to cancel.</p>}
    </div>
  );
}

// ─── COMMUNICATION ───────────────────────────────────────────
function Communication({ students,school,curUser,fees,attendance,classes }) {
  const [tab,setTab]=useState("whatsapp");
  const [templateType,setTemplateType]=useState("fee_reminder");
  const [selStu,setSelStu]=useState("");
  const [selClass,setSelClass]=useState("");
  const [preview,setPreview]=useState("");
  const [letterType,setLetterType]=useState("arrears");

  const activeStudents=students.filter(s=>s.status==="active");
  const classStudents=selClass?activeStudents.filter(s=>s.class===selClass):activeStudents;
  const selStudent=students.find(s=>s.id===selStu);

  const templates = {
    fee_reminder: (s) => `Dear ${s?.guardian||"Parent/Guardian"},

This is a friendly reminder from ${school.name} that the school fees for *${s?.name}* (${s?.class}) for ${school.currentTerm} ${school.currentYear} are outstanding.

• Total Fees: ${formatGHS(s?.fees||0)}
• Amount Paid: ${formatGHS(s?.paid||0)}
• Balance Due: *${formatGHS((s?.fees||0)-(s?.paid||0))}*

Kindly make payment at your earliest convenience to avoid any disruption to your child's schooling.

Thank you.
${school.name}
${school.phone}`,

    absence_alert: (s) => {
      const absences=attendance.filter(a=>a.studentId===s?.id&&a.status==="Absent").length;
      return `Dear ${s?.guardian||"Parent/Guardian"},

We wish to bring to your attention that *${s?.name}* (${s?.class}) has been absent from school *${absences} time(s)* this term.

Regular attendance is essential for your child's academic progress. Please ensure your child attends school regularly. If there is a health or personal reason, kindly notify the school.

Please contact us to discuss: ${school.phone}

Regards,
${school.name}`;
    },

    report_ready: (s) => `Dear ${s?.guardian||"Parent/Guardian"},

The academic report for *${s?.name}* (${s?.class}) for ${school.currentTerm} ${school.currentYear} is ready for collection.

Kindly visit the school to collect the report card. Please bring this message as confirmation.

School hours: Monday – Friday, 7:30am – 3:00pm

${school.name}
${school.phone}`,

    exam_notice: (s) => `Dear ${s?.guardian||"Parent/Guardian"},

End of term examinations for *${s?.name}* (${s?.class}) are scheduled to begin soon.

Please ensure your child:
✅ Reports to school on time
✅ Brings all necessary stationery
✅ Has paid all outstanding fees before the exam period

For the full exam timetable, please contact the school.

${school.name}
${school.phone}`,

    pta_invite: (s) => `Dear ${s?.guardian||"Parent/Guardian"},

You are cordially invited to the Parent-Teacher Association (PTA) Meeting for ${school.currentTerm} ${school.currentYear}.

This is an important meeting to discuss your child's progress and the school's development plans. Your attendance is highly encouraged.

Date: ____________
Time: ____________
Venue: ${school.name}

We look forward to seeing you.

${school.name}
${school.phone}`,
  };

  const getPreview = () => {
    const s = selStudent;
    if (!s && templateType!=="pta_invite") { setPreview("Select a student first."); return; }
    const fn = templates[templateType];
    setPreview(fn ? fn(s||{name:"[Student Name]",class:"[Class]",guardian:"Parent/Guardian",fees:0,paid:0}) : "");
  };

  const genAllMessages = () => {
    return classStudents.map(s=>`--- ${s.name} (${s.class}) ---\n${templates[templateType]?.(s)||""}`).join("\n\n========================================\n\n");
  };

  const letterTemplates = {
    arrears: (s) => `${school.name}
${school.address}
Tel: ${school.phone} | Email: ${school.email}
Date: ${todayStr()}

${s?.guardian||"Parent/Guardian"}
[Address]

Dear Parent/Guardian,

RE: OUTSTANDING SCHOOL FEES — ${s?.name?.toUpperCase()||"STUDENT NAME"} (${s?.class})

We write to formally notify you that the school fees for your ward, ${s?.name||"[Name]"}, for ${school.currentTerm} ${school.currentYear} remain outstanding as follows:

Total Fees: ${formatGHS(s?.fees||0)}
Amount Paid: ${formatGHS(s?.paid||0)}
BALANCE DUE: ${formatGHS((s?.fees||0)-(s?.paid||0))}

We kindly request that this balance be settled within FIVE (5) working days of the date of this letter to avoid disruption to your ward's education.

Yours faithfully,

_________________________
${school.principalName||"The Principal"}
${school.name}`,

    disciplinary: (s) => `${school.name}
${school.address}
Date: ${todayStr()}

${s?.guardian||"Parent/Guardian"}

Dear Parent/Guardian,

RE: DISCIPLINARY NOTICE — ${s?.name?.toUpperCase()||"STUDENT NAME"}

We wish to bring to your attention a matter regarding the conduct of your ward, ${s?.name||"[Name]"} (${s?.class}), at this school.

[Describe incident here]

We request that you visit the school on ____________ at ____________ to discuss this matter with the headmaster.

Yours faithfully,

_________________________
${school.principalName||"The Principal"}`,
  };

  const [letterPreview,setLetterPreview]=useState("");

  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>💬 Parent Communication</h2>
      <Tabs tabs={[{key:"whatsapp",label:"💬 WhatsApp Templates"},{key:"letters",label:"📄 Printed Letters"}]} active={tab} onChange={setTab}/>

      {tab==="whatsapp"&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
          <Card style={{ padding:18 }}>
            <h3 style={{ margin:"0 0 14px",fontSize:15 }}>Message Settings</h3>
            <Row label="Template Type"><select value={templateType} onChange={e=>setTemplateType(e.target.value)} style={inp}>
              <option value="fee_reminder">Fee Reminder</option>
              <option value="absence_alert">Absence Alert</option>
              <option value="report_ready">Report Card Ready</option>
              <option value="exam_notice">Exam Notice</option>
              <option value="pta_invite">PTA Invitation</option>
            </select></Row>
            <Row label="For Single Student (optional)"><select value={selStu} onChange={e=>setSelStu(e.target.value)} style={inp}>
              <option value="">All / Broadcast</option>
              {activeStudents.map(s=><option key={s.id} value={s.id}>{s.name} — {s.class}</option>)}
            </select></Row>
            <Row label="Filter by Class (for broadcast)"><select value={selClass} onChange={e=>setSelClass(e.target.value)} style={inp}>
              <option value="">All Classes</option>
              {classes.map(c=><option key={c}>{c}</option>)}
            </select></Row>
            <div style={{ display:"flex",gap:8,marginTop:8 }}>
              <button onClick={getPreview} style={{ ...btnP,flex:1 }}>👁️ Preview</button>
              {!selStu&&<button onClick={()=>setPreview(genAllMessages())} style={{ ...btnP,flex:1,background:"#059669" }}>📋 Generate All</button>}
            </div>
          </Card>
          <Card style={{ padding:18 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
              <h3 style={{ margin:0,fontSize:15 }}>Message Preview</h3>
              {preview&&<button onClick={()=>{navigator.clipboard?.writeText(preview);}} style={{ ...btnSm,background:"#dbeafe",color:"#1d4ed8",padding:"5px 12px" }}>📋 Copy</button>}
            </div>
            {preview?(
              <pre style={{ background:"#f8fafc",borderRadius:10,padding:16,fontSize:12,lineHeight:1.7,whiteSpace:"pre-wrap",margin:0,color:"#374151",maxHeight:400,overflowY:"auto",fontFamily:"inherit" }}>{preview}</pre>
            ):<div style={{ textAlign:"center",color:"#9ca3af",padding:40 }}>Select a template and click Preview</div>}
            {preview&&<p style={{ fontSize:11,color:"#94a3b8",marginTop:8 }}>Copy this message and paste into WhatsApp. For broadcast, scroll through each student's message.</p>}
          </Card>
        </div>
      )}

      {tab==="letters"&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
          <Card style={{ padding:18 }}>
            <h3 style={{ margin:"0 0 14px",fontSize:15 }}>Letter Settings</h3>
            <Row label="Letter Type"><select value={letterType} onChange={e=>setLetterType(e.target.value)} style={inp}>
              <option value="arrears">Fee Arrears Notice</option>
              <option value="disciplinary">Disciplinary Notice</option>
            </select></Row>
            <Row label="Student"><select value={selStu} onChange={e=>setSelStu(e.target.value)} style={inp}>
              <option value="">Select student</option>
              {activeStudents.map(s=><option key={s.id} value={s.id}>{s.name} — {s.class}</option>)}
            </select></Row>
            <div style={{ display:"flex",gap:8,marginTop:8 }}>
              <button onClick={()=>setLetterPreview((letterTemplates[letterType]||letterTemplates.arrears)(selStudent||{name:"[Name]",class:"[Class]",guardian:"Parent/Guardian",fees:0,paid:0}))} style={{ ...btnP,flex:1 }}>👁️ Preview Letter</button>
              {letterPreview&&<button onClick={()=>window.print()} style={{ ...btnP,flex:1,background:"#059669" }}>🖨️ Print</button>}
            </div>
          </Card>
          <Card style={{ padding:18 }}>
            <h3 style={{ margin:"0 0 10px",fontSize:15 }}>Letter Preview</h3>
            {letterPreview?(
              <pre style={{ background:"#fff",borderRadius:10,padding:16,fontSize:12,lineHeight:1.9,whiteSpace:"pre-wrap",margin:0,color:"#0f172a",maxHeight:450,overflowY:"auto",fontFamily:"'Courier New',monospace",border:"1px solid #e5e7eb" }}>{letterPreview}</pre>
            ):<div style={{ textAlign:"center",color:"#9ca3af",padding:40 }}>Select letter type and student, then preview</div>}
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── REPORTS ─────────────────────────────────────────────────
function Reports({ students,grades,attendance,fees,expenses,school,classes,subjects }) {
  const [rt,setRt]=useState("student");
  const [sc,setSc]=useState(classes[5]); const [ss,setSs]=useState(""); const [st,setSt]=useState("Term 1");

  const classStu=students.filter(s=>s.status==="active"&&s.class===sc);
  const sg=(sid,term)=>grades.filter(g=>g.studentId===sid&&g.term===term);
  const avg=arr=>arr.length?Math.round(arr.reduce((a,g)=>a+g.score,0)/arr.length):0;
  const attRate=sid=>{ const all=attendance.filter(a=>a.studentId===sid); return all.length?Math.round(attendance.filter(a=>a.studentId===sid&&a.status==="Present").length/all.length*100):100; };
  const gradeColor=g=>g==="A"?"#16a34a":g==="B"?"#0369a1":g==="C"?"#d97706":"#dc2626";

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .report-card-print, .report-card-print * { visibility: visible; }
          .report-card-print { position: relative; margin: 0 auto; }
        }
      `}</style>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>📋 Reports</h2>
      <Tabs tabs={[{key:"student",label:"Student Report Card"},{key:"class",label:"Class Report"},{key:"subject",label:"Subject Analysis"},{key:"school",label:"School Dashboard"}]} active={rt} onChange={setRt}/>

      {rt==="student"&&(
        <div>
          <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap" }}>
            <select value={sc} onChange={e=>{setSc(e.target.value);setSs("");}} style={{ ...inp,width:160 }}>{classes.map(c=><option key={c}>{c}</option>)}</select>
            <select value={ss} onChange={e=>setSs(e.target.value)} style={{ ...inp,width:220 }}><option value="">Select student</option>{classStu.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select value={st} onChange={e=>setSt(e.target.value)} style={{ ...inp,width:120 }}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select>
          </div>
          {ss&&(()=>{
            const stu=students.find(s=>s.id===ss); const sGrades=sg(ss,st); const av=avg(sGrades); const att=attRate(ss);
            return (
              <Card className="report-card-print" style={{ padding:28 }}>
                <div style={{ textAlign:"center",marginBottom:16,borderBottom:"2px solid #1e40af",paddingBottom:14 }}>
                  <div style={{ fontSize:20,fontWeight:700,color:"#0f172a" }}>{school.name}</div>
                  <div style={{ fontSize:12,color:"#64748b" }}>{school.address} | {school.phone}</div>
                  <div style={{ fontSize:15,fontWeight:700,color:"#1e40af",marginTop:8 }}>ACADEMIC REPORT — {st} 2024/2025</div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16,fontSize:13 }}>
                  <div><strong>Name:</strong> {stu?.name}</div><div><strong>Class:</strong> {stu?.class}</div>
                  <div><strong>Student ID:</strong> {stu?.id}</div>
                  <div><strong>Attendance:</strong> <span style={{ color:att>=80?"#16a34a":"#dc2626",fontWeight:700 }}>{att}%</span></div>
                </div>
                <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13,marginBottom:16 }}>
                  <thead><tr style={{ background:"#1e40af" }}>
                    {["Subject","CA (30)","Exam (70)","Total (100)","Grade","Remark"].map(h=><th key={h} style={{ padding:"8px 12px",textAlign:"left",fontWeight:600,color:"#fff" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {sGrades.length>0?sGrades.map(g=>(
                      <tr key={g.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"7px 12px" }}>{g.subject}</td>
                        <td style={{ padding:"7px 12px" }}>{g.ca??"-"}</td>
                        <td style={{ padding:"7px 12px" }}>{g.exam??"-"}</td>
                        <td style={{ padding:"7px 12px",fontWeight:700 }}>{g.score}</td>
                        <td style={{ padding:"7px 12px" }}><span style={{ fontWeight:700,color:gradeColor(g.grade) }}>{g.grade}</span></td>
                        <td style={{ padding:"7px 12px",color:"#64748b",fontSize:11 }}>{g.score>=80?"Excellent":g.score>=70?"Very Good":g.score>=60?"Good":g.score>=50?"Average":"Needs Improvement"}</td>
                      </tr>
                    )):<tr><td colSpan={6} style={{ padding:20,textAlign:"center",color:"#9ca3af" }}>No grades for {st}</td></tr>}
                  </tbody>
                </table>
                {sGrades.length>0&&(
                  <div style={{ display:"flex",gap:16,padding:12,background:"#f0f9ff",borderRadius:8,marginBottom:16 }}>
                    <div><span style={{ fontSize:12,color:"#0369a1" }}>Average: </span><strong>{av}%</strong></div>
                    <div><span style={{ fontSize:12,color:"#0369a1" }}>Overall: </span><strong style={{ color:gradeColor(calcGrade(av)) }}>{calcGrade(av)}</strong></div>
                    <div><span style={{ fontSize:12,color:"#0369a1" }}>Subjects: </span><strong>{sGrades.length}</strong></div>
                  </div>
                )}
                <div style={{ display:"flex",gap:8 }}>
                  <div style={{ flex:1,borderTop:"1px solid #e5e7eb",paddingTop:8,fontSize:12,color:"#64748b" }}>Class Teacher's Remarks: _______________</div>
                  <div style={{ flex:1,borderTop:"1px solid #e5e7eb",paddingTop:8,fontSize:12,color:"#64748b" }}>Head's Signature: _______________</div>
                </div>
                <button onClick={()=>window.print()} style={{ ...btnP,marginTop:16 }}>🖨️ Print Report Card</button>
              </Card>
            );
          })()}
        </div>
      )}

      {rt==="class"&&(
        <div>
          <div style={{ display:"flex",gap:8,marginBottom:14 }}>
            <select value={sc} onChange={e=>setSc(e.target.value)} style={{ ...inp,width:160 }}>{classes.map(c=><option key={c}>{c}</option>)}</select>
            <select value={st} onChange={e=>setSt(e.target.value)} style={{ ...inp,width:120 }}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select>
          </div>
          {(() => {
            const ranked = [...classStu].map(s=>({ ...s,av:avg(sg(s.id,st)),att:attRate(s.id) })).sort((a,b)=>b.av-a.av)
              .map((s,i)=>({ ...s, position:i+1 }));
            const classSort = useSort(ranked, "position");
            return (
              <Table cols={["#","Student","Avg Score","Grade","Attendance","Fees Status","Position"]}
                colKeys={["position","name","av",null,"att",null,"position"]}
                sortState={classSort}
                rows={classSort.sorted.map((s)=>{ const i=s.position-1; return (
                  <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9",background:i<3?"#fffbeb":"#fff" }}>
                    <TD small color={i<3?"#d97706":"#9ca3af"}>{s.position}{i===0?"🥇":i===1?"🥈":i===2?"🥉":""}</TD>
                    <TD bold>{s.name}</TD>
                    <TD bold color={s.av>=70?"#16a34a":s.av>=50?"#d97706":"#dc2626"}>{s.av?s.av+"%":"No data"}</TD>
                    <td style={{ padding:"8px 12px" }}>{s.av?<Badge text={calcGrade(s.av)} color={gradeColor(calcGrade(s.av))}/>:<span>-</span>}</td>
                    <TD color={s.att>=80?"#16a34a":"#dc2626"} bold>{s.att}%</TD>
                    <td style={{ padding:"8px 12px" }}>{s.fees-s.paid===0?<Badge text="Cleared ✅" color="#166534" bg="#dcfce7"/>:<Badge text={formatGHS(s.fees-s.paid)+" due"} color="#991b1b" bg="#fee2e2"/>}</td>
                    <TD bold>{s.position}</TD>
                  </tr>
                );})} emptyMsg="No students in this class."/>
            );
          })()}
        </div>
      )}

      {rt==="subject"&&(
        <div>
          <div style={{ display:"flex",gap:8,marginBottom:14 }}>
            <select value={sc} onChange={e=>setSc(e.target.value)} style={{ ...inp,width:160 }}>{classes.map(c=><option key={c}>{c}</option>)}</select>
            <select value={st} onChange={e=>setSt(e.target.value)} style={{ ...inp,width:120 }}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:12 }}>
            {subjects.map(sub=>{
              const sg2=grades.filter(g=>g.subject===sub&&g.term===st&&classStu.find(s=>s.id===g.studentId));
              if(!sg2.length) return null;
              const av2=avg(sg2); const pass=sg2.filter(g=>g.score>=50).length;
              return (
                <Card key={sub} style={{ padding:16,borderLeft:`4px solid ${av2>=70?"#16a34a":av2>=50?"#f59e0b":"#dc2626"}` }}>
                  <div style={{ fontSize:14,fontWeight:700,color:"#0f172a",marginBottom:6 }}>{sub}</div>
                  <div style={{ fontSize:24,fontWeight:700,color:av2>=70?"#16a34a":av2>=50?"#d97706":"#dc2626" }}>{av2}%</div>
                  <div style={{ fontSize:11,color:"#64748b" }}>Class average</div>
                  <div style={{ fontSize:11,color:"#94a3b8",marginTop:4 }}>{pass}/{sg2.length} passed</div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {rt==="school"&&(
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginBottom:20 }}>
            <StatCard icon="🎒" label="Total Students" value={students.filter(s=>s.status==="active").length} color="#3b82f6"/>
            <StatCard icon="👥" label="Total Staff" value={0} color="#8b5cf6"/>
            <StatCard icon="💰" label="Total Fees Collected" value={formatGHS(fees.reduce((a,f)=>a+f.paid,0))} color="#10b981"/>
            <StatCard icon="📤" label="Total Expenses" value={formatGHS(expenses.reduce((a,e)=>a+e.amount,0))} color="#f59e0b"/>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
            <Card style={{ padding:18 }}>
              <h3 style={{ margin:"0 0 12px",fontSize:15 }}>Students by Section</h3>
              {[["Nursery/KG",students.filter(s=>s.status==="active"&&s.section==="nursery").length,"#ec4899"],["Primary",students.filter(s=>s.status==="active"&&s.section==="primary").length,"#3b82f6"],["JHS",students.filter(s=>s.status==="active"&&s.section==="jhs").length,"#8b5cf6"]].map(([l,v,c])=>(
                <div key={l} style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
                  <span>{l}</span><span style={{ fontWeight:700,color:c }}>{v} students</span>
                </div>
              ))}
            </Card>
            <Card style={{ padding:18 }}>
              <h3 style={{ margin:"0 0 12px",fontSize:15 }}>Fee Collection Rate</h3>
              {["primary","jhs","nursery"].map(sec=>{
                const secStu=students.filter(s=>s.status==="active"&&s.section===sec);
                const totalFees=secStu.reduce((a,s)=>a+s.fees,0);
                const totalPaid=secStu.reduce((a,s)=>a+s.paid,0);
                const rate=totalFees?Math.round((totalPaid/totalFees)*100):0;
                return (
                  <div key={sec} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3 }}>
                      <span style={{ textTransform:"capitalize" }}>{sec}</span><span style={{ fontWeight:600 }}>{rate}%</span>
                    </div>
                    <div style={{ height:8,background:"#f1f5f9",borderRadius:4 }}>
                      <div style={{ height:8,borderRadius:4,background:rate>=80?"#16a34a":"#f59e0b",width:`${rate}%` }}/>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ID CARDS ────────────────────────────────────────────────
function IDCards({ students,users,school,classes }) {
  const [type,setType]=useState("student"); const [selId,setSelId]=useState(""); const [preview,setPreview]=useState(null);
  const all=type==="student"?students.filter(s=>s.status==="active"):users.filter(u=>u.active);
  const roleColors={ Admin:"#7c3aed",Headmaster:"#1d4ed8",HOD:"#0369a1",Teacher:"#059669","Account Office":"#d97706",Librarian:"#6d28d9","Non-Teaching Staff":"#6b7280" };

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .id-card-print, .id-card-print * { visibility: visible; }
          .id-card-print { position: relative; page-break-inside: avoid; margin: 0 auto 16px; }
        }
      `}</style>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>🪪 ID Card Generator</h2>
      <div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap" }}>
        <select value={type} onChange={e=>{setType(e.target.value);setSelId("");setPreview(null);}} style={{ ...inp,width:140 }}><option value="student">Student</option><option value="staff">Staff</option></select>
        <select value={selId} onChange={e=>setSelId(e.target.value)} style={{ ...inp,flex:1 }}><option value="">Select person</option>{all.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button onClick={()=>setPreview(all.find(p=>p.id===selId)||null)} style={btnP}>Generate</button>
        <button onClick={()=>setPreview("ALL")} style={{ ...btnP,background:"#059669" }}>All {type==="student"?"Students":"Staff"}</button>
      </div>

      {preview&&preview!=="ALL"&&(
        <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:16 }}>
          <IDCard person={preview} type={type} school={school} roleColors={roleColors}/>
          <button onClick={()=>window.print()} style={btnP}>🖨️ Print</button>
        </div>
      )}
      {preview==="ALL"&&(
        <div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
            <p style={{ margin:0,color:"#64748b",fontSize:13 }}>{all.length} cards</p>
            <button onClick={()=>window.print()} style={btnP}>🖨️ Print All</button>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16 }}>
            {all.map(p=><IDCard key={p.id} person={p} type={type} school={school} roleColors={roleColors}/>)}
          </div>
        </div>
      )}
    </div>
  );
}

// Deterministic pseudo-QR pattern generated from the person's ID — a visual
// verification pattern unique to each ID. Not a scannable QR code (that needs
// a dedicated QR library/printer setup), but consistent, unique per-person,
// and much better than a plain placeholder square.
function pseudoQrCells(seedStr, gridSize=7) {
  let seed=0; for(let i=0;i<seedStr.length;i++) seed=(seed*31+seedStr.charCodeAt(i))>>>0;
  const rand=()=>{ seed=(seed*1103515245+12345)>>>0; return (seed>>>16)&0xff; };
  const cells=[];
  for(let r=0;r<gridSize;r++){ const row=[]; for(let c=0;c<gridSize;c++){ row.push(rand()%3===0); } cells.push(row); }
  return cells;
}
function PseudoQR({ id, size=44, dark="#0f172a" }) {
  const grid=7; const cells=pseudoQrCells(id,grid); const cell=size/grid;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius:4 }}>
      <rect width={size} height={size} fill={dark}/>
      {cells.map((row,r)=>row.map((on,c)=>on?<rect key={`${r}-${c}`} x={c*cell} y={r*cell} width={cell} height={cell} fill="#fff"/>:null))}
      {/* corner markers, like a real QR's finder patterns */}
      {[[0,0],[grid-2,0],[0,grid-2]].map(([cx,cy],i)=>(
        <rect key={i} x={cx*cell} y={cy*cell} width={cell*2} height={cell*2} fill="none" stroke="#fff" strokeWidth={1}/>
      ))}
    </svg>
  );
}

function IDCard({ person,type,school,roleColors }) {
  const bg=type==="staff"?(roleColors[person.role]||"#1e40af"):"#1e40af";
  return (
    <div className="id-card-print" style={{ width:300,borderRadius:14,overflow:"hidden",boxShadow:"0 4px 16px rgba(0,0,0,0.15)",fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ background:bg,padding:"14px 18px",color:"#fff" }}>
        <div style={{ fontSize:14,fontWeight:700 }}>{school.name}</div>
        <div style={{ fontSize:10,opacity:0.8 }}>{school.motto}</div>
      </div>
      <div style={{ background:"#fff",padding:"14px 18px",display:"flex",gap:12 }}>
        <div style={{ width:54,height:54,borderRadius:10,background:bg+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0,overflow:"hidden" }}>
          {person.photo ? <img src={person.photo} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }}/> : (type==="student"?"🎒":"👤")}
        </div>
        <div>
          <div style={{ fontSize:14,fontWeight:700,color:"#0f172a" }}>{person.name}</div>
          {type==="student"&&<><div style={{ fontSize:11,color:"#64748b" }}>Class: {person.class}</div><div style={{ fontSize:11,color:"#64748b" }}>Guardian: {person.guardian}</div></>}
          {type==="staff"&&<><div style={{ fontSize:11,color:bg,fontWeight:600 }}>{person.role}</div><div style={{ fontSize:10,color:"#64748b" }}>{person.email}</div></>}
        </div>
      </div>
      <div style={{ background:"#f8fafc",padding:"8px 18px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div><div style={{ fontSize:9,color:"#94a3b8" }}>ID</div><div style={{ fontSize:12,fontWeight:700,color:"#1e40af",letterSpacing:1 }}>{person.id}</div></div>
        {type==="staff"&&<div><div style={{ fontSize:9,color:"#94a3b8" }}>CODE</div><div style={{ fontSize:12,fontWeight:700,color:bg }}>{person.code}</div></div>}
        <PseudoQR id={person.id} size={44}/>
      </div>
    </div>
  );
}

// ─── ARCHIVE ─────────────────────────────────────────────────
function Archive({ students,setStudents,users,setUsers,notify,addAudit }) {
  const [tab,setTab]=useState("dropouts");
  const dropped=students.filter(s=>s.status==="dropout");
  const graduated=students.filter(s=>s.status==="graduated");
  const inactive=users.filter(u=>!u.active);
  const droppedSort = useSort(dropped, "name");
  const graduatedSort = useSort(graduated, "name");
  const inactiveSort = useSort(inactive, "name");

  const restore=id=>{ setStudents(p=>p.map(s=>s.id===id?{...s,status:"active"}:s)); addAudit(`Restored: ${id}`,"Archive"); notify("Restored to active"); };
  const graduate=id=>{ setStudents(p=>p.map(s=>s.id===id?{...s,status:"graduated"}:s)); addAudit(`Graduated: ${id}`,"Archive"); notify("Marked as graduated"); };

  const cols=["ID","Name","Class","Guardian","Phone","Status","Actions"];
  const colKeys=[null,"name","class","guardian","phone","status",null];
  const rows=(list)=>list.map(s=>(
    <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
      <TD small color="#6b7280">{s.id}</TD><TD bold>{s.name}</TD><TD>{s.class}</TD>
      <TD>{s.guardian}</TD><TD small>{s.phone}</TD>
      <td style={{ padding:"8px 12px" }}><Badge text={s.status} color={s.status==="dropout"?"#991b1b":"#1d4ed8"} bg={s.status==="dropout"?"#fee2e2":"#dbeafe"}/></td>
      <td style={{ padding:"8px 12px",display:"flex",gap:4 }}>
        <button onClick={()=>restore(s.id)} style={{ ...btnSm,background:"#dcfce7",color:"#166534" }}>Restore</button>
        {s.status==="dropout"&&<button onClick={()=>graduate(s.id)} style={{ ...btnSm,background:"#dbeafe",color:"#1d4ed8" }}>Graduate</button>}
      </td>
    </tr>
  ));

  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>🗄️ Archive & Records</h2>
      <Tabs tabs={[{key:"dropouts",label:`Dropouts (${dropped.length})`},{key:"graduated",label:`Graduated (${graduated.length})`},{key:"staff",label:`Former Staff (${inactive.length})`}]} active={tab} onChange={setTab}/>
      {(tab==="dropouts")&&<Table cols={cols} colKeys={colKeys} sortState={droppedSort} rows={rows(droppedSort.sorted)} emptyMsg="No dropout records."/>}
      {(tab==="graduated")&&<Table cols={cols} colKeys={colKeys} sortState={graduatedSort} rows={rows(graduatedSort.sorted)} emptyMsg="No graduated records."/>}
      {tab==="staff"&&(
        <Table cols={["ID","Code","Name","Role","Email"]}
          colKeys={[null,"code","name","role","email"]}
          sortState={inactiveSort}
          rows={inactiveSort.sorted.map(u=>(
            <tr key={u.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
              <TD small color="#6b7280">{u.id}</TD><TD bold color="#6b7280">{u.code}</TD>
              <TD bold>{u.name}</TD><TD>{u.role}</TD><TD small color="#6b7280">{u.email}</TD>
            </tr>
          ))} emptyMsg="No former staff."/>
      )}
    </div>
  );
}

// ─── AUDIT LOG ───────────────────────────────────────────────
function AuditLog({ auditLog,users }) {
  const [search,setSearch]=useState("");
  const filtered=[...auditLog].reverse().filter(l=>!search||(l.user+l.action+l.section).toLowerCase().includes(search.toLowerCase()))
    .map(log=>({ ...log, staffName: users.find(x=>x.code===log.user)?.name, staffRole: users.find(x=>x.code===log.user)?.role }));
  const sort = useSort(filtered, "timestamp", "desc");
  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>🔍 Audit Log</h2>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by staff code, action, section..." style={{ ...inp,maxWidth:400,marginBottom:14 }}/>
      <Table cols={["Timestamp","Staff Code","Name","Role","Action","Section"]}
        colKeys={["timestamp","user","staffName","staffRole","action","section"]}
        sortState={sort}
        rows={sort.sorted.slice(0,100).map(log=>{ const u=users.find(x=>x.code===log.user); return (
          <tr key={log.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
            <TD small color="#6b7280">{log.timestamp}</TD>
            <TD bold color="#1e40af">{log.user}</TD>
            <TD>{u?.name||"—"}</TD>
            <TD small color="#6b7280">{u?.role||"—"}</TD>
            <TD>{log.action}</TD>
            <td style={{ padding:"8px 12px" }}><Badge text={log.section} color="#374151" bg="#f1f5f9"/></td>
          </tr>
        );})} emptyMsg="No audit records."/>
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────
function Settings({ school,setSchool,users,setUsers,notify,addAudit,licInfo,
  students,setStudents,grades,setGrades,mockExams,setMockExams,attendance,setAttendance,
  fees,setFees,expenses,setExpenses,payroll,setPayroll,books,setBooks,borrows,setBorrows,
  nurseryLogs,setNurseryLogs,milestones,setMilestones,examSchedule,setExamSchedule,
  timetables,setTimetables,auditLog,setAuditLog,
  classes,setClasses,classLevels,setClassLevels,subjects,setSubjects,yearArchive,setYearArchive,
  cloudSync }) {
  const [form,setForm]=useState({...school}); const [tab,setTab]=useState("school");
  const [resetId,setResetId]=useState(""); const [newPin,setNewPin]=useState("");
  const [importFile,setImportFile]=useState(null); const [importErr,setImportErr]=useState("");
  const fileInputRef = useRef(null);
  const [newClassName,setNewClassName]=useState(""); const [newClassLevel,setNewClassLevel]=useState("Primary");
  const [newSubject,setNewSubject]=useState("");
  const [cloudMode,setCloudMode]=useState("new"); // "new" | "join"
  const [cloudForm,setCloudForm]=useState({ schoolName:school.name||"" });
  const [joinCode,setJoinCode]=useState("");
  const [cloudBusy,setCloudBusy]=useState(false);
  const [cloudErr,setCloudErr]=useState("");
  const [migrationResult,setMigrationResult]=useState(null);
  const [setupConnectCode,setSetupConnectCode]=useState(null);
  const [codeCopied,setCodeCopied]=useState(false);
  const [syncingNow,setSyncingNow]=useState(false);
  const [syncResult,setSyncResult]=useState("");

  const save=()=>{ setSchool({...form}); addAudit("Updated school settings","Settings"); notify("Settings saved ✅"); };

  const handleEnableCloud=async()=>{
    setCloudBusy(true); setCloudErr("");
    try{
      if(cloudMode==="new"){
        if(!cloudForm.schoolName.trim()){ setCloudErr("Enter a school name."); setCloudBusy(false); return; }
        const { results, connectCode } = await cloudSync.enableNewSchool({ schoolName:cloudForm.schoolName.trim() });
        setMigrationResult(results);
        setSetupConnectCode(connectCode);
        addAudit("Cloud sync enabled — new school registered and existing data migrated","Settings");
        notify("Cloud sync enabled ✅");
      } else {
        if(!joinCode.trim()){ setCloudErr("Paste the Connect Code from your other device."); setCloudBusy(false); return; }
        await cloudSync.joinWithConnectCode(joinCode.trim());
        addAudit("Cloud sync enabled — connected to existing school","Settings");
        notify("Connected ✅");
      }
    } catch(e){
      setCloudErr(e?.message || "Something went wrong connecting to the cloud.");
    } finally {
      setCloudBusy(false);
    }
  };

  const copyConnectCode=()=>{
    const code = setupConnectCode || cloudSync.getConnectCode?.();
    if(!code) return;
    navigator.clipboard?.writeText(code);
    setCodeCopied(true); setTimeout(()=>setCodeCopied(false),2000);
  };

  const handleDisableCloud=()=>{
    if(!confirm("Turn off cloud sync on this device? Local data stays exactly as it is — this only stops syncing to/from the cloud.")) return;
    cloudSync.disable();
    notify("Cloud sync turned off for this device");
  };

  const handleSyncNow=async()=>{
    setSyncingNow(true); setSyncResult("");
    try{
      const result = await cloudSync.syncNow();
      if(result.offline){ setSyncResult("Still offline — nothing could be sent this time."); }
      else if(result.pushed>0){ setSyncResult(`✅ Synced ${result.pushed} record(s) just now.`); }
      else if(result.remaining>0){ setSyncResult(`${result.remaining} record(s) still couldn't sync — check the error details below.`); }
      else { setSyncResult("Everything is already up to date."); }
    } catch(e){ setSyncResult("Something went wrong trying to sync — try again in a moment."); }
    setSyncingNow(false);
    setTimeout(()=>setSyncResult(""),6000);
  };


  const resetPin=()=>{
    if(!resetId||!newPin||newPin.length!==4){ notify("Select staff and enter 4-digit PIN","error"); return; }
    const target = users.find(u=>u.id===resetId);
    const updated = {...target, pin:newPin};
    setUsers(p=>p.map(u=>u.id===resetId?updated:u));
    cloudSync?.writeThrough("staff", updated);
    addAudit(`PIN reset for ${resetId}`,"Settings"); notify("PIN reset successfully"); setResetId(""); setNewPin("");
  };

  const addClass=()=>{
    const name=newClassName.trim();
    if(!name){ notify("Enter a class name","error"); return; }
    if(classes.includes(name)){ notify("That class already exists","error"); return; }
    setClasses(p=>[...p,name]);
    setClassLevels(p=>({...p,[name]:newClassLevel}));
    setTimetables(prev=>({ ...prev, [name]: generateTimetable(name, subjects, cls=>({...classLevels,[name]:newClassLevel})[cls]) }));
    addAudit(`Added class: ${name} (${newClassLevel})`,"Settings");
    notify(`Class "${name}" added ✅`); setNewClassName("");
  };

  const removeClass=(cls)=>{
    const inUse = students.some(s=>s.class===cls && s.status==="active");
    if(inUse){ notify("Can't remove a class with active students. Move them first.","error"); return; }
    setClasses(p=>p.filter(c=>c!==cls));
    setClassLevels(p=>{ const n={...p}; delete n[cls]; return n; });
    setTimetables(p=>{ const n={...p}; delete n[cls]; return n; });
    addAudit(`Removed class: ${cls}`,"Settings"); notify("Class removed");
  };

  const addSubject=()=>{
    const name=newSubject.trim();
    if(!name){ notify("Enter a subject name","error"); return; }
    if(subjects.includes(name)){ notify("That subject already exists","error"); return; }
    setSubjects(p=>[...p,name]);
    addAudit(`Added subject: ${name}`,"Settings"); notify(`Subject "${name}" added ✅`); setNewSubject("");
  };

  const removeSubject=(sub)=>{
    const inUse = grades.some(g=>g.subject===sub);
    if(inUse){ notify("Can't remove a subject with existing grade records.","error"); return; }
    setSubjects(p=>p.filter(s=>s!==sub));
    addAudit(`Removed subject: ${sub}`,"Settings"); notify("Subject removed");
  };

  const exportData=()=>{
    const data={ version:"5.3", exportDate:nowStr(),
      school,users,students,grades,mockExams,attendance,fees,expenses,payroll,books,borrows,
      nurseryLogs,milestones,examSchedule,timetables,auditLog,classes,classLevels,subjects,yearArchive };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`EduSmart_Backup_${todayStr()}.json`; a.click();
    notify("Full data exported ✅"); addAudit("Full data exported","Settings");
  };

  const handleImportFile=(e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    setImportErr("");
    const reader=new FileReader();
    reader.onload=(ev)=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(!data.school||!data.users){ setImportErr("This doesn't look like a valid EduSmart backup file."); return; }
        setImportFile(data);
      }catch(err){ setImportErr("Could not read this file — make sure it's a valid EduSmart JSON backup."); }
    };
    reader.readAsText(file);
  };

  const confirmRestore=()=>{
    if(!importFile) return;
    const d=importFile;
    setSchool(d.school||school); setUsers(d.users||users);
    if(d.students) setStudents(d.students);
    if(d.grades) setGrades(d.grades);
    if(d.mockExams) setMockExams(d.mockExams);
    if(d.attendance) setAttendance(d.attendance);
    if(d.fees) setFees(d.fees);
    if(d.expenses) setExpenses(d.expenses);
    if(d.payroll) setPayroll(d.payroll);
    if(d.books) setBooks(d.books);
    if(d.borrows) setBorrows(d.borrows);
    if(d.nurseryLogs) setNurseryLogs(d.nurseryLogs);
    if(d.milestones) setMilestones(d.milestones);
    if(d.examSchedule) setExamSchedule(d.examSchedule);
    if(d.timetables) setTimetables(d.timetables);
    if(d.auditLog) setAuditLog(d.auditLog);
    if(d.classes) setClasses(d.classes);
    if(d.classLevels) setClassLevels(d.classLevels);
    if(d.subjects) setSubjects(d.subjects);
    if(d.yearArchive) setYearArchive(d.yearArchive);

    // Restoring a backup bypasses the normal per-record save points
    // entirely, so cloud sync (which only hooks into those save
    // points) would otherwise never learn any of this happened. Push
    // every restored table in one batched call each — not one call
    // per record, which for a few hundred students used to mean a
    // few hundred sequential network round-trips (minutes of the app
    // looking stuck, with no error, while it silently worked through
    // the backlog one record at a time).
    if (cloudSync?.enabled) {
      cloudSync.writeThroughBulk("students", d.students||[]);
      cloudSync.writeThroughBulk("attendance", d.attendance||[]);
      cloudSync.writeThroughBulk("grades", d.grades||[]);
      cloudSync.writeThroughBulk("fees", d.fees||[]);
      cloudSync.writeThroughBulk("staff", d.users||[]);
      notify("Backup restored ✅ — syncing to the cloud in the background");
    } else {
      notify("Backup restored ✅");
    }

    addAudit(`Restored backup from ${d.exportDate||"unknown date"}`,"Settings");
    setImportFile(null);
    if(fileInputRef.current) fileInputRef.current.value="";
  };

  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:20,fontWeight:700,color:"#0f172a" }}>⚙️ Settings</h2>
      <Tabs tabs={[{key:"school",label:"🏫 School Profile"},{key:"classes",label:"🏷️ Classes & Subjects"},{key:"security",label:"🔐 Security"},{key:"data",label:"💾 Data & Backup"},{key:"cloud",label:"☁️ Cloud Sync"},{key:"licence",label:"🔑 Licence"}]} active={tab} onChange={setTab}/>

      {tab==="school"&&(
        <Card style={{ padding:24,maxWidth:580 }}>
          <h3 style={{ margin:"0 0 16px",fontSize:16 }}>School Profile (appears on all receipts, reports, ID cards)</h3>
          <Row label="School Name"><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={inp}/></Row>
          <Row label="Address"><input value={form.address} onChange={e=>setForm(p=>({...p,address:e.target.value}))} style={inp}/></Row>
          <Row label="Phone"><input value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} style={inp}/></Row>
          <Row label="Email"><input value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} style={inp}/></Row>
          <Row label="School Motto"><input value={form.motto} onChange={e=>setForm(p=>({...p,motto:e.target.value}))} style={inp}/></Row>
          <Row label="Principal/Head's Name"><input value={form.principalName||""} onChange={e=>setForm(p=>({...p,principalName:e.target.value}))} style={inp}/></Row>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
            <Row label="Current Term"><select value={form.currentTerm} onChange={e=>setForm(p=>({...p,currentTerm:e.target.value}))} style={inp}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></Row>
            <Row label="Academic Year"><input value={form.currentYear} onChange={e=>setForm(p=>({...p,currentYear:e.target.value}))} style={inp}/></Row>
          </div>
          <button onClick={save} style={{ ...btnP,marginTop:16 }}>Save Settings</button>
        </Card>
      )}

      {tab==="classes"&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
          <Card style={{ padding:22 }}>
            <h3 style={{ margin:"0 0 6px",fontSize:16 }}>Classes</h3>
            <p style={{ fontSize:12,color:"#64748b",marginBottom:14 }}>Add a new class (e.g. a second stream, or a special class). It's immediately available across Students, Grades, Attendance, Exams, and Timetable.</p>
            <div style={{ display:"flex",gap:8,marginBottom:16 }}>
              <input value={newClassName} onChange={e=>setNewClassName(e.target.value)} placeholder="e.g. Class 7A" style={{ ...inp,flex:1 }}/>
              <select value={newClassLevel} onChange={e=>setNewClassLevel(e.target.value)} style={{ ...inp,width:140 }}>
                {CLASS_LEVELS.map(l=><option key={l}>{l}</option>)}
              </select>
              <button onClick={addClass} style={btnP}>+ Add</button>
            </div>
            <div style={{ maxHeight:380,overflowY:"auto" }}>
              {classes.map(cls=>(
                <div key={cls} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
                  <span>{cls} <Badge text={classLevels[cls]||"Primary"} color="#374151" bg="#f1f5f9"/></span>
                  <button onClick={()=>removeClass(cls)} style={{ ...btnSm,background:"#fee2e2",color:"#991b1b" }}>Remove</button>
                </div>
              ))}
            </div>
          </Card>
          <Card style={{ padding:22 }}>
            <h3 style={{ margin:"0 0 6px",fontSize:16 }}>Subjects</h3>
            <p style={{ fontSize:12,color:"#64748b",marginBottom:14 }}>Master subject list used across Grades, Exams, and Timetable. Physical Education and Creative Arts are automatically excluded from formal exam scheduling.</p>
            <div style={{ display:"flex",gap:8,marginBottom:16 }}>
              <input value={newSubject} onChange={e=>setNewSubject(e.target.value)} placeholder="e.g. Computing" style={{ ...inp,flex:1 }}/>
              <button onClick={addSubject} style={btnP}>+ Add</button>
            </div>
            <div style={{ maxHeight:380,overflowY:"auto" }}>
              {subjects.map(sub=>(
                <div key={sub} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
                  <span>{sub}</span>
                  <button onClick={()=>removeSubject(sub)} style={{ ...btnSm,background:"#fee2e2",color:"#991b1b" }}>Remove</button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab==="security"&&(
        <Card style={{ padding:24,maxWidth:480 }}>
          <h3 style={{ margin:"0 0 16px",fontSize:16 }}>Reset Staff PIN</h3>
          <p style={{ fontSize:13,color:"#64748b",marginBottom:16 }}>Admin can reset any staff member's PIN without knowing the old one.</p>
          <Row label="Select Staff Member"><select value={resetId} onChange={e=>setResetId(e.target.value)} style={inp}><option value="">-- Select --</option>{users.filter(u=>u.active).map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></Row>
          <Row label="New PIN (4 digits)"><input type="password" value={newPin} onChange={e=>setNewPin(e.target.value)} maxLength={4} style={inp}/></Row>
          <button onClick={resetPin} style={{ ...btnP,marginTop:8 }}>Reset PIN</button>
          <div style={{ marginTop:24,borderTop:"1px solid #e5e7eb",paddingTop:16 }}>
            <h3 style={{ margin:"0 0 10px",fontSize:15 }}>Security Info</h3>
            <div style={{ background:"#f0f9ff",borderRadius:8,padding:12,fontSize:13,lineHeight:2 }}>
              <div>✅ Session auto-logout after <strong>15 minutes</strong> of inactivity</div>
              <div>🔒 Account locks after <strong>3 failed PIN attempts</strong></div>
              <div>📋 All actions logged in Audit Log with staff code</div>
            </div>
          </div>
        </Card>
      )}

      {tab==="data"&&(
        <Card style={{ padding:24,maxWidth:480 }}>
          <h3 style={{ margin:"0 0 12px",fontSize:16 }}>Data Export & Backup</h3>
          <p style={{ fontSize:13,color:"#64748b",marginBottom:16 }}>Export a complete backup — students, staff, grades, attendance, fees, payroll, library, nursery logs, timetables and audit log all included.</p>
          <button onClick={exportData} style={{ ...btnP,marginBottom:16 }}>📥 Export Full Backup (JSON)</button>
          <div style={{ background:"#fff7ed",borderRadius:8,padding:12,fontSize:12,color:"#9a3412",marginBottom:24 }}>
            ⚠️ Data is stored in your browser only. Export regularly — clearing browser data or switching devices will lose everything not backed up.
          </div>

          <h3 style={{ margin:"0 0 12px",fontSize:16,borderTop:"1px solid #e5e7eb",paddingTop:20 }}>Restore from Backup</h3>
          <p style={{ fontSize:13,color:"#64748b",marginBottom:12 }}>Upload a previously exported EduSmart JSON file to restore all data. This replaces current data for any section included in the backup.</p>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} style={{ ...inp,padding:8 }}/>
          {importErr&&<p style={{ color:"#dc2626",fontSize:12,marginTop:8 }}>{importErr}</p>}
          {importFile&&(
            <div style={{ background:"#eff6ff",borderRadius:8,padding:12,marginTop:12,fontSize:12,color:"#1e40af" }}>
              <div><strong>Backup found:</strong> exported {importFile.exportDate||"unknown date"}</div>
              <div>{importFile.students?.length||0} students, {importFile.users?.length||0} staff, {importFile.grades?.length||0} grade records, {importFile.fees?.length||0} fee records</div>
              <button onClick={confirmRestore} style={{ ...btnP,marginTop:10,background:"#dc2626" }}>⚠️ Confirm Restore (Overwrites Current Data)</button>
            </div>
          )}
        </Card>
      )}

      {tab==="cloud"&&(
        <Card style={{ padding:24,maxWidth:560 }}>
          <h3 style={{ margin:"0 0 6px",fontSize:16 }}>☁️ Cloud Sync</h3>
          <p style={{ fontSize:12,color:"#64748b",marginBottom:18 }}>
            Lets multiple devices (the office PC, a teacher's laptop, the browser version) share the same live student, staff, attendance, grade, and fee data — working offline stays fully supported, changes just sync automatically once a connection is available.
          </p>

          {!cloudSync?.enabled ? (
            <>
              <div style={{ display:"flex",gap:8,marginBottom:16 }}>
                <button onClick={()=>{setCloudMode("new");setCloudErr("");}} style={{ ...btnSm,flex:1,padding:"10px",background:cloudMode==="new"?"#1e40af":"#f1f5f9",color:cloudMode==="new"?"#fff":"#374151" }}>Set Up New (first device)</button>
                <button onClick={()=>{setCloudMode("join");setCloudErr("");}} style={{ ...btnSm,flex:1,padding:"10px",background:cloudMode==="join"?"#1e40af":"#f1f5f9",color:cloudMode==="join"?"#fff":"#374151" }}>Add This Device</button>
              </div>

              {cloudMode==="new" && !setupConnectCode && (
                <>
                  <div style={{ background:"#f0f9ff",borderRadius:8,padding:12,fontSize:12,color:"#0369a1",marginBottom:14 }}>
                    This is the first device connecting this school to the cloud. Your existing local students, staff, attendance, grades, and fees will be uploaded automatically as the starting dataset — nothing is deleted or changed locally.
                  </div>
                  <Row label="School Name"><input value={cloudForm.schoolName} onChange={e=>setCloudForm(p=>({...p,schoolName:e.target.value}))} style={inp}/></Row>
                  {cloudErr&&<p style={{ color:"#dc2626",fontSize:13,marginBottom:10 }}>{cloudErr}</p>}
                  <button onClick={handleEnableCloud} disabled={cloudBusy} style={{ ...btnP,width:"100%",opacity:cloudBusy?0.6:1 }}>
                    {cloudBusy?"Setting up...":"Enable Cloud Sync"}
                  </button>
                </>
              )}

              {cloudMode==="new" && setupConnectCode && (
                <div style={{ background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:16 }}>
                  <div style={{ fontSize:13,fontWeight:600,color:"#166534",marginBottom:8 }}>✅ Cloud Sync is on. Save this Connect Code — you'll need it to add any other device to this school.</div>
                  {migrationResult&&(
                    <div style={{ fontSize:12,color:"#166534",marginBottom:10 }}>
                      Uploaded: {migrationResult.students} students, {migrationResult.staff||0} staff, {migrationResult.attendance} attendance records, {migrationResult.grades} grades, {migrationResult.fees} fee records.
                    </div>
                  )}
                  <div style={{ background:"#fff",border:"1px solid #d1d5db",borderRadius:8,padding:10,fontFamily:"monospace",fontSize:11,wordBreak:"break-all",marginBottom:10 }}>{setupConnectCode}</div>
                  <button onClick={copyConnectCode} style={{ ...btnP,width:"100%",background:codeCopied?"#166534":"#1e40af" }}>{codeCopied?"✅ Copied!":"📋 Copy Connect Code"}</button>
                </div>
              )}

              {cloudMode==="join" && (
                <>
                  <div style={{ background:"#f0f9ff",borderRadius:8,padding:12,fontSize:12,color:"#0369a1",marginBottom:14 }}>
                    Use this on any additional device (a teacher's laptop, the browser version) once another device has already set up Cloud Sync for this school. Paste the Connect Code shown on that device's Settings → Cloud Sync page — no need to re-enter the school profile or create another admin account.
                  </div>
                  <Row label="Connect Code"><textarea value={joinCode} onChange={e=>setJoinCode(e.target.value)} style={{ ...inp,height:80,fontFamily:"monospace",fontSize:12,resize:"vertical" }} placeholder="EDUCONNECT-..."/></Row>
                  {cloudErr&&<p style={{ color:"#dc2626",fontSize:13,marginBottom:10 }}>{cloudErr}</p>}
                  <button onClick={handleEnableCloud} disabled={cloudBusy} style={{ ...btnP,width:"100%",opacity:cloudBusy?0.6:1 }}>
                    {cloudBusy?"Connecting...":"Connect This Device"}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap" }}>
                <Badge
                  text={cloudSync.status.phase==="online"?"🟢 Online":cloudSync.status.phase==="offline"?"🔴 Offline":"🟡 Connecting"}
                  color={cloudSync.status.phase==="online"?"#166534":cloudSync.status.phase==="offline"?"#991b1b":"#92400e"}
                  bg={cloudSync.status.phase==="online"?"#dcfce7":cloudSync.status.phase==="offline"?"#fee2e2":"#fef3c7"}
                />
                {cloudSync.status.pending>0 && <Badge text={`${cloudSync.status.pending} pending sync`} color="#92400e" bg="#fef3c7"/>}
                <button onClick={handleSyncNow} disabled={syncingNow} style={{ ...btnSm,padding:"6px 14px",background:"#dbeafe",color:"#1d4ed8",opacity:syncingNow?0.6:1 }}>
                  {syncingNow?"Syncing...":"🔄 Sync Now"}
                </button>
              </div>
              {syncResult && <p style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>{syncResult}</p>}
              <p style={{ fontSize:13,color:"#374151",marginBottom:16 }}>
                This device is connected to cloud sync. Students, Staff, Attendance, Grades, and Fees stay in sync with every other device linked to this school — offline changes queue automatically and upload once a connection returns.
              </p>

              {cloudSync.status.stuck?.length>0 && (
                <div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:14,marginBottom:16 }}>
                  <div style={{ fontSize:13,fontWeight:600,color:"#991b1b",marginBottom:8 }}>⚠️ {cloudSync.status.stuck.length} record(s) failing to sync — here's why:</div>
                  <div style={{ maxHeight:200,overflowY:"auto" }}>
                    {cloudSync.status.stuck.slice(0,10).map((s,i)=>(
                      <div key={i} style={{ fontSize:11,color:"#7f1d1d",padding:"4px 0",borderBottom:"1px solid #fee2e2" }}>
                        <strong>{s.table}</strong>{s.name?` (${s.name})`:""} — tried {s.attempts}× — {s.lastError||"unknown error"}
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize:11,color:"#7f1d1d",marginTop:8 }}>This is exactly the error the server sent back — worth copying and sharing if you need help resolving it.</p>
                </div>
              )}

              <div style={{ background:"#f8fafc",borderRadius:8,padding:14,marginBottom:16 }}>
                <div style={{ fontSize:12,fontWeight:600,color:"#374151",marginBottom:8 }}>Connect Code for adding another device</div>
                <div style={{ background:"#fff",border:"1px solid #d1d5db",borderRadius:8,padding:10,fontFamily:"monospace",fontSize:11,wordBreak:"break-all",marginBottom:10 }}>{cloudSync.getConnectCode?.()}</div>
                <button onClick={copyConnectCode} style={{ ...btnS,width:"100%",background:codeCopied?"#dcfce7":undefined,color:codeCopied?"#166534":undefined }}>{codeCopied?"✅ Copied!":"📋 Copy Connect Code"}</button>
              </div>

              <button onClick={handleDisableCloud} style={{ ...btnS,background:"#fee2e2",color:"#991b1b" }}>Turn Off Cloud Sync on This Device</button>
            </>
          )}
        </Card>
      )}

      {tab==="licence"&&(
        <Card style={{ padding:24,maxWidth:480 }}>
          <h3 style={{ margin:"0 0 16px",fontSize:16 }}>Licence</h3>
          <div style={{ background:"#f0f9ff",borderRadius:10,padding:16,fontSize:13,lineHeight:2,marginBottom:16 }}>
            <div><strong>Product:</strong> EduSmart School Manager v{APP_VERSION}</div>
            <div><strong>Type:</strong> <Badge text={licInfo?.type?.toUpperCase()||"—"} color={licInfo?.type==="pro"?"#166534":"#1d4ed8"} bg={licInfo?.type==="pro"?"#dcfce7":"#dbeafe"}/></div>
            <div><strong>Expiry:</strong> {licInfo?.lifetime ? "Lifetime — never expires" : (licInfo?.expiry || "—")}</div>
            <div><strong>Developer:</strong> Gilbert Oscar Prah</div>
            <div><strong>Contact:</strong> 0597147460 | eagleeyefx1@gmail.com</div>
          </div>
          <h4 style={{ fontSize:14,margin:"0 0 10px" }}>Pricing</h4>
          {[["Basic","GH₵ 1,500/yr","1 school, full access"],["Pro","GH₵ 3,500/yr","Multiple branches, priority support"]].map(([n,p,d])=>(
            <div key={n} style={{ display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #f1f5f9",fontSize:13 }}>
              <span><strong>{n}</strong> — {d}</span><span style={{ fontWeight:700,color:"#1e40af" }}>{p}</span>
            </div>
          ))}
          <div style={{ marginTop:14,background:"#fffbeb",borderRadius:8,padding:12,fontSize:12,color:"#92400e" }}>
            📞 Renew or upgrade: <strong>0597147460</strong> | <strong>eagleeyefx1@gmail.com</strong>
          </div>
        </Card>
      )}
    </div>
  );
}
