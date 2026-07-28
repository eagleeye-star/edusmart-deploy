import { useState, useEffect, useRef } from "react";

// ============================================================
// LICENCE & SEED DATA
// ============================================================
const LICENCE_KEYS = {
  "EDUSMART-TRIAL-2024": { type: "trial", expiry: null, termLimit: 1 },
  "EDUSMART-BASIC-ABCD": { type: "basic", expiry: "2026-12-31" },
  "EDUSMART-PRO-XYZ9":   { type: "pro",   expiry: "2027-06-30" },
  "EDUSMART-DEMO-0000":  { type: "trial", expiry: null, termLimit: 1 },
};

const INITIAL_SCHOOL = {
  name: "Eikwe Basic School",
  address: "Eikwe, Western Region, Ghana",
  phone: "0XXXXXXXXX",
  email: "info@eikwebasic.edu.gh",
  logo: "",
  motto: "Excellence in Education",
  currentTerm: "Term 2",
  currentYear: "2024/2025",
};

const ROLES = ["Admin","Headmaster","HOD","Teacher","Account Office","Librarian","Non-Teaching Staff"];

const INITIAL_USERS = [
  { id:"USR001", name:"Gilbert Oscar Prah", role:"Admin",           pin:"1234", code:"ADM001", email:"admin@school.gh",    active:true },
  { id:"USR002", name:"Mr. Kwame Asante",   role:"Headmaster",      pin:"2345", code:"HM001",  email:"head@school.gh",     active:true },
  { id:"USR003", name:"Mrs. Ama Boateng",   role:"HOD",             pin:"3456", code:"HOD001", email:"hod@school.gh",      active:true },
  { id:"USR004", name:"Mr. Kofi Mensah",    role:"Teacher",         pin:"4567", code:"TCH001", email:"kofi@school.gh",     active:true, classAssigned:"Class 6A" },
  { id:"USR005", name:"Ms. Abena Frimpong", role:"Teacher",         pin:"5678", code:"TCH002", email:"abena@school.gh",    active:true, classAssigned:"Class 5B" },
  { id:"USR006", name:"Mrs. Esi Andoh",     role:"Account Office",  pin:"6789", code:"ACC001", email:"accounts@school.gh", active:true },
  { id:"USR007", name:"Mr. Yaw Tetteh",     role:"Librarian",       pin:"7890", code:"LIB001", email:"library@school.gh",  active:true },
  { id:"USR008", name:"Mr. Nana Osei",      role:"Non-Teaching Staff", pin:"8901", code:"NTS001", email:"nts@school.gh",  active:true },
];

const CLASSES = ["Class 1A","Class 1B","Class 2A","Class 2B","Class 3A","Class 4A","Class 5A","Class 5B","Class 6A","Class 6B","JHS 1","JHS 2","JHS 3"];

const SUBJECTS = ["Mathematics","English Language","Science","Social Studies","ICT","French","RME","Creative Arts","Ghanaian Language","Physical Education","History","Pre-Technical Skills"];

const INITIAL_STUDENTS = [
  { id:"STU001", name:"Kwame Agyei",      class:"Class 6A", dob:"2012-03-15", gender:"Male",   guardian:"Mr. Agyei",   phone:"0241000001", fees:500, paid:500, status:"active" },
  { id:"STU002", name:"Ama Sarpong",      class:"Class 6A", dob:"2012-07-22", gender:"Female", guardian:"Mrs. Sarpong",phone:"0241000002", fees:500, paid:300, status:"active" },
  { id:"STU003", name:"Kofi Mensah Jr",   class:"Class 5B", dob:"2013-01-10", gender:"Male",   guardian:"Mr. Mensah",  phone:"0241000003", fees:500, paid:500, status:"active" },
  { id:"STU004", name:"Abena Osei",       class:"Class 5B", dob:"2013-09-05", gender:"Female", guardian:"Mrs. Osei",   phone:"0241000004", fees:500, paid:200, status:"active" },
  { id:"STU005", name:"Yaw Darko",        class:"JHS 1",    dob:"2011-11-30", gender:"Male",   guardian:"Mr. Darko",   phone:"0241000005", fees:600, paid:600, status:"active" },
  { id:"STU006", name:"Akua Boateng",     class:"JHS 1",    dob:"2011-06-18", gender:"Female", guardian:"Mrs. Boateng",phone:"0241000006", fees:600, paid:400, status:"active" },
  { id:"STU007", name:"Kweku Asante",     class:"JHS 2",    dob:"2010-04-25", gender:"Male",   guardian:"Mr. Asante",  phone:"0241000007", fees:600, paid:600, status:"active" },
  { id:"STU008", name:"Esi Tetteh",       class:"JHS 3",    dob:"2009-08-12", gender:"Female", guardian:"Mr. Tetteh",  phone:"0241000008", fees:700, paid:350, status:"active" },
  { id:"STU009", name:"Old Graduate One", class:"JHS 3",    dob:"2007-02-01", gender:"Male",   guardian:"Parent",      phone:"0241000009", fees:700, paid:700, status:"graduated" },
  { id:"STU010", name:"Dropped Student",  class:"Class 4A", dob:"2014-05-20", gender:"Male",   guardian:"Parent",      phone:"0241000010", fees:500, paid:100, status:"dropout" },
];

const INITIAL_GRADES = [
  { id:"GRD001", studentId:"STU001", subject:"Mathematics",    class:"Class 6A", score:85, grade:"A", term:"Term 1", year:"2024/2025", enteredBy:"TCH001", date:"2025-01-10" },
  { id:"GRD002", studentId:"STU001", subject:"English Language",class:"Class 6A", score:78, grade:"B", term:"Term 1", year:"2024/2025", enteredBy:"TCH001", date:"2025-01-10" },
  { id:"GRD003", studentId:"STU002", subject:"Mathematics",    class:"Class 6A", score:92, grade:"A", term:"Term 1", year:"2024/2025", enteredBy:"TCH001", date:"2025-01-10" },
  { id:"GRD004", studentId:"STU003", subject:"Science",        class:"Class 5B", score:70, grade:"B", term:"Term 1", year:"2024/2025", enteredBy:"TCH002", date:"2025-01-10" },
];

const INITIAL_ATTENDANCE = [
  { id:"ATT001", studentId:"STU001", class:"Class 6A", date:"2025-01-13", status:"Present", enteredBy:"TCH001" },
  { id:"ATT002", studentId:"STU002", class:"Class 6A", date:"2025-01-13", status:"Absent",  enteredBy:"TCH001" },
  { id:"ATT003", studentId:"STU003", class:"Class 5B", date:"2025-01-13", status:"Present", enteredBy:"TCH002" },
];

const INITIAL_FEES = [
  { id:"FEE001", studentId:"STU001", amount:500, paid:500, balance:0,   term:"Term 1", year:"2024/2025", receiptNo:"RCP001", date:"2025-01-05", enteredBy:"ACC001" },
  { id:"FEE002", studentId:"STU002", amount:500, paid:300, balance:200, term:"Term 1", year:"2024/2025", receiptNo:"RCP002", date:"2025-01-05", enteredBy:"ACC001" },
  { id:"FEE003", studentId:"STU005", amount:600, paid:600, balance:0,   term:"Term 1", year:"2024/2025", receiptNo:"RCP003", date:"2025-01-05", enteredBy:"ACC001" },
  { id:"FEE004", studentId:"STU006", amount:600, paid:400, balance:200, term:"Term 1", year:"2024/2025", receiptNo:"RCP004", date:"2025-01-08", enteredBy:"ACC001" },
];

const INITIAL_EXPENSES = [
  { id:"EXP001", description:"Chalk and Stationery",   amount:450,  date:"2025-01-03", category:"Supplies",     enteredBy:"ACC001" },
  { id:"EXP002", description:"Electricity Bill",        amount:320,  date:"2025-01-05", category:"Utilities",    enteredBy:"ACC001" },
  { id:"EXP003", description:"Cleaning Materials",      amount:200,  date:"2025-01-07", category:"Maintenance",  enteredBy:"ACC001" },
  { id:"EXP004", description:"Staff Welfare",           amount:800,  date:"2025-01-10", category:"Staff",        enteredBy:"ACC001" },
];

const INITIAL_BOOKS = [
  { id:"BK001", title:"Mathematics for Basic Schools",  author:"GES",        isbn:"978-001", copies:15, available:12, category:"Textbook" },
  { id:"BK002", title:"English Language Course Book",   author:"GES",        isbn:"978-002", copies:20, available:18, category:"Textbook" },
  { id:"BK003", title:"Science Made Easy",              author:"Aidoo K.",   isbn:"978-003", copies:10, available:9,  category:"Reference" },
  { id:"BK004", title:"Ghana: Our Heritage",            author:"Ministry",   isbn:"978-004", copies:8,  available:8,  category:"Library" },
  { id:"BK005", title:"Stories of Our Land",            author:"Asante T.",  isbn:"978-005", copies:12, available:10, category:"Fiction" },
];

const INITIAL_BORROWS = [
  { id:"BOR001", bookId:"BK001", borrowerId:"STU001", borrowerType:"Student", borrowDate:"2025-01-10", dueDate:"2025-01-24", returnDate:null, enteredBy:"LIB001" },
  { id:"BOR002", bookId:"BK003", borrowerId:"STU003", borrowerType:"Student", borrowDate:"2025-01-08", dueDate:"2025-01-22", returnDate:"2025-01-15", enteredBy:"LIB001" },
];

const TIMETABLES = {
  "Class 6A": [
    { day:"Monday",    periods:[{time:"7:30-8:30",subject:"Mathematics"},{time:"8:30-9:30",subject:"English Language"},{time:"9:30-10:30",subject:"Science"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"Social Studies"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"ICT"},{time:"14:00-15:00",subject:"Creative Arts"}]},
    { day:"Tuesday",   periods:[{time:"7:30-8:30",subject:"English Language"},{time:"8:30-9:30",subject:"Mathematics"},{time:"9:30-10:30",subject:"RME"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"Science"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"French"},{time:"14:00-15:00",subject:"Physical Education"}]},
    { day:"Wednesday", periods:[{time:"7:30-8:30",subject:"Mathematics"},{time:"8:30-9:30",subject:"Science"},{time:"9:30-10:30",subject:"English Language"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"Creative Arts"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"Social Studies"},{time:"14:00-15:00",subject:"Ghanaian Language"}]},
    { day:"Thursday",  periods:[{time:"7:30-8:30",subject:"Science"},{time:"8:30-9:30",subject:"English Language"},{time:"9:30-10:30",subject:"Mathematics"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"ICT"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"RME"},{time:"14:00-15:00",subject:"French"}]},
    { day:"Friday",    periods:[{time:"7:30-8:30",subject:"Social Studies"},{time:"8:30-9:30",subject:"Mathematics"},{time:"9:30-10:30",subject:"English Language"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"Physical Education"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"Ghanaian Language"},{time:"14:00-15:00",subject:"Creative Arts"}]},
  ],
  "Class 5B": [
    { day:"Monday",    periods:[{time:"7:30-8:30",subject:"English Language"},{time:"8:30-9:30",subject:"Mathematics"},{time:"9:30-10:30",subject:"Science"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"RME"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"Social Studies"},{time:"14:00-15:00",subject:"Physical Education"}]},
    { day:"Tuesday",   periods:[{time:"7:30-8:30",subject:"Mathematics"},{time:"8:30-9:30",subject:"English Language"},{time:"9:30-10:30",subject:"Social Studies"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"Science"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"Creative Arts"},{time:"14:00-15:00",subject:"French"}]},
    { day:"Wednesday", periods:[{time:"7:30-8:30",subject:"Science"},{time:"8:30-9:30",subject:"Mathematics"},{time:"9:30-10:30",subject:"English Language"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"Ghanaian Language"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"ICT"},{time:"14:00-15:00",subject:"RME"}]},
    { day:"Thursday",  periods:[{time:"7:30-8:30",subject:"English Language"},{time:"8:30-9:30",subject:"Science"},{time:"9:30-10:30",subject:"Mathematics"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"Creative Arts"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"French"},{time:"14:00-15:00",subject:"Social Studies"}]},
    { day:"Friday",    periods:[{time:"7:30-8:30",subject:"Mathematics"},{time:"8:30-9:30",subject:"English Language"},{time:"9:30-10:30",subject:"Social Studies"},{time:"10:30-11:00",subject:"Break"},{time:"11:00-12:00",subject:"Ghanaian Language"},{time:"12:00-13:00",subject:"Lunch"},{time:"13:00-14:00",subject:"Physical Education"},{time:"14:00-15:00",subject:"Science"}]},
  ],
};

const AUDIT_LOG_INITIAL = [
  { id:"AUD001", user:"ADM001", action:"System Setup",        section:"Settings",  timestamp:"2025-01-01 08:00:00" },
  { id:"AUD002", user:"TCH001", action:"Entered Grades",      section:"Grades",    timestamp:"2025-01-10 09:15:00" },
  { id:"AUD003", user:"ACC001", action:"Recorded Fee Payment",section:"Finance",   timestamp:"2025-01-05 10:30:00" },
  { id:"AUD004", user:"LIB001", action:"Book Borrowed",       section:"Library",   timestamp:"2025-01-10 11:00:00" },
];

// ============================================================
// ROLE ACCESS MAP
// ============================================================
const ROLE_ACCESS = {
  "Admin":              ["dashboard","students","staff","grades","attendance","finance","library","timetable","reports","settings","archive","idcards","audit"],
  "Headmaster":         ["dashboard","students","staff","grades","attendance","finance","library","timetable","reports","settings","archive","idcards","audit"],
  "HOD":                ["dashboard","students","staff","grades","attendance","finance","library","timetable","reports","settings","archive","idcards","audit"],
  "Teacher":            ["dashboard","grades","attendance","timetable"],
  "Account Office":     ["finance"],
  "Librarian":          ["library"],
  "Non-Teaching Staff": ["dashboard"],
};

// ============================================================
// HELPERS
// ============================================================
const calcGrade = (score) => {
  if (score>=80) return "A"; if (score>=70) return "B"; if (score>=60) return "C";
  if (score>=50) return "D"; if (score>=45) return "E"; return "F";
};

const formatGHS = (n) => `GH₵ ${Number(n||0).toFixed(2)}`;
const today = () => new Date().toISOString().split("T")[0];
const now   = () => new Date().toLocaleString("en-GB");
const uid   = (prefix) => `${prefix}${Date.now().toString().slice(-6)}`;

// ============================================================
// MAIN APP
// ============================================================
export default function EduSmart() {
  // LICENCE
  const [licenced, setLicenced]   = useState(false);
  const [licenceKey, setLicenceKey] = useState("");
  const [licenceInfo, setLicenceInfo] = useState(null);
  const [licError, setLicError]   = useState("");

  // AUTH
  const [loggedIn, setLoggedIn]   = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [pinInput, setPinInput]   = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [authError, setAuthError] = useState("");

  // DATA
  const [school, setSchool]       = useState(INITIAL_SCHOOL);
  const [users, setUsers]         = useState(INITIAL_USERS);
  const [students, setStudents]   = useState(INITIAL_STUDENTS);
  const [grades, setGrades]       = useState(INITIAL_GRADES);
  const [attendance, setAttendance] = useState(INITIAL_ATTENDANCE);
  const [fees, setFees]           = useState(INITIAL_FEES);
  const [expenses, setExpenses]   = useState(INITIAL_EXPENSES);
  const [books, setBooks]         = useState(INITIAL_BOOKS);
  const [borrows, setBorrows]     = useState(INITIAL_BORROWS);
  const [auditLog, setAuditLog]   = useState(AUDIT_LOG_INITIAL);

  // UI
  const [activeSection, setActiveSection] = useState("dashboard");
  const [printMode, setPrintMode] = useState(false);
  const [notification, setNotification] = useState(null);
  const printRef = useRef(null);

  const notify = (msg, type="success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const addAudit = (action, section) => {
    if (!currentUser) return;
    setAuditLog(prev => [...prev, {
      id: uid("AUD"), user: currentUser.code, action, section, timestamp: now()
    }]);
  };

  const canAccess = (section) => {
    if (!currentUser) return false;
    return (ROLE_ACCESS[currentUser.role]||[]).includes(section);
  };

  function doLogin() {
    const user = users.find(u=>u.id===selectedUserId && u.pin===pinInput && u.active);
    if (!user) { setAuthError("Invalid credentials. Check your PIN."); return; }
    setCurrentUser(user);
    setLoggedIn(true);
    setPinInput(""); setAuthError("");
    const sections = ROLE_ACCESS[user.role]||[];
    setActiveSection(sections[0]||"dashboard");
  }

  // ---- LICENCE SCREEN ----
  if (!licenced) {
    return (
      <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0f172a,#1e3a5f)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',sans-serif" }}>
        <div style={{ background:"#fff", borderRadius:16, padding:40, maxWidth:480, width:"90%", boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:48, marginBottom:8 }}>🏫</div>
            <h1 style={{ fontSize:28, fontWeight:700, color:"#0f172a", margin:0 }}>EduSmart</h1>
            <p style={{ color:"#64748b", margin:"6px 0 0" }}>School Management System</p>
          </div>
          <div style={{ background:"#f0f9ff", borderRadius:10, padding:16, marginBottom:20, borderLeft:"4px solid #0ea5e9" }}>
            <p style={{ margin:0, fontSize:13, color:"#0369a1" }}>
              <strong>Trial Key:</strong> EDUSMART-TRIAL-2024 <br/>
              <strong>Demo Key:</strong> EDUSMART-DEMO-0000
            </p>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#374151", display:"block", marginBottom:6 }}>Licence Key</label>
            <input
              value={licenceKey} onChange={e=>setLicenceKey(e.target.value.toUpperCase())}
              placeholder="e.g. EDUSMART-TRIAL-2024"
              style={{ width:"100%", padding:"10px 14px", borderRadius:8, border:"1.5px solid #d1d5db", fontSize:14, boxSizing:"border-box" }}
            />
          </div>
          {licError && <p style={{ color:"#dc2626", fontSize:13, marginBottom:10 }}>{licError}</p>}
          <button
            onClick={() => {
              const k = LICENCE_KEYS[licenceKey.trim()];
              if (!k) { setLicError("Invalid licence key. Contact EduSmart support."); return; }
              if (k.expiry && new Date(k.expiry) < new Date()) { setLicError("Licence expired. Please renew."); return; }
              setLicenceInfo({ ...k, key: licenceKey.trim() });
              setLicenced(true);
              setLicError("");
            }}
            style={{ width:"100%", padding:"12px", background:"#1e3a8a", color:"#fff", border:"none", borderRadius:8, fontSize:15, fontWeight:600, cursor:"pointer" }}
          >Activate & Continue</button>
          <p style={{ textAlign:"center", fontSize:12, color:"#9ca3af", marginTop:12 }}>
            For licence purchase: <strong>EduSmart Support</strong> | GH₵ 500/term or GH₵ 1,500/year
          </p>
        </div>
      </div>
    );
  }

  // ---- LOGIN SCREEN ----
  if (!loggedIn) {
    return (
      <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0f172a,#1e3a5f)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',sans-serif" }}>
        <div style={{ background:"#fff", borderRadius:16, padding:40, maxWidth:440, width:"90%", boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:42, marginBottom:6 }}>🔐</div>
            <h2 style={{ fontSize:22, fontWeight:700, color:"#0f172a", margin:0 }}>Staff Login</h2>
            <p style={{ color:"#64748b", fontSize:13, margin:"6px 0 0" }}>{school.name}</p>
            <span style={{ background: licenceInfo?.type==="trial"?"#fef3c7":"#dcfce7", color: licenceInfo?.type==="trial"?"#92400e":"#166534", padding:"2px 10px", borderRadius:12, fontSize:11, fontWeight:600 }}>
              {licenceInfo?.type?.toUpperCase()} LICENCE
            </span>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#374151", display:"block", marginBottom:6 }}>Select Staff Member</label>
            <select value={selectedUserId} onChange={e=>setSelectedUserId(e.target.value)}
              style={{ width:"100%", padding:"10px 14px", borderRadius:8, border:"1.5px solid #d1d5db", fontSize:14, boxSizing:"border-box" }}>
              <option value="">-- Select your name --</option>
              {users.filter(u=>u.active).map(u=>(
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#374151", display:"block", marginBottom:6 }}>PIN</label>
            <input type="password" value={pinInput} onChange={e=>setPinInput(e.target.value)}
              placeholder="Enter your 4-digit PIN"
              style={{ width:"100%", padding:"10px 14px", borderRadius:8, border:"1.5px solid #d1d5db", fontSize:14, boxSizing:"border-box" }}
              onKeyDown={e=>e.key==="Enter"&&doLogin()}
            />
          </div>
          {authError && <p style={{ color:"#dc2626", fontSize:13, marginBottom:10 }}>{authError}</p>}
          <button onClick={doLogin}
            style={{ width:"100%", padding:"12px", background:"#1e3a8a", color:"#fff", border:"none", borderRadius:8, fontSize:15, fontWeight:600, cursor:"pointer" }}>
            Login
          </button>
          <p style={{ textAlign:"center", fontSize:11, color:"#9ca3af", marginTop:10 }}>
            Powered by EduSmart v4.0 | Licenced to {school.name}
          </p>
        </div>
      </div>
    );
  }

  // ---- MAIN LAYOUT ----
  const access = ROLE_ACCESS[currentUser?.role]||[];

  const navItems = [
    { key:"dashboard",   label:"Dashboard",     icon:"📊" },
    { key:"students",    label:"Students",       icon:"🎒" },
    { key:"staff",       label:"Staff",          icon:"👥" },
    { key:"grades",      label:"Grades",         icon:"📝" },
    { key:"attendance",  label:"Attendance",      icon:"✅" },
    { key:"finance",     label:"Finance",         icon:"💰" },
    { key:"library",     label:"Library",         icon:"📚" },
    { key:"timetable",   label:"Timetable",       icon:"📅" },
    { key:"reports",     label:"Reports",         icon:"📋" },
    { key:"idcards",     label:"ID Cards",        icon:"🪪" },
    { key:"archive",     label:"Archive",         icon:"🗄️" },
    { key:"audit",       label:"Audit Log",       icon:"🔍" },
    { key:"settings",    label:"Settings",        icon:"⚙️" },
  ].filter(n=>access.includes(n.key));

  return (
    <div style={{ display:"flex", minHeight:"100vh", fontFamily:"'Segoe UI',sans-serif", background:"#f1f5f9" }}>
      {/* SIDEBAR */}
      <div style={{ width:220, background:"#0f172a", display:"flex", flexDirection:"column", position:"sticky", top:0, height:"100vh", overflowY:"auto" }}>
        <div style={{ padding:"20px 16px 12px", borderBottom:"1px solid #1e293b" }}>
          <div style={{ fontSize:22, fontWeight:700, color:"#fff", marginBottom:2 }}>🏫 EduSmart</div>
          <div style={{ fontSize:11, color:"#94a3b8" }}>{school.name}</div>
          <div style={{ fontSize:11, color:"#94a3b8" }}>{school.currentTerm} · {school.currentYear}</div>
        </div>
        <div style={{ padding:"10px 0", flex:1 }}>
          {navItems.map(n=>(
            <button key={n.key} onClick={()=>setActiveSection(n.key)}
              style={{ display:"block", width:"100%", textAlign:"left", padding:"10px 18px", background:activeSection===n.key?"#1e40af":"transparent",
                color:activeSection===n.key?"#fff":"#94a3b8", border:"none", cursor:"pointer", fontSize:13.5, fontWeight:activeSection===n.key?600:400 }}>
              {n.icon} {n.label}
            </button>
          ))}
        </div>
        <div style={{ padding:14, borderTop:"1px solid #1e293b" }}>
          <div style={{ fontSize:12, color:"#94a3b8", marginBottom:4 }}>{currentUser?.name}</div>
          <div style={{ fontSize:11, color:"#475569", marginBottom:8 }}>{currentUser?.role} · {currentUser?.code}</div>
          <span style={{ background:"#1e293b", color:"#94a3b8", fontSize:10, padding:"2px 8px", borderRadius:10, marginRight:4 }}>
            {licenceInfo?.type?.toUpperCase()}
          </span>
          <button onClick={()=>{setLoggedIn(false);setCurrentUser(null);setPinInput("");setSelectedUserId("");}}
            style={{ marginTop:8, width:"100%", padding:"7px", background:"#7f1d1d", color:"#fca5a5", border:"none", borderRadius:6, cursor:"pointer", fontSize:12 }}>
            Logout
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex:1, overflow:"auto" }}>
        {notification && (
          <div style={{ position:"fixed", top:16, right:16, zIndex:9999, padding:"12px 20px", borderRadius:10,
            background:notification.type==="success"?"#16a34a":"#dc2626", color:"#fff", fontSize:13, boxShadow:"0 4px 12px rgba(0,0,0,0.3)" }}>
            {notification.msg}
          </div>
        )}
        <div style={{ padding:24 }}>
          {activeSection==="dashboard"   && <Dashboard school={school} students={students} fees={fees} expenses={expenses} attendance={attendance} grades={grades} books={books} borrows={borrows} users={users} currentUser={currentUser}/>}
          {activeSection==="students"    && <Students students={students} setStudents={setStudents} classes={CLASSES} notify={notify} addAudit={addAudit}/>}
          {activeSection==="staff"       && <Staff users={users} setUsers={setUsers} roles={ROLES} classes={CLASSES} notify={notify} addAudit={addAudit}/>}
          {activeSection==="grades"      && <Grades grades={grades} setGrades={setGrades} students={students} subjects={SUBJECTS} currentUser={currentUser} classes={CLASSES} notify={notify} addAudit={addAudit}/>}
          {activeSection==="attendance"  && <Attendance attendance={attendance} setAttendance={setAttendance} students={students} currentUser={currentUser} classes={CLASSES} notify={notify} addAudit={addAudit}/>}
          {activeSection==="finance"     && <Finance fees={fees} setFees={setFees} expenses={expenses} setExpenses={setExpenses} students={students} school={school} currentUser={currentUser} notify={notify} addAudit={addAudit}/>}
          {activeSection==="library"     && <Library books={books} setBooks={setBooks} borrows={borrows} setBorrows={setBorrows} students={students} users={users} currentUser={currentUser} notify={notify} addAudit={addAudit}/>}
          {activeSection==="timetable"   && <Timetable timetables={TIMETABLES} currentUser={currentUser} classes={CLASSES}/>}
          {activeSection==="reports"     && <Reports students={students} grades={grades} attendance={attendance} fees={fees} expenses={expenses} classes={CLASSES} subjects={SUBJECTS} school={school}/>}
          {activeSection==="idcards"     && <IDCards students={students} users={users} school={school}/>}
          {activeSection==="archive"     && <Archive students={students} setStudents={setStudents} users={users} setUsers={setUsers} notify={notify} addAudit={addAudit}/>}
          {activeSection==="audit"       && <AuditLog auditLog={auditLog} users={users}/>}
          {activeSection==="settings"    && <Settings school={school} setSchool={setSchool} users={users} setUsers={setUsers} notify={notify} addAudit={addAudit}/>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD
// ============================================================
function Dashboard({ school, students, fees, expenses, attendance, grades, books, borrows, users, currentUser }) {
  const activeStudents = students.filter(s=>s.status==="active");
  const totalFees   = fees.reduce((a,f)=>a+f.amount,0);
  const totalPaid   = fees.reduce((a,f)=>a+f.paid,0);
  const totalExp    = expenses.reduce((a,e)=>a+e.amount,0);
  const todayAtt    = attendance.filter(a=>a.date===today());
  const presentToday = todayAtt.filter(a=>a.status==="Present").length;
  const overdueBooks = borrows.filter(b=>!b.returnDate && b.dueDate < today()).length;
  const activeTeachers = users.filter(u=>u.role==="Teacher"&&u.active).length;
  const stats = [
    { label:"Total Students", value:activeStudents.length, icon:"🎒", color:"#3b82f6" },
    { label:"Staff Members",  value:users.filter(u=>u.active).length, icon:"👥", color:"#8b5cf6" },
    { label:"Total Fees Due", value:formatGHS(totalFees), icon:"💰", color:"#10b981" },
    { label:"Fees Collected", value:formatGHS(totalPaid), icon:"✅", color:"#059669" },
    { label:"Total Expenses", value:formatGHS(totalExp), icon:"📤", color:"#f59e0b" },
    { label:"Net Balance",    value:formatGHS(totalPaid-totalExp), icon:"🏦", color: (totalPaid-totalExp)>=0?"#16a34a":"#dc2626" },
    { label:"Present Today",  value:`${presentToday} / ${activeStudents.length}`, icon:"✅", color:"#0ea5e9" },
    { label:"Overdue Books",  value:overdueBooks, icon:"📚", color:"#ef4444" },
  ];
  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <h2 style={{ fontSize:22, fontWeight:700, color:"#0f172a", margin:0 }}>Welcome, {currentUser?.name}</h2>
        <p style={{ color:"#64748b", margin:"4px 0 0", fontSize:13 }}>{school.name} · {school.currentTerm} {school.currentYear}</p>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14, marginBottom:24 }}>
        {stats.map((s,i)=>(
          <div key={i} style={{ background:"#fff", borderRadius:12, padding:18, boxShadow:"0 1px 4px rgba(0,0,0,0.08)", borderLeft:`4px solid ${s.color}` }}>
            <div style={{ fontSize:22, marginBottom:6 }}>{s.icon}</div>
            <div style={{ fontSize:20, fontWeight:700, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:12, color:"#64748b" }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <div style={{ background:"#fff", borderRadius:12, padding:18, boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin:"0 0 12px", fontSize:15, color:"#0f172a" }}>Fee Arrears — Top Students</h3>
          {students.filter(s=>s.status==="active"&&s.fees-s.paid>0).slice(0,5).map(s=>(
            <div key={s.id} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #f1f5f9", fontSize:13 }}>
              <span>{s.name} ({s.class})</span>
              <span style={{ color:"#dc2626", fontWeight:600 }}>{formatGHS(s.fees-s.paid)}</span>
            </div>
          ))}
          {students.filter(s=>s.status==="active"&&s.fees-s.paid>0).length===0 && <p style={{ color:"#10b981", fontSize:13 }}>All fees cleared! ✅</p>}
        </div>
        <div style={{ background:"#fff", borderRadius:12, padding:18, boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ margin:"0 0 12px", fontSize:15, color:"#0f172a" }}>Recent Grade Entries</h3>
          {grades.slice(-5).reverse().map(g=>{
            const stu = students.find(s=>s.id===g.studentId);
            return (
              <div key={g.id} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #f1f5f9", fontSize:13 }}>
                <span>{stu?.name||g.studentId} — {g.subject}</span>
                <span style={{ fontWeight:600, color:g.grade==="A"?"#16a34a":g.grade==="F"?"#dc2626":"#f59e0b" }}>{g.grade} ({g.score})</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// STUDENTS
// ============================================================
function Students({ students, setStudents, classes, notify, addAudit }) {
  const [search, setSearch]   = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]   = useState(null);
  const [form, setForm]       = useState({ name:"", class:"", dob:"", gender:"Male", guardian:"", phone:"", fees:500, paid:0, status:"active" });

  const filtered = students.filter(s=>s.status==="active" && (s.name.toLowerCase().includes(search.toLowerCase())||s.id.includes(search)) && (!filterClass||s.class===filterClass));

  const save = () => {
    if (!form.name||!form.class) { notify("Name and Class are required","error"); return; }
    if (editId) {
      setStudents(prev=>prev.map(s=>s.id===editId?{...s,...form}:s));
      addAudit(`Edited student: ${form.name}`,"Students"); notify("Student updated");
    } else {
      const newS = { ...form, id: uid("STU") };
      setStudents(prev=>[...prev, newS]);
      addAudit(`Added student: ${form.name}`,"Students"); notify("Student added");
    }
    setShowForm(false); setEditId(null); setForm({ name:"", class:"", dob:"", gender:"Male", guardian:"", phone:"", fees:500, paid:0, status:"active" });
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:"#0f172a" }}>🎒 Students</h2>
        <button onClick={()=>{setShowForm(true);setEditId(null);setForm({ name:"", class:"", dob:"", gender:"Male", guardian:"", phone:"", fees:500, paid:0, status:"active" });}}
          style={{ padding:"8px 18px", background:"#1e40af", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:600 }}>
          + Add Student
        </button>
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or ID..."
          style={{ flex:1, padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}/>
        <select value={filterClass} onChange={e=>setFilterClass(e.target.value)}
          style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
          <option value="">All Classes</option>
          {classes.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {showForm && (
        <FormModal title={editId?"Edit Student":"Add Student"} onClose={()=>{setShowForm(false);setEditId(null);}}>
          <FormRow label="Full Name"><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Class">
            <select value={form.class} onChange={e=>setForm(p=>({...p,class:e.target.value}))} style={inp}>
              <option value="">Select</option>
              {classes.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </FormRow>
          <FormRow label="Date of Birth"><input type="date" value={form.dob} onChange={e=>setForm(p=>({...p,dob:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Gender">
            <select value={form.gender} onChange={e=>setForm(p=>({...p,gender:e.target.value}))} style={inp}>
              <option>Male</option><option>Female</option>
            </select>
          </FormRow>
          <FormRow label="Guardian Name"><input value={form.guardian} onChange={e=>setForm(p=>({...p,guardian:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Guardian Phone"><input value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Fees (GH₵)"><input type="number" value={form.fees} onChange={e=>setForm(p=>({...p,fees:+e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Amount Paid (GH₵)"><input type="number" value={form.paid} onChange={e=>setForm(p=>({...p,paid:+e.target.value}))} style={inp}/></FormRow>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:16 }}>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={btnSecondary}>Cancel</button>
            <button onClick={save} style={btnPrimary}>Save</button>
          </div>
        </FormModal>
      )}
      <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr style={{ background:"#f8fafc" }}>
            {["ID","Name","Class","Gender","Guardian","Phone","Fees","Paid","Balance","Actions"].map(h=>(
              <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.map(s=>(
              <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <td style={{ padding:"8px 12px", color:"#6b7280" }}>{s.id}</td>
                <td style={{ padding:"8px 12px", fontWeight:600, color:"#0f172a" }}>{s.name}</td>
                <td style={{ padding:"8px 12px" }}>{s.class}</td>
                <td style={{ padding:"8px 12px" }}>{s.gender}</td>
                <td style={{ padding:"8px 12px" }}>{s.guardian}</td>
                <td style={{ padding:"8px 12px" }}>{s.phone}</td>
                <td style={{ padding:"8px 12px" }}>{formatGHS(s.fees)}</td>
                <td style={{ padding:"8px 12px", color:"#16a34a" }}>{formatGHS(s.paid)}</td>
                <td style={{ padding:"8px 12px", color:s.fees-s.paid>0?"#dc2626":"#16a34a", fontWeight:600 }}>{formatGHS(s.fees-s.paid)}</td>
                <td style={{ padding:"8px 12px" }}>
                  <button onClick={()=>{setEditId(s.id);setForm({name:s.name,class:s.class,dob:s.dob,gender:s.gender,guardian:s.guardian,phone:s.phone,fees:s.fees,paid:s.paid,status:s.status});setShowForm(true);}}
                    style={{ ...btnSmall, background:"#dbeafe", color:"#1d4ed8", marginRight:4 }}>Edit</button>
                  <button onClick={()=>{
                    if(confirm(`Mark ${s.name} as dropout?`)){
                      setStudents(prev=>prev.map(x=>x.id===s.id?{...x,status:"dropout"}:x));
                      addAudit(`Marked dropout: ${s.name}`,"Students"); notify("Moved to archive");
                    }
                  }} style={{ ...btnSmall, background:"#fee2e2", color:"#991b1b" }}>Dropout</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length===0 && <p style={{ textAlign:"center", color:"#9ca3af", padding:20 }}>No students found.</p>}
      </div>
      <p style={{ fontSize:12, color:"#94a3b8", marginTop:8 }}>Showing {filtered.length} active students</p>
    </div>
  );
}

// ============================================================
// STAFF
// ============================================================
function Staff({ users, setUsers, roles, classes, notify, addAudit }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState(null);
  const [form, setForm]         = useState({ name:"", role:"Teacher", pin:"", code:"", email:"", classAssigned:"", active:true });
  const [filterRole, setFilterRole] = useState("");

  const filtered = users.filter(u=>!filterRole||u.role===filterRole);

  const save = () => {
    if (!form.name||!form.pin||!form.code) { notify("Name, PIN and Code required","error"); return; }
    if (editId) {
      setUsers(prev=>prev.map(u=>u.id===editId?{...u,...form}:u));
      addAudit(`Edited staff: ${form.name}`,"Staff"); notify("Staff updated");
    } else {
      setUsers(prev=>[...prev,{...form,id:uid("USR")}]);
      addAudit(`Added staff: ${form.name}`,"Staff"); notify("Staff added");
    }
    setShowForm(false); setEditId(null);
    setForm({ name:"", role:"Teacher", pin:"", code:"", email:"", classAssigned:"", active:true });
  };

  const roleColors = { Admin:"#7c3aed", Headmaster:"#1d4ed8", HOD:"#0369a1", Teacher:"#059669", "Account Office":"#d97706", Librarian:"#6d28d9", "Non-Teaching Staff":"#6b7280" };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:"#0f172a" }}>👥 Staff Management</h2>
        <button onClick={()=>{setShowForm(true);setEditId(null);setForm({ name:"", role:"Teacher", pin:"", code:"", email:"", classAssigned:"", active:true });}}
          style={btnPrimary}>+ Add Staff</button>
      </div>
      <div style={{ marginBottom:14 }}>
        <select value={filterRole} onChange={e=>setFilterRole(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
          <option value="">All Roles</option>
          {roles.map(r=><option key={r}>{r}</option>)}
        </select>
      </div>
      {showForm && (
        <FormModal title={editId?"Edit Staff":"Add Staff"} onClose={()=>{setShowForm(false);setEditId(null);}}>
          <FormRow label="Full Name"><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Role">
            <select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} style={inp}>
              {roles.map(r=><option key={r}>{r}</option>)}
            </select>
          </FormRow>
          <FormRow label="Staff Code"><input value={form.code} onChange={e=>setForm(p=>({...p,code:e.target.value.toUpperCase()}))} placeholder="e.g. TCH003" style={inp}/></FormRow>
          <FormRow label="PIN (4 digits)"><input type="password" value={form.pin} onChange={e=>setForm(p=>({...p,pin:e.target.value}))} maxLength={4} style={inp}/></FormRow>
          <FormRow label="Email"><input value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} style={inp}/></FormRow>
          {form.role==="Teacher"&&(
            <FormRow label="Class Assigned">
              <select value={form.classAssigned||""} onChange={e=>setForm(p=>({...p,classAssigned:e.target.value}))} style={inp}>
                <option value="">None</option>
                {classes.map(c=><option key={c}>{c}</option>)}
              </select>
            </FormRow>
          )}
          <FormRow label="Active">
            <select value={form.active?"yes":"no"} onChange={e=>setForm(p=>({...p,active:e.target.value==="yes"}))} style={inp}>
              <option value="yes">Yes</option><option value="no">No</option>
            </select>
          </FormRow>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:16 }}>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={btnSecondary}>Cancel</button>
            <button onClick={save} style={btnPrimary}>Save</button>
          </div>
        </FormModal>
      )}
      <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr style={{ background:"#f8fafc" }}>
            {["ID","Code","Name","Role","Class","Email","Status","Actions"].map(h=>(
              <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.map(u=>(
              <tr key={u.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                <td style={{ padding:"8px 12px", color:"#6b7280" }}>{u.id}</td>
                <td style={{ padding:"8px 12px", fontWeight:700, color:"#1e40af" }}>{u.code}</td>
                <td style={{ padding:"8px 12px", fontWeight:600 }}>{u.name}</td>
                <td style={{ padding:"8px 12px" }}>
                  <span style={{ background: (roleColors[u.role]||"#6b7280")+"22", color:roleColors[u.role]||"#6b7280", padding:"2px 8px", borderRadius:10, fontSize:11, fontWeight:600 }}>{u.role}</span>
                </td>
                <td style={{ padding:"8px 12px", color:"#6b7280" }}>{u.classAssigned||"—"}</td>
                <td style={{ padding:"8px 12px", color:"#6b7280" }}>{u.email}</td>
                <td style={{ padding:"8px 12px" }}>
                  <span style={{ background:u.active?"#dcfce7":"#fee2e2", color:u.active?"#166534":"#991b1b", padding:"2px 8px", borderRadius:10, fontSize:11 }}>{u.active?"Active":"Inactive"}</span>
                </td>
                <td style={{ padding:"8px 12px" }}>
                  <button onClick={()=>{setEditId(u.id);setForm({name:u.name,role:u.role,pin:u.pin,code:u.code,email:u.email,classAssigned:u.classAssigned||"",active:u.active});setShowForm(true);}}
                    style={{ ...btnSmall, background:"#dbeafe", color:"#1d4ed8" }}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// GRADES
// ============================================================
function Grades({ grades, setGrades, students, subjects, currentUser, classes, notify, addAudit }) {
  const isTeacher = currentUser?.role==="Teacher";
  const myClass   = isTeacher ? currentUser?.classAssigned : null;
  const [form, setForm]   = useState({ studentId:"", subject:"", score:"", term:"Term 2", year:"2024/2025" });
  const [filterClass, setFilterClass] = useState(myClass||"");
  const [filterSubject, setFilterSubject] = useState("");
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const availStudents = students.filter(s=>s.status==="active"&&(!filterClass||s.class===filterClass));
  const filtered = grades.filter(g=>{
    const stu = students.find(s=>s.id===g.studentId);
    return (!filterClass||stu?.class===filterClass) && (!filterSubject||g.subject===filterSubject) && (!isTeacher||stu?.class===myClass);
  });

  const save = () => {
    const score = +form.score;
    if (!form.studentId||!form.subject||isNaN(score)||score<0||score>100) { notify("Please fill all fields correctly","error"); return; }
    const grade = calcGrade(score);
    if (editId) {
      setGrades(prev=>prev.map(g=>g.id===editId?{...g,...form,score,grade,enteredBy:currentUser.code,date:today()}:g));
      addAudit(`Updated grade for student ${form.studentId}`,"Grades"); notify("Grade updated");
    } else {
      setGrades(prev=>[...prev,{id:uid("GRD"),...form,score,grade,enteredBy:currentUser.code,date:today()}]);
      addAudit(`Entered grade: ${form.subject} for ${form.studentId}`,"Grades"); notify("Grade saved");
    }
    setShowForm(false); setEditId(null); setForm({ studentId:"", subject:"", score:"", term:"Term 2", year:"2024/2025" });
  };

  const gradeColor = g => g==="A"?"#16a34a":g==="B"?"#0369a1":g==="C"?"#d97706":g==="D"?"#ea580c":g==="E"?"#dc2626":"#7f1d1d";

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:"#0f172a" }}>📝 Grades & Assessment</h2>
        <button onClick={()=>{setShowForm(true);setEditId(null);setForm({ studentId:"", subject:subjects[0], score:"", term:"Term 2", year:"2024/2025" });}} style={btnPrimary}>+ Enter Grade</button>
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
        {!isTeacher&&<select value={filterClass} onChange={e=>setFilterClass(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
          <option value="">All Classes</option>
          {classes.map(c=><option key={c}>{c}</option>)}
        </select>}
        {isTeacher&&<div style={{ padding:"8px 12px", background:"#dbeafe", borderRadius:8, fontSize:13, color:"#1d4ed8", fontWeight:600 }}>Class: {myClass}</div>}
        <select value={filterSubject} onChange={e=>setFilterSubject(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
          <option value="">All Subjects</option>
          {subjects.map(s=><option key={s}>{s}</option>)}
        </select>
      </div>
      {showForm && (
        <FormModal title={editId?"Edit Grade":"Enter Grade"} onClose={()=>{setShowForm(false);setEditId(null);}}>
          <FormRow label="Student">
            <select value={form.studentId} onChange={e=>setForm(p=>({...p,studentId:e.target.value}))} style={inp}>
              <option value="">Select student</option>
              {availStudents.map(s=><option key={s.id} value={s.id}>{s.name} — {s.class}</option>)}
            </select>
          </FormRow>
          <FormRow label="Subject">
            <select value={form.subject} onChange={e=>setForm(p=>({...p,subject:e.target.value}))} style={inp}>
              {subjects.map(s=><option key={s}>{s}</option>)}
            </select>
          </FormRow>
          <FormRow label="Score (0-100)"><input type="number" min={0} max={100} value={form.score} onChange={e=>setForm(p=>({...p,score:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Term">
            <select value={form.term} onChange={e=>setForm(p=>({...p,term:e.target.value}))} style={inp}>
              <option>Term 1</option><option>Term 2</option><option>Term 3</option>
            </select>
          </FormRow>
          <FormRow label="Academic Year"><input value={form.year} onChange={e=>setForm(p=>({...p,year:e.target.value}))} style={inp}/></FormRow>
          {form.score!=""&&<div style={{ background:"#f0fdf4", borderRadius:8, padding:10, marginTop:8, textAlign:"center" }}>
            <span style={{ fontSize:24, fontWeight:700, color:gradeColor(calcGrade(+form.score)) }}>{calcGrade(+form.score)}</span>
            <span style={{ color:"#6b7280", fontSize:13, marginLeft:8 }}>({form.score}/100)</span>
          </div>}
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:16 }}>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={btnSecondary}>Cancel</button>
            <button onClick={save} style={btnPrimary}>Save Grade</button>
          </div>
        </FormModal>
      )}
      <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr style={{ background:"#f8fafc" }}>
            {["Student","Class","Subject","Score","Grade","Term","Year","Entered By","Date","Actions"].map(h=>(
              <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.map(g=>{
              const stu = students.find(s=>s.id===g.studentId);
              return (
                <tr key={g.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"8px 12px", fontWeight:600 }}>{stu?.name||g.studentId}</td>
                  <td style={{ padding:"8px 12px" }}>{stu?.class}</td>
                  <td style={{ padding:"8px 12px" }}>{g.subject}</td>
                  <td style={{ padding:"8px 12px" }}>{g.score}</td>
                  <td style={{ padding:"8px 12px" }}>
                    <span style={{ background:gradeColor(g.grade)+"22", color:gradeColor(g.grade), padding:"2px 10px", borderRadius:10, fontWeight:700, fontSize:13 }}>{g.grade}</span>
                  </td>
                  <td style={{ padding:"8px 12px" }}>{g.term}</td>
                  <td style={{ padding:"8px 12px" }}>{g.year}</td>
                  <td style={{ padding:"8px 12px", color:"#6b7280", fontSize:11 }}>{g.enteredBy}</td>
                  <td style={{ padding:"8px 12px", color:"#6b7280", fontSize:11 }}>{g.date}</td>
                  <td style={{ padding:"8px 12px" }}>
                    <button onClick={()=>{setEditId(g.id);setForm({studentId:g.studentId,subject:g.subject,score:g.score,term:g.term,year:g.year});setShowForm(true);}}
                      style={{ ...btnSmall, background:"#dbeafe", color:"#1d4ed8" }}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length===0&&<p style={{ textAlign:"center", color:"#9ca3af", padding:20 }}>No grades found.</p>}
      </div>
    </div>
  );
}

// ============================================================
// ATTENDANCE
// ============================================================
function Attendance({ attendance, setAttendance, students, currentUser, classes, notify, addAudit }) {
  const isTeacher = currentUser?.role==="Teacher";
  const myClass   = isTeacher ? currentUser?.classAssigned : null;
  const [date, setDate]           = useState(today());
  const [selClass, setSelClass]   = useState(myClass||classes[0]);
  const [view, setView]           = useState("mark"); // mark | history

  const classStudents = students.filter(s=>s.status==="active"&&s.class===selClass);
  const attForDate    = attendance.filter(a=>a.date===date&&a.class===selClass);
  const getStatus     = (sid) => attForDate.find(a=>a.studentId===sid)?.status||"Not Marked";

  const markAll = (status) => {
    classStudents.forEach(s=>markStudent(s.id,status));
    notify(`All marked as ${status}`);
  };

  const markStudent = (sid, status) => {
    const existing = attendance.find(a=>a.date===date&&a.class===selClass&&a.studentId===sid);
    if (existing) {
      setAttendance(prev=>prev.map(a=>a.id===existing.id?{...a,status,enteredBy:currentUser.code}:a));
    } else {
      setAttendance(prev=>[...prev,{id:uid("ATT"),studentId:sid,class:selClass,date,status,enteredBy:currentUser.code}]);
    }
  };

  const saveAll = () => {
    addAudit(`Attendance saved for ${selClass} on ${date}`,"Attendance");
    notify("Attendance saved ✅");
  };

  const history = attendance.filter(a=>a.class===selClass&&(!isTeacher||a.class===myClass)).sort((a,b)=>b.date.localeCompare(a.date));

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:"#0f172a" }}>✅ Attendance</h2>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>setView("mark")} style={{ ...btnSmall, background:view==="mark"?"#1e40af":"#e5e7eb", color:view==="mark"?"#fff":"#374151", padding:"8px 14px" }}>Mark</button>
          <button onClick={()=>setView("history")} style={{ ...btnSmall, background:view==="history"?"#1e40af":"#e5e7eb", color:view==="history"?"#fff":"#374151", padding:"8px 14px" }}>History</button>
        </div>
      </div>
      {view==="mark"&&(
        <>
          <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}/>
            {!isTeacher&&<select value={selClass} onChange={e=>setSelClass(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
              {classes.map(c=><option key={c}>{c}</option>)}
            </select>}
            {isTeacher&&<div style={{ padding:"8px 14px", background:"#dbeafe", borderRadius:8, fontSize:13, color:"#1d4ed8", fontWeight:600 }}>📌 {selClass}</div>}
            <button onClick={()=>markAll("Present")} style={{ ...btnSmall, background:"#dcfce7", color:"#166534", padding:"8px 14px" }}>✅ Mark All Present</button>
            <button onClick={()=>markAll("Absent")} style={{ ...btnSmall, background:"#fee2e2", color:"#991b1b", padding:"8px 14px" }}>❌ Mark All Absent</button>
            <button onClick={saveAll} style={{ ...btnPrimary, padding:"8px 14px" }}>💾 Save</button>
          </div>
          <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ background:"#f8fafc" }}>
                {["Student","ID","Status"].map(h=>(
                  <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {classStudents.map(s=>{
                  const st = getStatus(s.id);
                  return (
                    <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9", background:st==="Present"?"#f0fdf4":st==="Absent"?"#fff7f7":"#fff" }}>
                      <td style={{ padding:"8px 12px", fontWeight:600 }}>{s.name}</td>
                      <td style={{ padding:"8px 12px", color:"#6b7280" }}>{s.id}</td>
                      <td style={{ padding:"8px 12px" }}>
                        <div style={{ display:"flex", gap:6 }}>
                          {["Present","Absent","Late","Excused"].map(opt=>(
                            <button key={opt} onClick={()=>markStudent(s.id,opt)}
                              style={{ padding:"4px 10px", borderRadius:6, border:"none", cursor:"pointer", fontSize:11, fontWeight:600,
                                background:st===opt?(opt==="Present"?"#16a34a":opt==="Absent"?"#dc2626":opt==="Late"?"#d97706":"#6b7280"):(opt==="Present"?"#dcfce7":opt==="Absent"?"#fee2e2":opt==="Late"?"#fef3c7":"#f3f4f6"),
                                color:st===opt?"#fff":(opt==="Present"?"#166534":opt==="Absent"?"#991b1b":opt==="Late"?"#92400e":"#374151")
                              }}>{opt}</button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {view==="history"&&(
        <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ background:"#f8fafc" }}>
              {["Date","Student","Class","Status","Entered By"].map(h=>(
                <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {history.slice(0,50).map(a=>{
                const stu=students.find(s=>s.id===a.studentId);
                return (
                  <tr key={a.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                    <td style={{ padding:"8px 12px" }}>{a.date}</td>
                    <td style={{ padding:"8px 12px", fontWeight:600 }}>{stu?.name||a.studentId}</td>
                    <td style={{ padding:"8px 12px" }}>{a.class}</td>
                    <td style={{ padding:"8px 12px" }}>
                      <span style={{ background:a.status==="Present"?"#dcfce7":a.status==="Absent"?"#fee2e2":"#fef3c7", color:a.status==="Present"?"#166534":a.status==="Absent"?"#991b1b":"#92400e", padding:"2px 8px", borderRadius:10, fontSize:11, fontWeight:600 }}>{a.status}</span>
                    </td>
                    <td style={{ padding:"8px 12px", color:"#6b7280", fontSize:11 }}>{a.enteredBy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// FINANCE
// ============================================================
function Finance({ fees, setFees, expenses, setExpenses, students, school, currentUser, notify, addAudit }) {
  const [tab, setTab] = useState("fees");
  const [showReceipt, setShowReceipt] = useState(null);
  const [feeForm, setFeeForm] = useState({ studentId:"", amount:"", paid:"", term:"Term 2", year:"2024/2025" });
  const [expForm, setExpForm] = useState({ description:"", amount:"", category:"Supplies", date:today() });
  const [showFeeForm, setShowFeeForm]  = useState(false);
  const [showExpForm, setShowExpForm]  = useState(false);
  const [reportPeriod, setReportPeriod] = useState("monthly");

  const savePayment = () => {
    if(!feeForm.studentId||!feeForm.paid) { notify("Student and amount paid required","error"); return; }
    const stu = students.find(s=>s.id===feeForm.studentId);
    const rec = {
      id:uid("FEE"), studentId:feeForm.studentId, amount:+feeForm.amount||+feeForm.paid,
      paid:+feeForm.paid, balance:(+feeForm.amount||+feeForm.paid)-(+feeForm.paid),
      term:feeForm.term, year:feeForm.year,
      receiptNo:`RCP${Date.now().toString().slice(-5)}`,
      date:today(), enteredBy:currentUser.code
    };
    setFees(prev=>[...prev,rec]);
    addAudit(`Fee payment: ${stu?.name} — ${formatGHS(+feeForm.paid)}`,"Finance");
    setShowReceipt({...rec, studentName:stu?.name, studentClass:stu?.class});
    setShowFeeForm(false); setFeeForm({ studentId:"", amount:"", paid:"", term:"Term 2", year:"2024/2025" });
    notify("Payment recorded ✅");
  };

  const saveExpense = () => {
    if(!expForm.description||!expForm.amount) { notify("Description and amount required","error"); return; }
    setExpenses(prev=>[...prev,{id:uid("EXP"),...expForm,amount:+expForm.amount,enteredBy:currentUser.code}]);
    addAudit(`Expense: ${expForm.description} — ${formatGHS(+expForm.amount)}`,"Finance");
    setShowExpForm(false); setExpForm({ description:"", amount:"", category:"Supplies", date:today() });
    notify("Expense recorded");
  };

  const totalFees    = fees.reduce((a,f)=>a+f.paid,0);
  const totalExp     = expenses.reduce((a,e)=>a+e.amount,0);
  const netBalance   = totalFees - totalExp;

  // Financial report by period
  const getReport = () => {
    const now2 = new Date();
    const filt = (arr, dateField) => arr.filter(item=>{
      const d = new Date(item[dateField]);
      if(reportPeriod==="weekly")    return (now2-d)/(1000*60*60*24)<=7;
      if(reportPeriod==="monthly")   return d.getMonth()===now2.getMonth()&&d.getFullYear()===now2.getFullYear();
      if(reportPeriod==="quarterly") return Math.floor(d.getMonth()/3)===Math.floor(now2.getMonth()/3)&&d.getFullYear()===now2.getFullYear();
      if(reportPeriod==="yearly")    return d.getFullYear()===now2.getFullYear();
      if(reportPeriod==="term1")     return item.term==="Term 1";
      if(reportPeriod==="term2")     return item.term==="Term 2";
      if(reportPeriod==="term3")     return item.term==="Term 3";
      return true;
    });
    const rFees = filt(fees,"date"); const rExp = filt(expenses,"date");
    return { fees:rFees.reduce((a,f)=>a+f.paid,0), expenses:rExp.reduce((a,e)=>a+e.amount,0), feeCount:rFees.length, expCount:rExp.length };
  };

  const rep = getReport();

  return (
    <div>
      <h2 style={{ margin:"0 0 16px", fontSize:20, fontWeight:700, color:"#0f172a" }}>💰 Finance</h2>
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        {["fees","expenses","report"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13,
            background:tab===t?"#1e40af":"#e5e7eb", color:tab===t?"#fff":"#374151" }}>
            {t==="fees"?"📥 Fees":t==="expenses"?"📤 Expenses":"📊 Financial Report"}
          </button>
        ))}
      </div>

      {/* RECEIPT MODAL */}
      {showReceipt&&(
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"#fff", borderRadius:12, padding:32, maxWidth:420, width:"90%", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ textAlign:"center", marginBottom:16 }}>
              <div style={{ fontSize:28 }}>🧾</div>
              <h3 style={{ margin:0, fontSize:18, fontWeight:700, color:"#0f172a" }}>{school.name}</h3>
              <p style={{ margin:"4px 0", fontSize:12, color:"#64748b" }}>{school.address}</p>
              <p style={{ margin:"2px 0", fontSize:12, color:"#64748b" }}>{school.phone} | {school.email}</p>
              <div style={{ borderTop:"2px dashed #e5e7eb", marginTop:10, paddingTop:10 }}>
                <div style={{ fontSize:15, fontWeight:700, color:"#1e40af" }}>PAYMENT RECEIPT</div>
                <div style={{ fontSize:13, color:"#6b7280" }}>Receipt No: {showReceipt.receiptNo}</div>
              </div>
            </div>
            <div style={{ fontSize:13, lineHeight:2 }}>
              <div><strong>Student:</strong> {showReceipt.studentName}</div>
              <div><strong>Class:</strong> {showReceipt.studentClass}</div>
              <div><strong>Term:</strong> {showReceipt.term} — {showReceipt.year}</div>
              <div><strong>Date:</strong> {showReceipt.date}</div>
              <div style={{ borderTop:"1px solid #e5e7eb", marginTop:8, paddingTop:8 }}>
                <div><strong>Amount Due:</strong> {formatGHS(showReceipt.amount)}</div>
                <div style={{ color:"#16a34a", fontWeight:700 }}><strong>Amount Paid:</strong> {formatGHS(showReceipt.paid)}</div>
                <div style={{ color:showReceipt.balance>0?"#dc2626":"#16a34a", fontWeight:600 }}><strong>Balance:</strong> {formatGHS(showReceipt.balance)}</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:16 }}>
              <button onClick={()=>window.print()} style={{ ...btnPrimary, flex:1 }}>🖨️ Print</button>
              <button onClick={()=>setShowReceipt(null)} style={{ ...btnSecondary, flex:1 }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {tab==="fees"&&(
        <>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={{ display:"flex", gap:10 }}>
              <div style={{ background:"#dcfce7", borderRadius:10, padding:"10px 18px" }}>
                <div style={{ fontSize:11, color:"#166534" }}>Total Collected</div>
                <div style={{ fontSize:18, fontWeight:700, color:"#16a34a" }}>{formatGHS(totalFees)}</div>
              </div>
              <div style={{ background:"#fee2e2", borderRadius:10, padding:"10px 18px" }}>
                <div style={{ fontSize:11, color:"#991b1b" }}>Total Outstanding</div>
                <div style={{ fontSize:18, fontWeight:700, color:"#dc2626" }}>{formatGHS(students.filter(s=>s.status==="active").reduce((a,s)=>a+(s.fees-s.paid),0))}</div>
              </div>
            </div>
            <button onClick={()=>setShowFeeForm(true)} style={btnPrimary}>+ Record Payment</button>
          </div>
          {showFeeForm&&(
            <FormModal title="Record Fee Payment" onClose={()=>setShowFeeForm(false)}>
              <FormRow label="Student">
                <select value={feeForm.studentId} onChange={e=>setFeeForm(p=>({...p,studentId:e.target.value}))} style={inp}>
                  <option value="">Select student</option>
                  {students.filter(s=>s.status==="active").map(s=><option key={s.id} value={s.id}>{s.name} — {s.class} (Balance: {formatGHS(s.fees-s.paid)})</option>)}
                </select>
              </FormRow>
              <FormRow label="Total Fees (GH₵)"><input type="number" value={feeForm.amount} onChange={e=>setFeeForm(p=>({...p,amount:e.target.value}))} style={inp}/></FormRow>
              <FormRow label="Amount Paid (GH₵)"><input type="number" value={feeForm.paid} onChange={e=>setFeeForm(p=>({...p,paid:e.target.value}))} style={inp}/></FormRow>
              <FormRow label="Term">
                <select value={feeForm.term} onChange={e=>setFeeForm(p=>({...p,term:e.target.value}))} style={inp}>
                  <option>Term 1</option><option>Term 2</option><option>Term 3</option>
                </select>
              </FormRow>
              <FormRow label="Year"><input value={feeForm.year} onChange={e=>setFeeForm(p=>({...p,year:e.target.value}))} style={inp}/></FormRow>
              <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:16 }}>
                <button onClick={()=>setShowFeeForm(false)} style={btnSecondary}>Cancel</button>
                <button onClick={savePayment} style={btnPrimary}>Record & Print Receipt</button>
              </div>
            </FormModal>
          )}
          <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ background:"#f8fafc" }}>
                {["Receipt","Student","Amount","Paid","Balance","Term","Date","Recorded By"].map(h=>(
                  <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...fees].reverse().map(f=>{
                  const stu=students.find(s=>s.id===f.studentId);
                  return (
                    <tr key={f.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                      <td style={{ padding:"8px 12px", color:"#6b7280", fontSize:11 }}>{f.receiptNo}</td>
                      <td style={{ padding:"8px 12px", fontWeight:600 }}>{stu?.name||f.studentId}</td>
                      <td style={{ padding:"8px 12px" }}>{formatGHS(f.amount)}</td>
                      <td style={{ padding:"8px 12px", color:"#16a34a", fontWeight:600 }}>{formatGHS(f.paid)}</td>
                      <td style={{ padding:"8px 12px", color:f.balance>0?"#dc2626":"#16a34a", fontWeight:600 }}>{formatGHS(f.balance)}</td>
                      <td style={{ padding:"8px 12px" }}>{f.term}</td>
                      <td style={{ padding:"8px 12px" }}>{f.date}</td>
                      <td style={{ padding:"8px 12px", color:"#6b7280", fontSize:11 }}>{f.enteredBy}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab==="expenses"&&(
        <>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={{ background:"#fef3c7", borderRadius:10, padding:"10px 18px" }}>
              <div style={{ fontSize:11, color:"#92400e" }}>Total Expenses</div>
              <div style={{ fontSize:18, fontWeight:700, color:"#d97706" }}>{formatGHS(totalExp)}</div>
            </div>
            <button onClick={()=>setShowExpForm(true)} style={btnPrimary}>+ Add Expense</button>
          </div>
          {showExpForm&&(
            <FormModal title="Record Expense" onClose={()=>setShowExpForm(false)}>
              <FormRow label="Description"><input value={expForm.description} onChange={e=>setExpForm(p=>({...p,description:e.target.value}))} style={inp}/></FormRow>
              <FormRow label="Amount (GH₵)"><input type="number" value={expForm.amount} onChange={e=>setExpForm(p=>({...p,amount:e.target.value}))} style={inp}/></FormRow>
              <FormRow label="Category">
                <select value={expForm.category} onChange={e=>setExpForm(p=>({...p,category:e.target.value}))} style={inp}>
                  {["Supplies","Utilities","Maintenance","Staff","Infrastructure","Events","Other"].map(c=><option key={c}>{c}</option>)}
                </select>
              </FormRow>
              <FormRow label="Date"><input type="date" value={expForm.date} onChange={e=>setExpForm(p=>({...p,date:e.target.value}))} style={inp}/></FormRow>
              <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:16 }}>
                <button onClick={()=>setShowExpForm(false)} style={btnSecondary}>Cancel</button>
                <button onClick={saveExpense} style={btnPrimary}>Save Expense</button>
              </div>
            </FormModal>
          )}
          <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ background:"#f8fafc" }}>
                {["Description","Amount","Category","Date","Entered By"].map(h=>(
                  <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...expenses].reverse().map(e=>(
                  <tr key={e.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                    <td style={{ padding:"8px 12px", fontWeight:600 }}>{e.description}</td>
                    <td style={{ padding:"8px 12px", color:"#d97706", fontWeight:600 }}>{formatGHS(e.amount)}</td>
                    <td style={{ padding:"8px 12px" }}><span style={{ background:"#f1f5f9", padding:"2px 8px", borderRadius:8, fontSize:11 }}>{e.category}</span></td>
                    <td style={{ padding:"8px 12px" }}>{e.date}</td>
                    <td style={{ padding:"8px 12px", color:"#6b7280", fontSize:11 }}>{e.enteredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab==="report"&&(
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
            {[["weekly","Weekly"],["monthly","Monthly"],["quarterly","Quarterly"],["yearly","Yearly"],["term1","Term 1"],["term2","Term 2"],["term3","Term 3"]].map(([k,l])=>(
              <button key={k} onClick={()=>setReportPeriod(k)}
                style={{ padding:"7px 16px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, fontWeight:600,
                  background:reportPeriod===k?"#1e40af":"#e5e7eb", color:reportPeriod===k?"#fff":"#374151" }}>{l}</button>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14, marginBottom:20 }}>
            {[
              { label:"Total Income", value:formatGHS(rep.fees), color:"#16a34a", icon:"📥", sub:`${rep.feeCount} payments` },
              { label:"Total Expenses", value:formatGHS(rep.expenses), color:"#dc2626", icon:"📤", sub:`${rep.expCount} items` },
              { label:"Net Balance", value:formatGHS(rep.fees-rep.expenses), color:(rep.fees-rep.expenses)>=0?"#0369a1":"#dc2626", icon:"🏦", sub:"Income - Expenses" },
            ].map((s,i)=>(
              <div key={i} style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.08)", borderLeft:`4px solid ${s.color}` }}>
                <div style={{ fontSize:22, marginBottom:6 }}>{s.icon}</div>
                <div style={{ fontSize:22, fontWeight:700, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:12, color:"#64748b" }}>{s.label}</div>
                <div style={{ fontSize:11, color:"#9ca3af" }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            <h3 style={{ margin:"0 0 12px", fontSize:15 }}>Expense Breakdown</h3>
            {["Supplies","Utilities","Maintenance","Staff","Infrastructure","Events","Other"].map(cat=>{
              const total = expenses.filter(e=>e.category===cat).reduce((a,e)=>a+e.amount,0);
              return total>0?(
                <div key={cat} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #f1f5f9", fontSize:13 }}>
                  <span>{cat}</span>
                  <span style={{ fontWeight:600 }}>{formatGHS(total)}</span>
                </div>
              ):null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// LIBRARY
// ============================================================
function Library({ books, setBooks, borrows, setBorrows, students, users, currentUser, notify, addAudit }) {
  const [tab, setTab]           = useState("books");
  const [search, setSearch]     = useState("");
  const [showBookForm, setShowBookForm] = useState(false);
  const [editBookId, setEditBookId] = useState(null);
  const [bookForm, setBookForm] = useState({ title:"", author:"", isbn:"", copies:1, available:1, category:"Textbook" });
  const [borrowForm, setBorrowForm] = useState({ bookId:"", borrowerId:"", borrowerType:"Student", borrowDate:today(), dueDate:"" });
  const [showBorrowForm, setShowBorrowForm] = useState(false);

  const filteredBooks = books.filter(b=>b.title.toLowerCase().includes(search.toLowerCase())||b.author.toLowerCase().includes(search.toLowerCase()));
  const overdueList   = borrows.filter(b=>!b.returnDate&&b.dueDate<today());

  const saveBook = () => {
    if(!bookForm.title) { notify("Title required","error"); return; }
    if(editBookId) {
      setBooks(prev=>prev.map(b=>b.id===editBookId?{...b,...bookForm}:b));
      addAudit(`Updated book: ${bookForm.title}`,"Library"); notify("Book updated");
    } else {
      setBooks(prev=>[...prev,{id:uid("BK"),...bookForm}]);
      addAudit(`Added book: ${bookForm.title}`,"Library"); notify("Book added");
    }
    setShowBookForm(false); setEditBookId(null); setBookForm({ title:"", author:"", isbn:"", copies:1, available:1, category:"Textbook" });
  };

  const saveBorrow = () => {
    if(!borrowForm.bookId||!borrowForm.borrowerId||!borrowForm.dueDate) { notify("All fields required","error"); return; }
    const bk = books.find(b=>b.id===borrowForm.bookId);
    if(!bk||bk.available<1) { notify("No copies available","error"); return; }
    setBorrows(prev=>[...prev,{id:uid("BOR"),...borrowForm,returnDate:null,enteredBy:currentUser.code}]);
    setBooks(prev=>prev.map(b=>b.id===borrowForm.bookId?{...b,available:b.available-1}:b));
    addAudit(`Book borrowed: ${bk.title} by ${borrowForm.borrowerId}`,"Library");
    setShowBorrowForm(false); setBorrowForm({ bookId:"", borrowerId:"", borrowerType:"Student", borrowDate:today(), dueDate:"" });
    notify("Book borrowed ✅");
  };

  const returnBook = (borId) => {
    const bor = borrows.find(b=>b.id===borId);
    if(!bor) return;
    setBorrows(prev=>prev.map(b=>b.id===borId?{...b,returnDate:today()}:b));
    setBooks(prev=>prev.map(b=>b.id===bor.bookId?{...b,available:b.available+1}:b));
    addAudit(`Book returned: ${borId}`,"Library"); notify("Book returned ✅");
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:"#0f172a" }}>📚 Library</h2>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>setTab("books")} style={{ ...btnSmall, background:tab==="books"?"#1e40af":"#e5e7eb", color:tab==="books"?"#fff":"#374151", padding:"8px 14px" }}>Books</button>
          <button onClick={()=>setTab("borrows")} style={{ ...btnSmall, background:tab==="borrows"?"#1e40af":"#e5e7eb", color:tab==="borrows"?"#fff":"#374151", padding:"8px 14px" }}>Borrows</button>
          {overdueList.length>0&&<span style={{ background:"#fee2e2", color:"#dc2626", borderRadius:12, padding:"6px 12px", fontSize:12, fontWeight:700 }}>⚠️ {overdueList.length} Overdue</span>}
        </div>
      </div>

      {tab==="books"&&(
        <>
          <div style={{ display:"flex", gap:10, marginBottom:14 }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search books..."
              style={{ flex:1, padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}/>
            <button onClick={()=>{setShowBookForm(true);setEditBookId(null);setBookForm({ title:"", author:"", isbn:"", copies:1, available:1, category:"Textbook" });}} style={btnPrimary}>+ Add Book</button>
            <button onClick={()=>setShowBorrowForm(true)} style={{ ...btnPrimary, background:"#059669" }}>📤 Issue Book</button>
          </div>
          {showBookForm&&(
            <FormModal title={editBookId?"Edit Book":"Add Book"} onClose={()=>{setShowBookForm(false);setEditBookId(null);}}>
              <FormRow label="Title"><input value={bookForm.title} onChange={e=>setBookForm(p=>({...p,title:e.target.value}))} style={inp}/></FormRow>
              <FormRow label="Author"><input value={bookForm.author} onChange={e=>setBookForm(p=>({...p,author:e.target.value}))} style={inp}/></FormRow>
              <FormRow label="ISBN"><input value={bookForm.isbn} onChange={e=>setBookForm(p=>({...p,isbn:e.target.value}))} style={inp}/></FormRow>
              <FormRow label="Total Copies"><input type="number" value={bookForm.copies} onChange={e=>setBookForm(p=>({...p,copies:+e.target.value,available:+e.target.value}))} style={inp}/></FormRow>
              <FormRow label="Category">
                <select value={bookForm.category} onChange={e=>setBookForm(p=>({...p,category:e.target.value}))} style={inp}>
                  {["Textbook","Reference","Fiction","Library","Magazine","Other"].map(c=><option key={c}>{c}</option>)}
                </select>
              </FormRow>
              <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:16 }}>
                <button onClick={()=>{setShowBookForm(false);setEditBookId(null);}} style={btnSecondary}>Cancel</button>
                <button onClick={saveBook} style={btnPrimary}>Save</button>
              </div>
            </FormModal>
          )}
          {showBorrowForm&&(
            <FormModal title="Issue Book" onClose={()=>setShowBorrowForm(false)}>
              <FormRow label="Book">
                <select value={borrowForm.bookId} onChange={e=>setBorrowForm(p=>({...p,bookId:e.target.value}))} style={inp}>
                  <option value="">Select book</option>
                  {books.filter(b=>b.available>0).map(b=><option key={b.id} value={b.id}>{b.title} ({b.available} avail.)</option>)}
                </select>
              </FormRow>
              <FormRow label="Borrower Type">
                <select value={borrowForm.borrowerType} onChange={e=>setBorrowForm(p=>({...p,borrowerType:e.target.value,borrowerId:""}))} style={inp}>
                  <option>Student</option><option>Staff</option>
                </select>
              </FormRow>
              <FormRow label="Borrower">
                <select value={borrowForm.borrowerId} onChange={e=>setBorrowForm(p=>({...p,borrowerId:e.target.value}))} style={inp}>
                  <option value="">Select</option>
                  {(borrowForm.borrowerType==="Student"?students.filter(s=>s.status==="active"):users.filter(u=>u.active)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </FormRow>
              <FormRow label="Borrow Date"><input type="date" value={borrowForm.borrowDate} onChange={e=>setBorrowForm(p=>({...p,borrowDate:e.target.value}))} style={inp}/></FormRow>
              <FormRow label="Due Date"><input type="date" value={borrowForm.dueDate} onChange={e=>setBorrowForm(p=>({...p,dueDate:e.target.value}))} style={inp}/></FormRow>
              <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:16 }}>
                <button onClick={()=>setShowBorrowForm(false)} style={btnSecondary}>Cancel</button>
                <button onClick={saveBorrow} style={btnPrimary}>Issue</button>
              </div>
            </FormModal>
          )}
          <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ background:"#f8fafc" }}>
                {["Title","Author","ISBN","Category","Total","Available","Actions"].map(h=>(
                  <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filteredBooks.map(b=>(
                  <tr key={b.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                    <td style={{ padding:"8px 12px", fontWeight:600 }}>{b.title}</td>
                    <td style={{ padding:"8px 12px" }}>{b.author}</td>
                    <td style={{ padding:"8px 12px", color:"#6b7280", fontSize:11 }}>{b.isbn}</td>
                    <td style={{ padding:"8px 12px" }}><span style={{ background:"#f1f5f9", padding:"2px 8px", borderRadius:8, fontSize:11 }}>{b.category}</span></td>
                    <td style={{ padding:"8px 12px" }}>{b.copies}</td>
                    <td style={{ padding:"8px 12px" }}><span style={{ background:b.available>0?"#dcfce7":"#fee2e2", color:b.available>0?"#166534":"#991b1b", padding:"2px 8px", borderRadius:10, fontWeight:600, fontSize:12 }}>{b.available}</span></td>
                    <td style={{ padding:"8px 12px" }}>
                      <button onClick={()=>{setEditBookId(b.id);setBookForm({title:b.title,author:b.author,isbn:b.isbn,copies:b.copies,available:b.available,category:b.category});setShowBookForm(true);}}
                        style={{ ...btnSmall, background:"#dbeafe", color:"#1d4ed8" }}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab==="borrows"&&(
        <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ background:"#f8fafc" }}>
              {["Book","Borrower","Borrow Date","Due Date","Status","Actions"].map(h=>(
                <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {[...borrows].reverse().map(bor=>{
                const bk  = books.find(b=>b.id===bor.bookId);
                const brw = bor.borrowerType==="Student"?students.find(s=>s.id===bor.borrowerId):users.find(u=>u.id===bor.borrowerId);
                const overdue = !bor.returnDate && bor.dueDate < today();
                return (
                  <tr key={bor.id} style={{ borderBottom:"1px solid #f1f5f9", background:overdue?"#fff7f0":"#fff" }}>
                    <td style={{ padding:"8px 12px", fontWeight:600 }}>{bk?.title||"Unknown"}</td>
                    <td style={{ padding:"8px 12px" }}>{brw?.name||bor.borrowerId} ({bor.borrowerType})</td>
                    <td style={{ padding:"8px 12px" }}>{bor.borrowDate}</td>
                    <td style={{ padding:"8px 12px", color:overdue?"#dc2626":"inherit", fontWeight:overdue?700:400 }}>{bor.dueDate}{overdue?" ⚠️":""}</td>
                    <td style={{ padding:"8px 12px" }}>
                      {bor.returnDate
                        ? <span style={{ background:"#dcfce7", color:"#166534", padding:"2px 8px", borderRadius:10, fontSize:11 }}>Returned {bor.returnDate}</span>
                        : <span style={{ background:overdue?"#fee2e2":"#fef3c7", color:overdue?"#991b1b":"#92400e", padding:"2px 8px", borderRadius:10, fontSize:11 }}>{overdue?"OVERDUE":"Borrowed"}</span>
                      }
                    </td>
                    <td style={{ padding:"8px 12px" }}>
                      {!bor.returnDate&&<button onClick={()=>returnBook(bor.id)} style={{ ...btnSmall, background:"#dcfce7", color:"#166534" }}>Return</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TIMETABLE
// ============================================================
function Timetable({ timetables, currentUser, classes }) {
  const isTeacher = currentUser?.role==="Teacher";
  const myClass   = isTeacher ? currentUser?.classAssigned : null;
  const [selClass, setSelClass] = useState(myClass||"Class 6A");
  const tt = timetables[selClass];
  const dayColors = ["#eff6ff","#f0fdf4","#fefce8","#fdf2f8","#f0fdfa"];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:"#0f172a" }}>📅 Timetable</h2>
        {!isTeacher&&<select value={selClass} onChange={e=>setSelClass(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
          {Object.keys(timetables).map(c=><option key={c}>{c}</option>)}
        </select>}
        {isTeacher&&<div style={{ padding:"8px 14px", background:"#dbeafe", borderRadius:8, fontSize:13, color:"#1d4ed8", fontWeight:600 }}>📌 {selClass}</div>}
      </div>
      {tt ? (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            <thead>
              <tr style={{ background:"#0f172a" }}>
                <th style={{ padding:"10px 12px", color:"#94a3b8", textAlign:"left", fontSize:13 }}>Time</th>
                {tt.map((d,i)=><th key={d.day} style={{ padding:"10px 12px", color:"#fff", textAlign:"center", fontSize:13 }}>{d.day}</th>)}
              </tr>
            </thead>
            <tbody>
              {tt[0].periods.map((p,pi)=>(
                <tr key={pi} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"8px 12px", fontWeight:600, color:"#374151", fontSize:12, whiteSpace:"nowrap", background:"#f8fafc" }}>{p.time}</td>
                  {tt.map((d,di)=>{
                    const per = d.periods[pi];
                    const isBreak = per.subject==="Break"||per.subject==="Lunch";
                    return (
                      <td key={di} style={{ padding:"8px 10px", textAlign:"center", background:isBreak?"#f1f5f9":dayColors[di%5] }}>
                        <span style={{ fontSize:12, fontWeight:isBreak?400:600, color:isBreak?"#9ca3af":"#0f172a" }}>{per.subject}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p style={{ color:"#9ca3af" }}>No timetable found for {selClass}.</p>}
    </div>
  );
}

// ============================================================
// REPORTS
// ============================================================
function Reports({ students, grades, attendance, fees, expenses, classes, subjects, school }) {
  const [reportType, setReportType] = useState("student");
  const [selClass, setSelClass]     = useState(classes[0]);
  const [selStudent, setSelStudent] = useState("");
  const [selTerm, setSelTerm]       = useState("Term 1");
  const [selYear, setSelYear]       = useState("2024/2025");

  const classStudents = students.filter(s=>s.status==="active"&&s.class===selClass);

  const studentGrades = (sid, term, year) => grades.filter(g=>g.studentId===sid&&g.term===term&&g.year===year);
  const avg = (gArr) => gArr.length ? Math.round(gArr.reduce((a,g)=>a+g.score,0)/gArr.length) : 0;

  const attRate = (sid) => {
    const total = attendance.filter(a=>a.studentId===sid);
    const present = total.filter(a=>a.status==="Present");
    return total.length ? Math.round((present.length/total.length)*100) : 100;
  };

  return (
    <div>
      <h2 style={{ margin:"0 0 16px", fontSize:20, fontWeight:700, color:"#0f172a" }}>📋 Reports</h2>
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        {["student","class","subject"].map(t=>(
          <button key={t} onClick={()=>setReportType(t)} style={{ padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13, background:reportType===t?"#1e40af":"#e5e7eb", color:reportType===t?"#fff":"#374151" }}>
            {t==="student"?"Student Report":t==="class"?"Class Report":"Subject Analysis"}
          </button>
        ))}
      </div>

      {reportType==="student"&&(
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            <select value={selClass} onChange={e=>{setSelClass(e.target.value);setSelStudent("");}} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
              {classes.map(c=><option key={c}>{c}</option>)}
            </select>
            <select value={selStudent} onChange={e=>setSelStudent(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
              <option value="">Select student</option>
              {classStudents.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={selTerm} onChange={e=>setSelTerm(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
              <option>Term 1</option><option>Term 2</option><option>Term 3</option>
            </select>
          </div>
          {selStudent&&(()=>{
            const stu=students.find(s=>s.id===selStudent);
            const sg=studentGrades(selStudent,selTerm,selYear);
            const av=avg(sg);
            const att=attRate(selStudent);
            return (
              <div style={{ background:"#fff", borderRadius:12, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
                <div style={{ textAlign:"center", marginBottom:16, borderBottom:"2px solid #e5e7eb", paddingBottom:16 }}>
                  <div style={{ fontSize:22, fontWeight:700, color:"#0f172a" }}>{school.name}</div>
                  <div style={{ fontSize:13, color:"#64748b" }}>{school.address}</div>
                  <div style={{ fontSize:15, fontWeight:600, color:"#1e40af", marginTop:8 }}>ACADEMIC REPORT — {selTerm} {selYear}</div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
                  <div style={{ fontSize:13 }}><strong>Name:</strong> {stu?.name}</div>
                  <div style={{ fontSize:13 }}><strong>Class:</strong> {stu?.class}</div>
                  <div style={{ fontSize:13 }}><strong>Student ID:</strong> {stu?.id}</div>
                  <div style={{ fontSize:13 }}><strong>Attendance:</strong> <span style={{ color:att>=80?"#16a34a":"#dc2626", fontWeight:600 }}>{att}%</span></div>
                </div>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, marginBottom:16 }}>
                  <thead><tr style={{ background:"#f8fafc" }}>
                    {["Subject","Score","Grade","Remark"].map(h=><th key={h} style={{ padding:"8px 12px", textAlign:"left", fontWeight:600, borderBottom:"1px solid #e5e7eb" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {sg.length>0?sg.map(g=>(
                      <tr key={g.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"7px 12px" }}>{g.subject}</td>
                        <td style={{ padding:"7px 12px" }}>{g.score}</td>
                        <td style={{ padding:"7px 12px" }}><span style={{ fontWeight:700, color:g.grade==="A"?"#16a34a":g.grade==="F"?"#dc2626":"#0369a1" }}>{g.grade}</span></td>
                        <td style={{ padding:"7px 12px", color:"#64748b", fontSize:11 }}>{g.score>=80?"Excellent":g.score>=70?"Very Good":g.score>=60?"Good":g.score>=50?"Average":"Below Average"}</td>
                      </tr>
                    )):(<tr><td colSpan={4} style={{ padding:20, textAlign:"center", color:"#9ca3af" }}>No grades recorded for {selTerm}</td></tr>)}
                  </tbody>
                </table>
                {sg.length>0&&<div style={{ display:"flex", gap:16, padding:12, background:"#f0f9ff", borderRadius:8 }}>
                  <div><span style={{ fontSize:12, color:"#0369a1" }}>Average Score: </span><strong>{av}%</strong></div>
                  <div><span style={{ fontSize:12, color:"#0369a1" }}>Overall Grade: </span><strong style={{ color:av>=80?"#16a34a":av<50?"#dc2626":"#d97706" }}>{calcGrade(av)}</strong></div>
                </div>}
                <div style={{ marginTop:16 }}>
                  <button onClick={()=>window.print()} style={btnPrimary}>🖨️ Print Report</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {reportType==="class"&&(
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:14 }}>
            <select value={selClass} onChange={e=>setSelClass(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
              {classes.map(c=><option key={c}>{c}</option>)}
            </select>
            <select value={selTerm} onChange={e=>setSelTerm(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
              <option>Term 1</option><option>Term 2</option><option>Term 3</option>
            </select>
          </div>
          <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ background:"#f8fafc" }}>
                {["#","Student","Avg Score","Grade","Attendance","Fees Status"].map(h=>(
                  <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, borderBottom:"1px solid #e5e7eb" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {classStudents.map((s,i)=>{
                  const sg=studentGrades(s.id,selTerm,selYear);
                  const av=avg(sg);
                  const att=attRate(s.id);
                  return (
                    <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                      <td style={{ padding:"8px 12px", color:"#6b7280" }}>{i+1}</td>
                      <td style={{ padding:"8px 12px", fontWeight:600 }}>{s.name}</td>
                      <td style={{ padding:"8px 12px" }}>{sg.length?av+"% ("+sg.length+" subj.)":"No data"}</td>
                      <td style={{ padding:"8px 12px" }}>{sg.length?<span style={{ fontWeight:700, color:av>=80?"#16a34a":av<50?"#dc2626":"#d97706" }}>{calcGrade(av)}</span>:"—"}</td>
                      <td style={{ padding:"8px 12px" }}><span style={{ color:att>=80?"#16a34a":"#dc2626", fontWeight:600 }}>{att}%</span></td>
                      <td style={{ padding:"8px 12px" }}>{s.fees-s.paid===0?<span style={{ color:"#16a34a", fontWeight:600 }}>✅ Cleared</span>:<span style={{ color:"#dc2626" }}>⚠️ {formatGHS(s.fees-s.paid)} due</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportType==="subject"&&(
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:14 }}>
            <select value={selClass} onChange={e=>setSelClass(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
              {classes.map(c=><option key={c}>{c}</option>)}
            </select>
            <select value={selTerm} onChange={e=>setSelTerm(e.target.value)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
              <option>Term 1</option><option>Term 2</option><option>Term 3</option>
            </select>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12 }}>
            {subjects.map(sub=>{
              const sg = grades.filter(g=>g.subject===sub&&g.term===selTerm&&g.year===selYear&&classStudents.find(s=>s.id===g.studentId));
              if(!sg.length) return null;
              const av=avg(sg);
              const pass=sg.filter(g=>g.score>=50).length;
              return (
                <div key={sub} style={{ background:"#fff", borderRadius:12, padding:16, boxShadow:"0 1px 4px rgba(0,0,0,0.08)", borderLeft:`4px solid ${av>=70?"#16a34a":av>=50?"#d97706":"#dc2626"}` }}>
                  <div style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:6 }}>{sub}</div>
                  <div style={{ fontSize:22, fontWeight:700, color:av>=70?"#16a34a":av>=50?"#d97706":"#dc2626" }}>{av}%</div>
                  <div style={{ fontSize:12, color:"#64748b" }}>Class Average</div>
                  <div style={{ fontSize:12, color:"#94a3b8", marginTop:4 }}>{pass}/{sg.length} passed · {sg.length} grades</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ID CARDS
// ============================================================
function IDCards({ students, users, school }) {
  const [type, setType]       = useState("student");
  const [selId, setSelId]     = useState("");
  const [preview, setPreview] = useState(null);

  const allPeople = type==="student" ? students.filter(s=>s.status==="active") : users.filter(u=>u.active);

  const generate = () => {
    const person = allPeople.find(p=>p.id===selId);
    if(!person) return;
    setPreview(person);
  };

  const cardColors = { Admin:"#7c3aed", Headmaster:"#1d4ed8", HOD:"#0369a1", Teacher:"#059669", "Account Office":"#d97706", Librarian:"#6d28d9", "Non-Teaching Staff":"#6b7280" };

  return (
    <div>
      <h2 style={{ margin:"0 0 16px", fontSize:20, fontWeight:700, color:"#0f172a" }}>🪪 ID Card Generator</h2>
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <select value={type} onChange={e=>{setType(e.target.value);setSelId("");setPreview(null);}} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
          <option value="student">Student</option>
          <option value="staff">Staff</option>
        </select>
        <select value={selId} onChange={e=>setSelId(e.target.value)} style={{ flex:1, padding:"8px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13 }}>
          <option value="">Select person</option>
          {allPeople.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={generate} style={btnPrimary}>Generate ID Card</button>
        {type==="student"&&<button onClick={()=>{setPreview("all_students");}} style={{ ...btnPrimary, background:"#059669" }}>All Students</button>}
        {type==="staff"&&<button onClick={()=>setPreview("all_staff")} style={{ ...btnPrimary, background:"#059669" }}>All Staff</button>}
      </div>

      {preview&&preview!=="all_students"&&preview!=="all_staff"&&(
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
          <IDCard person={preview} type={type} school={school} cardColors={cardColors}/>
          <button onClick={()=>window.print()} style={{ ...btnPrimary, marginTop:16 }}>🖨️ Print ID Card</button>
        </div>
      )}

      {(preview==="all_students"||preview==="all_staff")&&(
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <p style={{ margin:0, color:"#64748b", fontSize:13 }}>Showing {allPeople.length} ID cards</p>
            <button onClick={()=>window.print()} style={btnPrimary}>🖨️ Print All</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:16 }}>
            {allPeople.map(p=><IDCard key={p.id} person={p} type={type} school={school} cardColors={cardColors}/>)}
          </div>
        </div>
      )}
    </div>
  );
}

function IDCard({ person, type, school, cardColors }) {
  const bgColor = type==="staff" ? (cardColors[person.role]||"#1e40af") : "#1e40af";
  return (
    <div style={{ width:320, borderRadius:16, overflow:"hidden", boxShadow:"0 4px 16px rgba(0,0,0,0.15)", fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ background:bgColor, padding:"16px 20px", color:"#fff" }}>
        <div style={{ fontSize:14, fontWeight:700 }}>{school.name}</div>
        <div style={{ fontSize:11, opacity:0.8 }}>{school.address}</div>
        <div style={{ fontSize:11, opacity:0.8, marginTop:2 }}>{school.motto}</div>
      </div>
      <div style={{ background:"#fff", padding:"16px 20px", display:"flex", gap:14 }}>
        <div style={{ width:60, height:60, borderRadius:10, background:bgColor+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>
          {type==="student"?"🎒":"👤"}
        </div>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:"#0f172a" }}>{person.name}</div>
          {type==="student"&&<><div style={{ fontSize:12, color:"#64748b" }}>Class: {person.class}</div><div style={{ fontSize:12, color:"#64748b" }}>Guardian: {person.guardian}</div></>}
          {type==="staff"&&<><div style={{ fontSize:12, color:bgColor, fontWeight:600 }}>{person.role}</div><div style={{ fontSize:11, color:"#64748b" }}>{person.email}</div></>}
        </div>
      </div>
      <div style={{ background:"#f8fafc", padding:"8px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:11, color:"#94a3b8" }}>ID</div>
          <div style={{ fontSize:13, fontWeight:700, color:"#1e40af", letterSpacing:1 }}>{person.id}</div>
        </div>
        {type==="staff"&&<div>
          <div style={{ fontSize:11, color:"#94a3b8" }}>Code</div>
          <div style={{ fontSize:13, fontWeight:700, color:bgColor }}>{person.code}</div>
        </div>}
        <div style={{ width:50, height:50, background:"#0f172a", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, color:"#fff", padding:4, textAlign:"center" }}>
          QR<br/>{person.id}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ARCHIVE
// ============================================================
function Archive({ students, setStudents, users, setUsers, notify, addAudit }) {
  const [tab, setTab] = useState("dropouts");
  const dropped   = students.filter(s=>s.status==="dropout");
  const graduated = students.filter(s=>s.status==="graduated");
  const inactive  = users.filter(u=>!u.active);

  const restore = (id) => {
    setStudents(prev=>prev.map(s=>s.id===id?{...s,status:"active"}:s));
    addAudit(`Restored student ${id}`,"Archive"); notify("Student restored to active");
  };

  return (
    <div>
      <h2 style={{ margin:"0 0 16px", fontSize:20, fontWeight:700, color:"#0f172a" }}>🗄️ Archive & Records</h2>
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        {[["dropouts","Dropouts / Expelled",dropped.length],["graduated","Graduated",graduated.length],["staff","Former Staff",inactive.length]].map(([k,l,c])=>(
          <button key={k} onClick={()=>setTab(k)} style={{ padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13, background:tab===k?"#1e40af":"#e5e7eb", color:tab===k?"#fff":"#374151" }}>
            {l} <span style={{ background:"rgba(255,255,255,0.25)", borderRadius:10, padding:"1px 6px", fontSize:11 }}>{c}</span>
          </button>
        ))}
      </div>

      {(tab==="dropouts"||tab==="graduated")&&(
        <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ background:"#f8fafc" }}>
              {["ID","Name","Class","Guardian","Phone","Status","Actions"].map(h=>(
                <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, borderBottom:"1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(tab==="dropouts"?dropped:graduated).map(s=>(
                <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"8px 12px", color:"#6b7280" }}>{s.id}</td>
                  <td style={{ padding:"8px 12px", fontWeight:600 }}>{s.name}</td>
                  <td style={{ padding:"8px 12px" }}>{s.class}</td>
                  <td style={{ padding:"8px 12px" }}>{s.guardian}</td>
                  <td style={{ padding:"8px 12px" }}>{s.phone}</td>
                  <td style={{ padding:"8px 12px" }}>
                    <span style={{ background:s.status==="dropout"?"#fee2e2":"#dbeafe", color:s.status==="dropout"?"#991b1b":"#1d4ed8", padding:"2px 8px", borderRadius:10, fontSize:11, fontWeight:600 }}>
                      {s.status==="dropout"?"Dropped Out":"Graduated"}
                    </span>
                  </td>
                  <td style={{ padding:"8px 12px" }}>
                    {s.status==="dropout"&&<button onClick={()=>restore(s.id)} style={{ ...btnSmall, background:"#dcfce7", color:"#166534" }}>Restore</button>}
                  </td>
                </tr>
              ))}
              {(tab==="dropouts"?dropped:graduated).length===0&&<tr><td colSpan={7} style={{ padding:20, textAlign:"center", color:"#9ca3af" }}>No records found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab==="staff"&&(
        <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ background:"#f8fafc" }}>
              {["ID","Code","Name","Role","Email"].map(h=>(
                <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, borderBottom:"1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {inactive.map(u=>(
                <tr key={u.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"8px 12px", color:"#6b7280" }}>{u.id}</td>
                  <td style={{ padding:"8px 12px", fontWeight:700, color:"#6b7280" }}>{u.code}</td>
                  <td style={{ padding:"8px 12px", fontWeight:600 }}>{u.name}</td>
                  <td style={{ padding:"8px 12px" }}>{u.role}</td>
                  <td style={{ padding:"8px 12px", color:"#6b7280" }}>{u.email}</td>
                </tr>
              ))}
              {inactive.length===0&&<tr><td colSpan={5} style={{ padding:20, textAlign:"center", color:"#9ca3af" }}>No former staff records.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// AUDIT LOG
// ============================================================
function AuditLog({ auditLog, users }) {
  const getUser = (code) => users.find(u=>u.code===code);
  return (
    <div>
      <h2 style={{ margin:"0 0 16px", fontSize:20, fontWeight:700, color:"#0f172a" }}>🔍 Audit Log</h2>
      <p style={{ fontSize:13, color:"#64748b", marginBottom:14 }}>All data entries are tracked by staff code for accountability.</p>
      <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr style={{ background:"#f8fafc" }}>
            {["Timestamp","Staff Code","Staff Name","Role","Action","Section"].map(h=>(
              <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:600, borderBottom:"1px solid #e5e7eb" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {[...auditLog].reverse().map(log=>{
              const u=getUser(log.user);
              return (
                <tr key={log.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"8px 12px", fontSize:11, color:"#6b7280", whiteSpace:"nowrap" }}>{log.timestamp}</td>
                  <td style={{ padding:"8px 12px", fontWeight:700, color:"#1e40af" }}>{log.user}</td>
                  <td style={{ padding:"8px 12px" }}>{u?.name||"—"}</td>
                  <td style={{ padding:"8px 12px", fontSize:11 }}>{u?.role||"—"}</td>
                  <td style={{ padding:"8px 12px" }}>{log.action}</td>
                  <td style={{ padding:"8px 12px" }}><span style={{ background:"#f1f5f9", padding:"2px 8px", borderRadius:8, fontSize:11 }}>{log.section}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// SETTINGS
// ============================================================
function Settings({ school, setSchool, users, setUsers, notify, addAudit }) {
  const [form, setForm]   = useState({...school});
  const [tab, setTab]     = useState("school");

  const saveSchool = () => {
    setSchool({...form});
    addAudit("Updated school settings","Settings");
    notify("School settings saved ✅");
  };

  return (
    <div>
      <h2 style={{ margin:"0 0 16px", fontSize:20, fontWeight:700, color:"#0f172a" }}>⚙️ Settings</h2>
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        {["school","licence"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13, background:tab===t?"#1e40af":"#e5e7eb", color:tab===t?"#fff":"#374151" }}>
            {t==="school"?"🏫 School Profile":"🔑 Licence"}
          </button>
        ))}
      </div>

      {tab==="school"&&(
        <div style={{ background:"#fff", borderRadius:12, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.08)", maxWidth:560 }}>
          <h3 style={{ margin:"0 0 16px", fontSize:16 }}>School Profile (appears on receipts & reports)</h3>
          <FormRow label="School Name"><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Address"><input value={form.address} onChange={e=>setForm(p=>({...p,address:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Phone"><input value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Email"><input value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Motto"><input value={form.motto} onChange={e=>setForm(p=>({...p,motto:e.target.value}))} style={inp}/></FormRow>
          <FormRow label="Current Term">
            <select value={form.currentTerm} onChange={e=>setForm(p=>({...p,currentTerm:e.target.value}))} style={inp}>
              <option>Term 1</option><option>Term 2</option><option>Term 3</option>
            </select>
          </FormRow>
          <FormRow label="Academic Year"><input value={form.currentYear} onChange={e=>setForm(p=>({...p,currentYear:e.target.value}))} style={inp}/></FormRow>
          <button onClick={saveSchool} style={{ ...btnPrimary, marginTop:16 }}>Save Settings</button>
        </div>
      )}

      {tab==="licence"&&(
        <div style={{ background:"#fff", borderRadius:12, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.08)", maxWidth:480 }}>
          <h3 style={{ margin:"0 0 16px", fontSize:16 }}>Licence Information</h3>
          <div style={{ background:"#f0f9ff", borderRadius:10, padding:16, fontSize:13, lineHeight:2 }}>
            <div><strong>Product:</strong> EduSmart School Manager v4.0</div>
            <div><strong>School:</strong> {school.name}</div>
            <div><strong>Developer:</strong> Gilbert Oscar Prah (EduSmart)</div>
            <div><strong>Contact:</strong> aifarms101@gmail.com | 0597147460</div>
          </div>
          <div style={{ marginTop:16, borderTop:"1px solid #e5e7eb", paddingTop:16 }}>
            <h4 style={{ fontSize:14, color:"#374151", margin:"0 0 10px" }}>Pricing</h4>
            {[["Trial (1 Term)","Free","Limited to 1 term"],["Basic (Annual)","GH₵ 1,500/year","Full features"],["Pro (Multi-school)","GH₵ 3,500/year","Multi-branch support"]].map(([name,price,desc])=>(
              <div key={name} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid #f1f5f9", fontSize:13 }}>
                <span><strong>{name}</strong> — {desc}</span>
                <span style={{ fontWeight:700, color:"#1e40af" }}>{price}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:16, background:"#fffbeb", borderRadius:8, padding:12, fontSize:12, color:"#92400e" }}>
            📞 To purchase or renew: <strong>0597147460</strong> | <strong>aifarms101@gmail.com</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SHARED UI COMPONENTS
// ============================================================
function FormModal({ title, children, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:"#fff", borderRadius:14, padding:24, maxWidth:520, width:"100%", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:"#0f172a" }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#6b7280" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:"block", fontSize:12, fontWeight:600, color:"#374151", marginBottom:4 }}>{label}</label>
      {children}
    </div>
  );
}

const inp = { width:"100%", padding:"8px 12px", borderRadius:8, border:"1.5px solid #d1d5db", fontSize:13, boxSizing:"border-box" };
const btnPrimary   = { padding:"9px 20px", background:"#1e40af", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 };
const btnSecondary = { padding:"9px 20px", background:"#e5e7eb", color:"#374151", border:"none", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600 };
const btnSmall     = { padding:"5px 10px", border:"none", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600 };
