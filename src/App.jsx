
import { useState, useEffect, useRef } from "react";

// ─── LICENCE CONFIG ───────────────────────────────────────────
const TRIAL_TERM_DAYS = 120; // ~1 school term
const LICENCE_TIERS = {
  basic: { label: "Basic (1 school)", price: 2400, schools: 1 },
  standard: { label: "Standard (3 schools)", price: 5500, schools: 3 },
  premium: { label: "Premium (Unlimited)", price: 9800, schools: 999 },
};

// ─── DEFAULT DATA ─────────────────────────────────────────────
const DEFAULT_SCHOOL = {
  name: "My School",
  address: "Eikwe, Western Region, Ghana",
  phone: "+233 000 000 000",
  email: "info@eikwebasic.edu.gh",
  motto: "Knowledge is Power",
  logo: null,
  principalName: "Mr. K. Asante",
  established: "1985",
};

const ROLES = {
  admin: { label: "Administrator", color: "#6366f1", access: "all" },
  headmaster: { label: "Headmaster", color: "#8b5cf6", access: "all" },
  hod: { label: "Head of Department", color: "#7c3aed", access: "all" },
  teacher: { label: "Class Teacher", color: "#0ea5e9", access: "teacher" },
  accountant: { label: "Account Office", color: "#10b981", access: "accounts" },
  librarian: { label: "Librarian", color: "#f59e0b", access: "library" },
  nonteaching: { label: "Non-Teaching Staff", color: "#64748b", access: "none" },
};

const CLASSES = ["Nursery 1","Nursery 2","KG 1","KG 2","Primary 1","Primary 2","Primary 3","Primary 4","Primary 5","Primary 6","JHS 1","JHS 2","JHS 3"];
const SUBJECTS = ["English Language","Mathematics","Integrated Science","Social Studies","ICT","RME","French","Ghanaian Language","Creative Arts","Physical Education","Career Technology","Elective Math"];
const DEPARTMENTS = ["Lower Primary","Upper Primary","Junior High School","Administration"];
const FEE_TYPES = ["School Fees","PTA Levy","Examination Fees","Sports Levy","Library Fees","Uniform","Feeding","Other"];
const BOOK_CATEGORIES = ["Textbook","Novel","Reference","Magazine","Dictionary","Atlas"];

// ─── SEED USERS ───────────────────────────────────────────────
const SEED_USERS = [
  { id:"USR-001", code:"ADM001", name:"Gilbert Prah", role:"admin", username:"admin", pin:"1234", dept:"Administration", subject:"", assignedClass:"", email:"admin@school.gh", phone:"0500000001", active:true },
  { id:"USR-002", code:"HMS001", name:"Dr. Kwame Mensah", role:"headmaster", username:"headmaster", pin:"2345", dept:"Administration", subject:"", assignedClass:"", email:"hm@school.gh", phone:"0500000002", active:true },
  { id:"USR-003", code:"HOD001", name:"Mrs. Abena Osei", role:"hod", username:"hod1", pin:"3456", dept:"Junior High School", subject:"Mathematics", assignedClass:"JHS 3", email:"hod1@school.gh", phone:"0500000003", active:true },
  { id:"USR-004", code:"TCH001", name:"Mr. Kofi Asare", role:"teacher", username:"teacher1", pin:"4567", dept:"Upper Primary", subject:"English Language", assignedClass:"Primary 6", email:"t1@school.gh", phone:"0500000004", active:true },
  { id:"USR-005", code:"TCH002", name:"Miss Ama Boateng", role:"teacher", username:"teacher2", pin:"5678", dept:"Lower Primary", subject:"Mathematics", assignedClass:"Primary 3", email:"t2@school.gh", phone:"0500000005", active:true },
  { id:"USR-006", code:"ACC001", name:"Mr. Yaw Darko", role:"accountant", username:"accounts", pin:"6789", dept:"Administration", subject:"", assignedClass:"", email:"acc@school.gh", phone:"0500000006", active:true },
  { id:"USR-007", code:"LIB001", name:"Mrs. Efua Ankah", role:"librarian", username:"library", pin:"7890", dept:"Administration", subject:"", assignedClass:"", email:"lib@school.gh", phone:"0500000007", active:true },
  { id:"USR-008", code:"NTS001", name:"Mr. Joseph Kuma", role:"nonteaching", username:"security", pin:"8901", dept:"Administration", subject:"", assignedClass:"", email:"nt1@school.gh", phone:"0500000008", active:true },
];

const SEED_STUDENTS = [];

const SEED_FEES = [];

const SEED_GRADES = [];

const SEED_ATTENDANCE = [];

const SEED_TIMETABLE = {
  "Primary 6": {
    Monday: { "07:30":"English Language","08:30":"Mathematics","09:30":"Break","10:00":"Integrated Science","11:00":"Social Studies","12:00":"Lunch","13:00":"ICT","14:00":"Creative Arts" },
    Tuesday: { "07:30":"Mathematics","08:30":"English Language","09:30":"Break","10:00":"French","11:00":"RME","12:00":"Lunch","13:00":"Ghanaian Language","14:00":"Physical Education" },
    Wednesday: { "07:30":"Integrated Science","08:30":"Social Studies","09:30":"Break","10:00":"Mathematics","11:00":"English Language","12:00":"Lunch","13:00":"Career Technology","14:00":"Creative Arts" },
    Thursday: { "07:30":"English Language","08:30":"Mathematics","09:30":"Break","10:00":"French","11:00":"ICT","12:00":"Lunch","13:00":"RME","14:00":"Ghanaian Language" },
    Friday: { "07:30":"Mathematics","08:30":"Integrated Science","09:30":"Break","10:00":"English Language","11:00":"Social Studies","12:00":"Lunch","13:00":"Assembly/Sports","14:00":"Physical Education" },
  },
  "Primary 3": {
    Monday: { "07:30":"English Language","08:30":"Mathematics","09:30":"Break","10:00":"Integrated Science","11:00":"Social Studies","12:00":"Lunch","13:00":"Creative Arts","14:00":"Ghanaian Language" },
    Tuesday: { "07:30":"Mathematics","08:30":"English Language","09:30":"Break","10:00":"RME","11:00":"Creative Arts","12:00":"Lunch","13:00":"Physical Education","14:00":"Ghanaian Language" },
    Wednesday: { "07:30":"Integrated Science","08:30":"Mathematics","09:30":"Break","10:00":"English Language","11:00":"Social Studies","12:00":"Lunch","13:00":"RME","14:00":"Creative Arts" },
    Thursday: { "07:30":"English Language","08:30":"Mathematics","09:30":"Break","10:00":"Ghanaian Language","11:00":"Creative Arts","12:00":"Lunch","13:00":"Physical Education","14:00":"RME" },
    Friday: { "07:30":"Mathematics","08:30":"English Language","09:30":"Break","10:00":"Integrated Science","11:00":"Social Studies","12:00":"Lunch","13:00":"Assembly/Sports","14:00":"Physical Education" },
  },
};

const SEED_BOOKS = [];

const SEED_BOOK_LOANS = [
  { id:"BL-001", bookId:"BK-001", bookTitle:"New Standard Mathematics 6", borrower:"Akosua Mensah", borrowerType:"student", borrowerId:"STU-001", loanDate:"2024-01-20", dueDate:"2024-02-20", returnDate:"", status:"active", issuedBy:"LIB001" },
];

const SEED_OLD_STUDENTS = [
  { id:"OLD-001", name:"Benjamin Sarkodie", class:"JHS 3", graduationYear:"2022", parentPhone:"0244999001", address:"Eikwe", achievements:"BECE: Aggregate 8", currentStatus:"Senior High School", notes:"Outstanding student" },
];

const SEED_OLD_STAFF = [
  { id:"OLDS-001", name:"Mr. Daniel Acheampong", role:"teacher", dept:"Upper Primary", yearsServed:"2015-2022", subject:"Mathematics", reason:"Transferred", contactPhone:"0244888001", notes:"Excellent teacher" },
];

const SEED_EXPELLED = [
  { id:"EXP-001", studentId:"STU-EX-01", name:"Test Student", class:"JHS 2", date:"2023-11-15", reason:"Repeated misconduct", type:"expelled", parentNotified:true, enteredBy:"HMS001", notes:"Parents duly informed" },
];

// ─── HELPERS ──────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9).toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-GB") : "—";
const gradeFromTotal = t => t >= 90 ? "A1" : t >= 80 ? "B2" : t >= 75 ? "B3" : t >= 70 ? "C4" : t >= 65 ? "C5" : t >= 60 ? "C6" : t >= 55 ? "D7" : t >= 50 ? "D8" : t >= 40 ? "E8" : "F9";
const remarkFromGrade = g => ({ A1:"Excellent", B2:"Very Good", B3:"Good", C4:"Credit", C5:"Credit", C6:"Credit", D7:"Pass", D8:"Pass", E8:"Weak Pass", F9:"Fail" }[g] || "—");

const getLS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const setLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function canAccess(role, section) {
  if (["admin","headmaster","hod"].includes(role)) return true;
  if (role === "teacher") return ["grades","attendance","timetable","students_view"].includes(section);
  if (role === "accountant") return ["fees","finance"].includes(section);
  if (role === "librarian") return ["library"].includes(section);
  return false;
}

// ─── PRINT HELPERS ────────────────────────────────────────────
function printReceipt(fee, school, users) {
  const staff = users.find(u => u.code === fee.enteredBy);
  const win = window.open("", "_blank", "width=400,height=600");
  win.document.write(`<html><head><title>Receipt</title><style>
    body{font-family:Arial,sans-serif;padding:20px;font-size:12px}
    .hdr{text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:10px}
    .hdr h2{margin:0;font-size:16px} .hdr p{margin:2px;font-size:11px}
    .row{display:flex;justify-content:space-between;margin:4px 0}
    .title{font-weight:bold;font-size:11px;color:#555}
    .footer{margin-top:20px;border-top:1px dashed #aaa;padding-top:10px;font-size:10px;color:#777}
    @media print{body{margin:0}}
  </style></head><body>
    <div class="hdr">
      <h2>${school.name}</h2>
      <p>${school.address}</p>
      <p>Tel: ${school.phone} | ${school.email}</p>
      <p style="font-weight:bold;margin-top:6px">OFFICIAL RECEIPT</p>
    </div>
    <div class="row"><span class="title">Receipt No:</span><span>${fee.receiptNo || "—"}</span></div>
    <div class="row"><span class="title">Date:</span><span>${fmtDate(fee.date)}</span></div>
    <div class="row"><span class="title">Student:</span><span>${fee.studentName}</span></div>
    <div class="row"><span class="title">Class:</span><span>${fee.class}</span></div>
    <div class="row"><span class="title">Term:</span><span>${fee.term}</span></div>
    <div class="row"><span class="title">Payment Type:</span><span>${fee.type}</span></div>
    <div class="row"><span class="title">Amount Due:</span><span>GH₵ ${fee.amount.toFixed(2)}</span></div>
    <div class="row"><span class="title">Amount Paid:</span><span>GH₵ ${fee.paid.toFixed(2)}</span></div>
    <div class="row"><span class="title">Balance:</span><span>GH₵ ${fee.balance.toFixed(2)}</span></div>
    <div class="row"><span class="title">Status:</span><span style="text-transform:uppercase;font-weight:bold">${fee.status}</span></div>
    <div class="footer">
      <p>Issued by: ${staff ? staff.name : fee.enteredBy} (${fee.enteredBy})</p>
      <p>${school.motto}</p>
      <p style="text-align:center;margin-top:8px">Thank you for your payment</p>
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`);
}

function printIDCard(person, school, type) {
  const win = window.open("", "_blank", "width=400,height=300");
  const color = type === "student" ? "#1e40af" : type === "teacher" ? "#7c3aed" : "#374151";
  win.document.write(`<html><head><title>ID Card</title><style>
    body{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f1f5f9}
    .card{width:340px;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.2);background:#fff}
    .top{background:${color};color:#fff;padding:16px;text-align:center}
    .top h3{margin:0;font-size:14px} .top p{margin:2px;font-size:11px;opacity:.85}
    .body{padding:16px;display:flex;gap:12px;align-items:center}
    .avatar{width:64px;height:64px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:bold;color:${color};flex-shrink:0}
    .info p{margin:2px;font-size:12px} .info .name{font-size:14px;font-weight:bold}
    .id-badge{background:${color};color:#fff;text-align:center;padding:8px;font-size:13px;font-weight:bold;letter-spacing:1px}
    @media print{body{background:#fff}}
  </style></head><body>
    <div class="card">
      <div class="top"><h3>${school.name}</h3><p>${school.address}</p></div>
      <div class="body">
        <div class="avatar">${(person.name||"?")[0]}</div>
        <div class="info">
          <p class="name">${person.name}</p>
          <p>${type === "student" ? person.class : (person.role ? ROLES[person.role]?.label : person.role)}</p>
          ${type !== "student" ? `<p>${person.dept || ""}</p>` : `<p>Admitted: ${fmtDate(person.admissionDate)}</p>`}
        </div>
      </div>
      <div class="id-badge">${person.studentId || person.id || "ID"}</div>
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`);
}

function printReportCard(student, grades, school, term, users) {
  const studentGrades = grades.filter(g => g.studentId === student.id && g.term === term);
  const avg = studentGrades.length ? Math.round(studentGrades.reduce((s, g) => s + g.total, 0) / studentGrades.length) : 0;
  const win = window.open("", "_blank");
  win.document.write(`<html><head><title>Report Card</title><style>
    body{font-family:Arial;padding:24px;font-size:13px}
    .hdr{text-align:center;border-bottom:2px solid #1e40af;padding-bottom:12px}
    .hdr h2{color:#1e40af;margin:0} .hdr p{margin:2px;font-size:11px}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th{background:#1e40af;color:#fff;padding:8px;text-align:left}
    td{padding:7px 8px;border-bottom:1px solid #e2e8f0}
    tr:nth-child(even){background:#f8fafc}
    .summary{margin-top:16px;display:flex;gap:24px}
    .grade-A1{color:#16a34a} .grade-F9{color:#dc2626}
    @media print{body{margin:0}}
  </style></head><body>
    <div class="hdr"><h2>${school.name}</h2><p>${school.address} | ${school.phone}</p>
    <p style="font-weight:bold;margin-top:6px">STUDENT REPORT CARD — ${term}</p></div>
    <div class="summary">
      <div><b>Name:</b> ${student.name}</div>
      <div><b>Class:</b> ${student.class}</div>
      <div><b>Student ID:</b> ${student.studentId}</div>
      <div><b>Average:</b> ${avg}%</div>
    </div>
    <table><thead><tr><th>Subject</th><th>Class Score (40)</th><th>Exam Score (60)</th><th>Total (100)</th><th>Grade</th><th>Remark</th></tr></thead>
    <tbody>${studentGrades.map(g => `<tr><td>${g.subject}</td><td>${g.classScore}</td><td>${g.examScore}</td><td>${g.total}</td><td class="grade-${g.grade}">${g.grade}</td><td>${g.remark}</td></tr>`).join("")}
    </tbody></table>
    <div class="summary" style="margin-top:20px">
      <div><b>Overall Average:</b> ${avg}%</div>
      <div><b>Grade:</b> ${gradeFromTotal(avg)}</div>
      <div><b>Overall Remark:</b> ${remarkFromGrade(gradeFromTotal(avg))}</div>
    </div>
    <div style="margin-top:30px;display:flex;justify-content:space-between">
      <div style="text-align:center"><div style="border-top:1px solid #333;width:150px;padding-top:4px">Class Teacher</div></div>
      <div style="text-align:center"><div style="border-top:1px solid #333;width:150px;padding-top:4px">Headmaster</div></div>
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`);
}

// ─── LICENCE GATE ─────────────────────────────────────────────
function LicenceGate({ onActivate }) {
  const [key, setKey] = useState("");
  const [mode, setMode] = useState("check"); // check | trial | activate
  const [msg, setMsg] = useState("");

  const startTrial = () => {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + TRIAL_TERM_DAYS);
    onActivate({ type: "trial", expiry: expiry.toISOString(), school: DEFAULT_SCHOOL });
  };

  const activateKey = () => {
    // Simple key format: EDU-XXXX-XXXX-XXXX
    if (/^EDU-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
      const tier = key.startsWith("EDU-PREM") ? "premium" : key.startsWith("EDU-STD") ? "standard" : "basic";
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);
      onActivate({ type: "licensed", key, tier, expiry: expiry.toISOString(), school: DEFAULT_SCHOOL });
    } else {
      setMsg("Invalid licence key. Format: EDU-XXXX-XXXX-XXXX");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#1e3a8a,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "40px 36px", maxWidth: 440, width: "100%", textAlign: "center", boxShadow: "0 25px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🏫</div>
        <h1 style={{ margin: "0 0 4px", color: "#1e3a8a", fontSize: 24 }}>EduSmart</h1>
        <p style={{ color: "#6b7280", marginBottom: 28, fontSize: 14 }}>School Manager v4 — by Gilbert Prah</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <button onClick={() => setMode("trial")} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "2px solid #e5e7eb", background: mode === "trial" ? "#1e3a8a" : "#fff", color: mode === "trial" ? "#fff" : "#374151", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Free Trial</button>
          <button onClick={() => setMode("activate")} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "2px solid #e5e7eb", background: mode === "activate" ? "#1e3a8a" : "#fff", color: mode === "activate" ? "#fff" : "#374151", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Activate Licence</button>
        </div>
        {mode === "trial" && (
          <div>
            <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>Start a <strong>{TRIAL_TERM_DAYS}-day free trial</strong> — approximately one school term. All features are available. No credit card required.</p>
            <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: 12, margin: "16px 0", fontSize: 12, color: "#92400e" }}>Trial includes all features. Purchase a licence before expiry to retain your data.</div>
            <button onClick={startTrial} style={{ width: "100%", padding: "12px 0", background: "linear-gradient(135deg,#1e3a8a,#7c3aed)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Start Free Trial</button>
            <div style={{ marginTop: 20, textAlign: "left" }}>
              {Object.entries(LICENCE_TIERS).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
                  <span>{v.label}</span><span style={{ fontWeight: 700, color: "#1e3a8a" }}>GH₵ {v.price.toLocaleString()}/yr</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {mode === "activate" && (
          <div>
            <p style={{ fontSize: 13, color: "#6b7280" }}>Enter your licence key to activate.</p>
            <input value={key} onChange={e => { setKey(e.target.value.toUpperCase()); setMsg(""); }} placeholder="EDU-XXXX-XXXX-XXXX" style={{ width: "100%", padding: 10, border: "2px solid #e5e7eb", borderRadius: 8, fontSize: 14, textAlign: "center", boxSizing: "border-box", letterSpacing: 2, marginBottom: 8 }} />
            {msg && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{msg}</p>}
            <button onClick={activateKey} style={{ width: "100%", padding: "12px 0", background: "linear-gradient(135deg,#1e3a8a,#7c3aed)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Activate</button>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12 }}>To purchase a licence, contact: gilbert@edusmart.gh | 0597147460</p>
          </div>
        )}
      </div>

      {showReset&&(
        <ResetModal
          adminPin={users.find(u=>u.role==="admin")?.pin||""}
          accent="#C9A84C" cardBg="#0f2040"
          onCancel={()=>setShowReset(false)}
          onConfirm={()=>{
            ["edu_students","edu_fees","edu_grades","edu_attendance","edu_books","edu_loans","edu_old_students","edu_old_staff","edu_expelled","edu_school","edu_licence","edu_setup","EduSmart-v4_inst","edu_users"].forEach(k=>localStorage.removeItem(k));
            setShowReset(false); window.location.reload();
          }}
        />
      )}
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────
function LoginScreen({ users, onLogin, licence, school }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const daysLeft = Math.max(0, Math.ceil((new Date(licence.expiry) - new Date()) / 86400000));

  const handleLogin = () => {
    const user = users.find(u => u.username === username && u.pin === pin && u.active);
    if (user) onLogin(user);
    else setErr("Invalid username or PIN. Try again.");
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#1e3a8a 0%,#1e40af 50%,#7c3aed 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "40px 36px", maxWidth: 400, width: "100%", boxShadow: "0 25px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 44 }}>🏫</div>
          <h2 style={{ margin: "4px 0 2px", color: "#1e3a8a" }}>{school.name}</h2>
          <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>EduSmart School Manager v4</p>
          {licence.type === "trial" && <div style={{ background: "#fef3c7", borderRadius: 6, padding: "4px 10px", display: "inline-block", marginTop: 8, fontSize: 11, color: "#92400e" }}>Trial: {daysLeft} days remaining</div>}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} placeholder="Enter username" />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>PIN</label>
          <input value={pin} onChange={e => setPin(e.target.value)} type="password" onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} placeholder="Enter PIN" />
        </div>
        {err && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 10 }}>{err}</p>}
        <button onClick={handleLogin} style={{ width: "100%", padding: "12px 0", background: "linear-gradient(135deg,#1e3a8a,#7c3aed)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Sign In</button>
        <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 11, color: "#6b7280" }}>
          <strong>Demo:</strong> admin / 1234 | teacher1 / 4567 | accounts / 6789 | library / 7890
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR NAV ──────────────────────────────────────────────
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "📊", section: "dashboard" },
  { key: "students",  label: "Students",  icon: "👨‍🎓", section: "students" },
  { key: "staff",     label: "Staff",     icon: "👩‍🏫", section: "staff" },
  { key: "attendance",label: "Attendance",icon: "📋", section: "attendance" },
  { key: "grades",    label: "Grades & Reports", icon: "📝", section: "grades" },
  { key: "timetable", label: "Timetable", icon: "🗓️", section: "timetable" },
  { key: "fees",      label: "Fees & Finance", icon: "💰", section: "fees" },
  { key: "library",   label: "Library",   icon: "📚", section: "library" },
  { key: "alumni",    label: "Alumni & Archives", icon: "🏛️", section: "alumni" },
  { key: "expelled",  label: "Expelled / Dropout", icon: "⚠️", section: "expelled" },
  { key: "idcards",   label: "ID Cards",  icon: "🪪", section: "idcards" },
  { key: "backup",    label: "Backup & Restore", icon: "💾", section: "backup" },
  { key: "settings",  label: "Settings",  icon: "⚙️", section: "settings" },
];

function Sidebar({ currentUser, active, onNavigate, school, onLogout }) {
  const visible = NAV_ITEMS.filter(n => {
    if (n.section === "dashboard") return true;
    if (n.section === "students" || n.section === "students_view") return canAccess(currentUser.role, "students") || canAccess(currentUser.role, "students_view");
    return canAccess(currentUser.role, n.section);
  });

  return (
    <div style={{ width: 220, background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column", height: "100vh", position: "fixed", top: 0, left: 0, overflow: "hidden" }}>
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid #1e293b" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>{school.name}</div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>EduSmart v4</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {visible.map(item => (
          <button key={item.key} onClick={() => onNavigate(item.key)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", background: active === item.key ? "#1e3a8a" : "transparent", color: active === item.key ? "#fff" : "#94a3b8", border: "none", cursor: "pointer", fontSize: 13, textAlign: "left", transition: "background .15s" }}>
            <span>{item.icon}</span><span>{item.label}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid #1e293b" }}>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{currentUser.name}</div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8 }}>{ROLES[currentUser.role]?.label} • {currentUser.code}</div>
        <button onClick={onLogout} style={{ width: "100%", padding: "7px 0", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Sign Out</button>
      </div>
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────
const Card = ({ children, style = {} }) => <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", ...style }}>{children}</div>;
const Badge = ({ label, color = "#6366f1" }) => <span style={{ background: color + "20", color, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20 }}>{label}</span>;
const Btn = ({ onClick, children, color = "#1e3a8a", size = "md", style = {} }) => (
  <button onClick={onClick} style={{ padding: size === "sm" ? "5px 12px" : "9px 18px", background: color, color: "#fff", border: "none", borderRadius: 7, fontSize: size === "sm" ? 12 : 13, fontWeight: 600, cursor: "pointer", ...style }}>{children}</button>
);
const Input = ({ label, value, onChange, type = "text", options, style = {}, placeholder = "" }) => (
  <div style={{ marginBottom: 14, ...style }}>
    {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>{label}</label>}
    {options ? (
      <select value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 7, fontSize: 13, background: "#fff" }}>
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : (
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 7, fontSize: 13, boxSizing: "border-box" }} />
    )}
  </div>
);

// ─── MODAL ────────────────────────────────────────────────────
function Modal({ title, onClose, children, width = 540 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: width, maxHeight: "90vh", overflow: "auto", boxShadow: "0 25px 50px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <h3 style={{ margin: 0, fontSize: 16, color: "#1e3a8a" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────
function Dashboard({ students, staff, fees, grades, attendance, currentUser, school }) {
  const activeStudents = students.filter(s => s.status === "active").length;
  const totalFees = fees.reduce((s, f) => s + f.amount, 0);
  const collectedFees = fees.reduce((s, f) => s + f.paid, 0);
  const todayAtt = attendance.filter(a => a.date === today());
  const presentToday = todayAtt.filter(a => a.status === "present").length;

  const stats = [
    { label: "Active Students", value: activeStudents, icon: "👨‍🎓", color: "#1e3a8a" },
    { label: "Teaching Staff", value: staff.filter(u => ["teacher","hod","headmaster"].includes(u.role)).length, icon: "👩‍🏫", color: "#7c3aed" },
    { label: "Fees Collected", value: `GH₵ ${collectedFees.toLocaleString()}`, icon: "💰", color: "#10b981" },
    { label: "Present Today", value: presentToday, icon: "✅", color: "#0ea5e9" },
  ];

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", color: "#1e3a8a" }}>Dashboard</h2>
      <p style={{ color: "#6b7280", margin: "0 0 20px", fontSize: 13 }}>Welcome, {currentUser.name} · {fmtDate(today())}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, marginBottom: 24 }}>
        {stats.map(s => (
          <Card key={s.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
              </div>
              <div style={{ fontSize: 28 }}>{s.icon}</div>
            </div>
          </Card>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <h4 style={{ margin: "0 0 12px", color: "#374151" }}>Fee Collection Summary</h4>
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Total Expected: <strong>GH₵ {totalFees.toLocaleString()}</strong></div>
          <div style={{ background: "#f1f5f9", borderRadius: 8, height: 12, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (collectedFees / totalFees) * 100)}%`, background: "linear-gradient(90deg,#1e3a8a,#7c3aed)", borderRadius: 8, transition: "width .5s" }} />
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{Math.round((collectedFees / totalFees) * 100) || 0}% collected</div>
        </Card>
        <Card>
          <h4 style={{ margin: "0 0 12px", color: "#374151" }}>Class Breakdown</h4>
          {CLASSES.slice(6, 10).map(cls => {
            const count = students.filter(s => s.class === cls && s.status === "active").length;
            return <div key={cls} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0", borderBottom: "1px solid #f3f4f6" }}><span>{cls}</span><span style={{ fontWeight: 600, color: "#1e3a8a" }}>{count}</span></div>;
          })}
        </Card>
      </div>
    </div>
  );
}

// ─── STUDENTS ─────────────────────────────────────────────────
function Students({ students, setStudents, currentUser }) {
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [filterClass, setFilterClass] = useState("");

  const visible = students.filter(s => s.status === "active").filter(s =>
    (!filterClass || s.class === filterClass) &&
    (!search || s.name.toLowerCase().includes(search.toLowerCase()) || s.studentId.includes(search))
  );

  const save = () => {
    if (modal === "add") {
      setStudents(prev => [...prev, { ...form, id: "STU-" + uid(), studentId: "ESB-" + Date.now().toString().slice(-6), status: "active", admissionDate: form.admissionDate || today() }]);
    } else {
      setStudents(prev => prev.map(s => s.id === form.id ? form : s));
    }
    setModal(null);
  };

  const openAdd = () => { setForm({ name: "", dob: "", gender: "", class: "", parentName: "", parentPhone: "", address: "" }); setModal("add"); };
  const openEdit = s => { setForm({ ...s }); setModal("edit"); };

  const canEdit = canAccess(currentUser.role, "students");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: "#1e3a8a" }}>Students</h2>
        {canEdit && <Btn onClick={openAdd}>+ Add Student</Btn>}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or ID…" style={{ flex: 1, padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }} />
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
          <option value="">All Classes</option>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Student ID","Name","Class","Gender","Parent","Parent Phone","Actions"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
          <tbody>
            {visible.map(s => (
              <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 14px", fontSize: 13, color: "#1e3a8a", fontWeight: 600 }}>{s.studentId}</td>
                <td style={{ padding: "10px 14px", fontSize: 13 }}>{s.name}</td>
                <td style={{ padding: "10px 14px", fontSize: 13 }}><Badge label={s.class} color="#1e3a8a" /></td>
                <td style={{ padding: "10px 14px", fontSize: 13 }}>{s.gender}</td>
                <td style={{ padding: "10px 14px", fontSize: 13 }}>{s.parentName}</td>
                <td style={{ padding: "10px 14px", fontSize: 13 }}>{s.parentPhone}</td>
                <td style={{ padding: "10px 14px" }}>
                  {canEdit && <Btn onClick={() => openEdit(s)} size="sm" color="#7c3aed" style={{ marginRight: 4 }}>Edit</Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No students found.</div>}
      </Card>
      {modal && (
        <Modal title={modal === "add" ? "Add Student" : "Edit Student"} onClose={() => setModal(null)}>
          {["name","dob","parentName","parentPhone","address"].map(f => (
            <Input key={f} label={f.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())} value={form[f] || ""} onChange={v => setForm(p => ({ ...p, [f]: v }))} type={f === "dob" ? "date" : "text"} />
          ))}
          <Input label="Gender" value={form.gender || ""} onChange={v => setForm(p => ({ ...p, gender: v }))} options={["Male","Female"]} />
          <Input label="Class" value={form.class || ""} onChange={v => setForm(p => ({ ...p, class: v }))} options={CLASSES} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn onClick={() => setModal(null)} color="#6b7280">Cancel</Btn>
            <Btn onClick={save}>Save</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── STAFF ────────────────────────────────────────────────────
function Staff({ users, setUsers, currentUser }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [filterRole, setFilterRole] = useState("");

  const visible = users.filter(u => !filterRole || u.role === filterRole);

  const save = () => {
    if (modal === "add") {
      const newUser = { ...form, id: "USR-" + uid(), code: (form.role || "STF").slice(0, 3).toUpperCase() + uid().slice(0, 3), active: true };
      setUsers(prev => [...prev, newUser]);
    } else {
      setUsers(prev => prev.map(u => u.id === form.id ? form : u));
    }
    setModal(null);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: "#1e3a8a" }}>Staff Management</h2>
        <Btn onClick={() => { setForm({ name: "", role: "", dept: "", subject: "", assignedClass: "", username: "", pin: "", email: "", phone: "" }); setModal("add"); }}>+ Add Staff</Btn>
      </div>
      <div style={{ marginBottom: 14 }}>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
          <option value="">All Roles</option>
          {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Code","Name","Role","Department","Class","Username","Status","Actions"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
          <tbody>
            {visible.map(u => (
              <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>{u.code}</td>
                <td style={{ padding: "10px 14px", fontSize: 13 }}>{u.name}</td>
                <td style={{ padding: "10px 14px" }}><Badge label={ROLES[u.role]?.label || u.role} color={ROLES[u.role]?.color || "#64748b"} /></td>
                <td style={{ padding: "10px 14px", fontSize: 12 }}>{u.dept}</td>
                <td style={{ padding: "10px 14px", fontSize: 12 }}>{u.assignedClass || "—"}</td>
                <td style={{ padding: "10px 14px", fontSize: 12 }}>{u.username}</td>
                <td style={{ padding: "10px 14px" }}><Badge label={u.active ? "Active" : "Inactive"} color={u.active ? "#10b981" : "#dc2626"} /></td>
                <td style={{ padding: "10px 14px" }}>
                  <Btn onClick={() => { setForm({ ...u }); setModal("edit"); }} size="sm" color="#7c3aed" style={{ marginRight: 4 }}>Edit</Btn>
                  <Btn onClick={() => setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: !x.active } : x))} size="sm" color={u.active ? "#dc2626" : "#10b981"}>{u.active ? "Disable" : "Enable"}</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {modal && (
        <Modal title={modal === "add" ? "Add Staff" : "Edit Staff"} onClose={() => setModal(null)}>
          <Input label="Full Name" value={form.name || ""} onChange={v => setForm(p => ({ ...p, name: v }))} />
          <Input label="Role" value={form.role || ""} onChange={v => setForm(p => ({ ...p, role: v }))} options={Object.keys(ROLES)} />
          <Input label="Department" value={form.dept || ""} onChange={v => setForm(p => ({ ...p, dept: v }))} options={DEPARTMENTS} />
          <Input label="Subject" value={form.subject || ""} onChange={v => setForm(p => ({ ...p, subject: v }))} options={["", ...SUBJECTS]} />
          <Input label="Assigned Class" value={form.assignedClass || ""} onChange={v => setForm(p => ({ ...p, assignedClass: v }))} options={["", ...CLASSES]} />
          <Input label="Username" value={form.username || ""} onChange={v => setForm(p => ({ ...p, username: v }))} />
          <Input label="PIN" value={form.pin || ""} onChange={v => setForm(p => ({ ...p, pin: v }))} type="password" />
          <Input label="Phone" value={form.phone || ""} onChange={v => setForm(p => ({ ...p, phone: v }))} />
          <Input label="Email" value={form.email || ""} onChange={v => setForm(p => ({ ...p, email: v }))} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} color="#6b7280">Cancel</Btn>
            <Btn onClick={save}>Save</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── ATTENDANCE ───────────────────────────────────────────────
function Attendance({ attendance, setAttendance, students, currentUser }) {
  const targetClass = ["admin","headmaster","hod"].includes(currentUser.role) ? null : currentUser.assignedClass;
  const [selClass, setSelClass] = useState(targetClass || CLASSES[0]);
  const [selDate, setSelDate] = useState(today());
  const [saved, setSaved] = useState(false);

  const classStudents = students.filter(s => s.class === selClass && s.status === "active");
  const existing = attendance.filter(a => a.class === selClass && a.date === selDate);
  const [attMap, setAttMap] = useState({});

  useEffect(() => {
    const map = {};
    classStudents.forEach(s => { map[s.id] = "present"; });
    existing.forEach(a => { map[a.studentId] = a.status; });
    setAttMap(map);
  }, [selClass, selDate, students]);

  const saveAtt = () => {
    const newEntries = classStudents.map(s => ({
      id: "ATT-" + uid(), studentId: s.id, studentName: s.name, class: selClass, date: selDate, status: attMap[s.id] || "present", enteredBy: currentUser.code
    }));
    setAttendance(prev => [...prev.filter(a => !(a.class === selClass && a.date === selDate)), ...newEntries]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", color: "#1e3a8a" }}>Attendance</h2>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {!targetClass && (
          <select value={selClass} onChange={e => setSelClass(e.target.value)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
            {CLASSES.map(c => <option key={c}>{c}</option>)}
          </select>
        )}
        {targetClass && <Badge label={`Class: ${targetClass}`} color="#1e3a8a" />}
        <input type="date" value={selDate} onChange={e => setSelDate(e.target.value)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }} />
        <Btn onClick={saveAtt} color={saved ? "#10b981" : "#1e3a8a"}>{saved ? "✓ Saved!" : "Save Attendance"}</Btn>
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Student","Status","Mark"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
          <tbody>
            {classStudents.map(s => (
              <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 14px", fontSize: 13 }}>{s.name}</td>
                <td style={{ padding: "10px 14px" }}><Badge label={attMap[s.id] || "present"} color={attMap[s.id] === "absent" ? "#dc2626" : attMap[s.id] === "late" ? "#f59e0b" : "#10b981"} /></td>
                <td style={{ padding: "10px 14px", display: "flex", gap: 6 }}>
                  {["present","absent","late"].map(st => (
                    <button key={st} onClick={() => setAttMap(p => ({ ...p, [s.id]: st }))}
                      style={{ padding: "4px 10px", borderRadius: 6, border: "1.5px solid", fontSize: 12, cursor: "pointer", fontWeight: 600, background: attMap[s.id] === st ? (st === "present" ? "#10b981" : st === "absent" ? "#dc2626" : "#f59e0b") : "#fff", color: attMap[s.id] === st ? "#fff" : "#374151", borderColor: st === "present" ? "#10b981" : st === "absent" ? "#dc2626" : "#f59e0b" }}>{st}</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {classStudents.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No students in this class.</div>}
      </Card>
    </div>
  );
}

// ─── GRADES & REPORTS ─────────────────────────────────────────
function Grades({ grades, setGrades, students, currentUser, school }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [filterClass, setFilterClass] = useState("");
  const [filterTerm, setFilterTerm] = useState("Term 1 2024");
  const [reportStudent, setReportStudent] = useState(null);
  const TERMS = ["Term 1 2024","Term 2 2024","Term 3 2024","Term 1 2025"];

  const targetClass = ["admin","headmaster","hod"].includes(currentUser.role) ? null : currentUser.assignedClass;
  const visibleClass = targetClass || filterClass;

  const visible = grades.filter(g => (!visibleClass || g.class === visibleClass) && g.term === filterTerm);

  const save = () => {
    const total = (parseInt(form.classScore) || 0) + (parseInt(form.examScore) || 0);
    const grade = gradeFromTotal(total);
    const entry = { ...form, total, grade, remark: remarkFromGrade(grade), enteredBy: currentUser.code, date: today() };
    if (modal === "add") setGrades(prev => [...prev, { ...entry, id: "GRD-" + uid() }]);
    else setGrades(prev => prev.map(g => g.id === form.id ? entry : g));
    setModal(null);
  };

  const classStudents = students.filter(s => s.class === visibleClass && s.status === "active");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: "#1e3a8a" }}>Grades & Report Cards</h2>
        <Btn onClick={() => { setForm({ studentName: "", studentId: "", class: visibleClass || "", subject: "", term: filterTerm, classScore: "", examScore: "" }); setModal("add"); }}>+ Add Grade</Btn>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {!targetClass && <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
          <option value="">All Classes</option>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>}
        <select value={filterTerm} onChange={e => setFilterTerm(e.target.value)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
          {TERMS.map(t => <option key={t}>{t}</option>)}
        </select>
        {classStudents.length > 0 && (
          <select onChange={e => setReportStudent(classStudents.find(s => s.id === e.target.value) || null)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
            <option value="">Print Report Card…</option>
            {classStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {reportStudent && <Btn onClick={() => { printReportCard(reportStudent, grades, school, filterTerm, []); setReportStudent(null); }} color="#10b981">🖨 Print</Btn>}
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Student","Class","Subject","Term","Class Score","Exam Score","Total","Grade","By","Actions"].map(h => <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
          <tbody>
            {visible.map(g => (
              <tr key={g.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "9px 12px", fontSize: 13 }}>{g.studentName}</td>
                <td style={{ padding: "9px 12px", fontSize: 12 }}>{g.class}</td>
                <td style={{ padding: "9px 12px", fontSize: 12 }}>{g.subject}</td>
                <td style={{ padding: "9px 12px", fontSize: 11, color: "#6b7280" }}>{g.term}</td>
                <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center" }}>{g.classScore}</td>
                <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center" }}>{g.examScore}</td>
                <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center", fontWeight: 700 }}>{g.total}</td>
                <td style={{ padding: "9px 12px" }}><Badge label={g.grade} color={g.grade === "A1" ? "#10b981" : g.grade.startsWith("B") ? "#1e3a8a" : g.grade.startsWith("F") ? "#dc2626" : "#f59e0b"} /></td>
                <td style={{ padding: "9px 12px", fontSize: 11, color: "#7c3aed" }}>{g.enteredBy}</td>
                <td style={{ padding: "9px 12px" }}><Btn onClick={() => { setForm({ ...g }); setModal("edit"); }} size="sm" color="#7c3aed">Edit</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No grades recorded.</div>}
      </Card>
      {modal && (
        <Modal title={modal === "add" ? "Add Grade" : "Edit Grade"} onClose={() => setModal(null)}>
          <Input label="Student" value={form.studentName || ""} onChange={v => {
            const st = students.find(s => s.name === v);
            setForm(p => ({ ...p, studentName: v, studentId: st?.id || "", class: st?.class || p.class }));
          }} options={students.filter(s => s.status === "active").map(s => s.name)} />
          <Input label="Subject" value={form.subject || ""} onChange={v => setForm(p => ({ ...p, subject: v }))} options={SUBJECTS} />
          <Input label="Term" value={form.term || ""} onChange={v => setForm(p => ({ ...p, term: v }))} options={["Term 1 2024","Term 2 2024","Term 3 2024","Term 1 2025"]} />
          <Input label="Class Score (max 40)" value={form.classScore || ""} onChange={v => setForm(p => ({ ...p, classScore: v }))} type="number" />
          <Input label="Exam Score (max 60)" value={form.examScore || ""} onChange={v => setForm(p => ({ ...p, examScore: v }))} type="number" />
          <div style={{ background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 14 }}>
            Total: <strong>{(parseInt(form.classScore) || 0) + (parseInt(form.examScore) || 0)}</strong> — Grade: <strong>{gradeFromTotal((parseInt(form.classScore) || 0) + (parseInt(form.examScore) || 0))}</strong>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} color="#6b7280">Cancel</Btn>
            <Btn onClick={save}>Save</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── TIMETABLE ────────────────────────────────────────────────
function Timetable({ currentUser }) {
  const targetClass = ["admin","headmaster","hod"].includes(currentUser.role) ? null : currentUser.assignedClass;
  const [selClass, setSelClass] = useState(targetClass || "Primary 6");
  const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
  const tt = SEED_TIMETABLE[selClass] || {};

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: "#1e3a8a" }}>Class Timetable</h2>
        {!targetClass && <select value={selClass} onChange={e => setSelClass(e.target.value)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>}
        {targetClass && <Badge label={`Your Class: ${targetClass}`} color="#7c3aed" />}
      </div>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
          <thead><tr style={{ background: "#1e3a8a" }}>
            <th style={{ padding: "10px 14px", color: "#fff", textAlign: "left", fontSize: 12, fontWeight: 700 }}>Time</th>
            {DAYS.map(d => <th key={d} style={{ padding: "10px 14px", color: "#fff", textAlign: "center", fontSize: 12, fontWeight: 700 }}>{d}</th>)}
          </tr></thead>
          <tbody>
            {Object.keys(tt[DAYS[0]] || {}).map((time, i) => (
              <tr key={time} style={{ background: i % 2 === 0 ? "#f8fafc" : "#fff", borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "9px 14px", fontSize: 12, fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>{time}</td>
                {DAYS.map(d => {
                  const sub = tt[d]?.[time] || "—";
                  const isBreak = sub.includes("Break") || sub.includes("Lunch");
                  return <td key={d} style={{ padding: "9px 14px", fontSize: 12, textAlign: "center", color: isBreak ? "#94a3b8" : "#1e3a8a", fontWeight: isBreak ? 400 : 600, background: isBreak ? "#f1f5f9" : "transparent" }}>{sub}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(tt).length === 0 && <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>No timetable set for this class yet.</div>}
      </Card>
    </div>
  );
}

// ─── FEES & FINANCE ───────────────────────────────────────────
function Fees({ fees, setFees, students, currentUser, school }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [filterTerm, setFilterTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [tab, setTab] = useState("records");
  const [reportPeriod, setReportPeriod] = useState("monthly");
  const TERMS = ["Term 1 2024","Term 2 2024","Term 3 2024","Term 1 2025"];

  const visible = fees.filter(f =>
    (!filterTerm || f.term === filterTerm) &&
    (!filterStatus || f.status === filterStatus)
  );

  const totalExpected = visible.reduce((s, f) => s + f.amount, 0);
  const totalPaid = visible.reduce((s, f) => s + f.paid, 0);
  const totalBalance = visible.reduce((s, f) => s + f.balance, 0);

  const save = () => {
    const paid = parseFloat(form.paid) || 0;
    const amount = parseFloat(form.amount) || 0;
    const balance = amount - paid;
    const status = balance <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
    const receiptNo = "RCP-" + uid();
    const entry = { ...form, paid, amount, balance, status, receiptNo, enteredBy: currentUser.code, date: today() };
    if (modal === "add") setFees(prev => [...prev, { ...entry, id: "FEE-" + uid() }]);
    else setFees(prev => prev.map(f => f.id === form.id ? entry : f));
    setModal(null);
  };

  // Financial report groupings
  const feesByType = FEE_TYPES.map(t => ({
    type: t,
    total: fees.filter(f => f.type === t).reduce((s, f) => s + f.paid, 0),
  })).filter(x => x.total > 0);

  const feesByTerm = TERMS.map(t => ({
    term: t,
    expected: fees.filter(f => f.term === t).reduce((s, f) => s + f.amount, 0),
    collected: fees.filter(f => f.term === t).reduce((s, f) => s + f.paid, 0),
  }));

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", color: "#1e3a8a" }}>Fees & Finance</h2>
      <div style={{ display: "flex", gap: 0, marginBottom: 20, border: "1.5px solid #e5e7eb", borderRadius: 8, overflow: "hidden", width: "fit-content" }}>
        {["records","report"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 20px", background: tab === t ? "#1e3a8a" : "#fff", color: tab === t ? "#fff" : "#374151", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            {t === "records" ? "Fee Records" : "Financial Reports"}
          </button>
        ))}
      </div>

      {tab === "records" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[["Expected", totalExpected, "#1e3a8a"],["Collected", totalPaid, "#10b981"],["Outstanding", totalBalance, "#dc2626"]].map(([l, v, c]) => (
              <Card key={l} style={{ padding: 14 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: c }}>GH₵ {v.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{l}</div>
              </Card>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <select value={filterTerm} onChange={e => setFilterTerm(e.target.value)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
              <option value="">All Terms</option>
              {TERMS.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13 }}>
              <option value="">All Status</option>
              {["paid","partial","unpaid"].map(s => <option key={s}>{s}</option>)}
            </select>
            <Btn onClick={() => { setForm({ studentName: "", studentId: "", class: "", type: "School Fees", amount: "", paid: "", term: "Term 1 2024" }); setModal("add"); }}>+ Record Payment</Btn>
          </div>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f8fafc" }}>{["Receipt","Student","Class","Type","Term","Amount","Paid","Balance","Status","By","Actions"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
              <tbody>
                {visible.map(f => (
                  <tr key={f.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>{f.receiptNo || "—"}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13 }}>{f.studentName}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12 }}>{f.class}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12 }}>{f.type}</td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#6b7280" }}>{f.term}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13 }}>GH₵{f.amount}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: "#10b981", fontWeight: 600 }}>GH₵{f.paid}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: f.balance > 0 ? "#dc2626" : "#10b981", fontWeight: 600 }}>GH₵{f.balance}</td>
                    <td style={{ padding: "8px 10px" }}><Badge label={f.status} color={f.status === "paid" ? "#10b981" : f.status === "partial" ? "#f59e0b" : "#dc2626"} /></td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#7c3aed" }}>{f.enteredBy}</td>
                    <td style={{ padding: "8px 10px", display: "flex", gap: 4 }}>
                      <Btn onClick={() => printReceipt(f, school, [])} size="sm" color="#1e3a8a">🖨</Btn>
                      <Btn onClick={() => { setForm({ ...f }); setModal("edit"); }} size="sm" color="#7c3aed">Edit</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No records found.</div>}
          </Card>
        </>
      )}

      {tab === "report" && (
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <h4 style={{ margin: "0 0 14px", color: "#374151" }}>Term-by-Term Summary</h4>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f8fafc" }}>{["Term","Expected (GH₵)","Collected (GH₵)","Outstanding (GH₵)","Collection Rate"].map(h => <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
              <tbody>
                {feesByTerm.map(r => (
                  <tr key={r.term} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{r.term}</td>
                    <td style={{ padding: "9px 12px", fontSize: 13 }}>{r.expected.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px", fontSize: 13, color: "#10b981", fontWeight: 600 }}>{r.collected.toLocaleString()}</td>
                    <td style={{ padding: "9px 12px", fontSize: 13, color: "#dc2626" }}>{(r.expected - r.collected).toLocaleString()}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${r.expected ? Math.round((r.collected / r.expected) * 100) : 0}%`, height: "100%", background: "#10b981", borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{r.expected ? Math.round((r.collected / r.expected) * 100) : 0}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <h4 style={{ margin: "0 0 14px", color: "#374151" }}>Revenue by Fee Type</h4>
            {feesByType.map(f => (
              <div key={f.type} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f3f4f6" }}>
                <span style={{ fontSize: 13 }}>{f.type}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#1e3a8a" }}>GH₵ {f.total.toLocaleString()}</span>
              </div>
            ))}
          </Card>
          <Card>
            <h4 style={{ margin: "0 0 14px", color: "#374151" }}>Overall Summary</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                ["Total Billed", fees.reduce((s, f) => s + f.amount, 0), "#1e3a8a"],
                ["Total Collected", fees.reduce((s, f) => s + f.paid, 0), "#10b981"],
                ["Total Outstanding", fees.reduce((s, f) => s + f.balance, 0), "#dc2626"],
              ].map(([l, v, c]) => (
                <div key={l} style={{ background: "#f8fafc", borderRadius: 8, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: c }}>GH₵ {v.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {modal && (
        <Modal title={modal === "add" ? "Record Payment" : "Edit Payment"} onClose={() => setModal(null)}>
          <Input label="Student Name" value={form.studentName || ""} onChange={v => {
            const st = students.find(s => s.name === v);
            setForm(p => ({ ...p, studentName: v, studentId: st?.id || "", class: st?.class || "" }));
          }} options={students.filter(s => s.status === "active").map(s => s.name)} />
          <Input label="Fee Type" value={form.type || ""} onChange={v => setForm(p => ({ ...p, type: v }))} options={FEE_TYPES} />
          <Input label="Term" value={form.term || ""} onChange={v => setForm(p => ({ ...p, term: v }))} options={TERMS} />
          <Input label="Amount Due (GH₵)" value={form.amount || ""} onChange={v => setForm(p => ({ ...p, amount: v }))} type="number" />
          <Input label="Amount Paid (GH₵)" value={form.paid || ""} onChange={v => setForm(p => ({ ...p, paid: v }))} type="number" />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} color="#6b7280">Cancel</Btn>
            <Btn onClick={save}>Save & Generate Receipt</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── LIBRARY ──────────────────────────────────────────────────
function Library({ books, setBooks, loans, setLoans, currentUser }) {
  const [tab, setTab] = useState("books");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});

  const saveBook = () => {
    if (modal === "add-book") setBooks(prev => [...prev, { ...form, id: "BK-" + uid(), available: parseInt(form.copies) || 0, addedBy: currentUser.code, date: today() }]);
    setModal(null);
  };

  const saveLoan = () => {
    const book = books.find(b => b.id === form.bookId);
    if (!book || book.available < 1) { alert("No copies available."); return; }
    setBooks(prev => prev.map(b => b.id === form.bookId ? { ...b, available: b.available - 1 } : b));
    const due = new Date(); due.setDate(due.getDate() + 14);
    setLoans(prev => [...prev, { ...form, id: "BL-" + uid(), bookTitle: book.title, loanDate: today(), dueDate: due.toISOString().slice(0, 10), returnDate: "", status: "active", issuedBy: currentUser.code }]);
    setModal(null);
  };

  const returnBook = loan => {
    setBooks(prev => prev.map(b => b.id === loan.bookId ? { ...b, available: b.available + 1 } : b));
    setLoans(prev => prev.map(l => l.id === loan.id ? { ...l, returnDate: today(), status: "returned" } : l));
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", color: "#1e3a8a" }}>Library Management</h2>
      <div style={{ display: "flex", gap: 0, marginBottom: 20, border: "1.5px solid #e5e7eb", borderRadius: 8, overflow: "hidden", width: "fit-content" }}>
        {["books","loans"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 20px", background: tab === t ? "#1e3a8a" : "#fff", color: tab === t ? "#fff" : "#374151", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            {t === "books" ? "📚 Book Catalogue" : "🔄 Loans"}
          </button>
        ))}
      </div>

      {tab === "books" && (
        <>
          <Btn onClick={() => { setForm({ title: "", author: "", isbn: "", category: "", class: "", copies: "" }); setModal("add-book"); }} style={{ marginBottom: 14 }}>+ Add Book</Btn>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f8fafc" }}>{["Title","Author","ISBN","Category","Class","Copies","Available","Added By"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
              <tbody>
                {books.map(b => (
                  <tr key={b.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{b.title}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{b.author}</td>
                    <td style={{ padding: "9px 12px", fontSize: 11, color: "#6b7280" }}>{b.isbn}</td>
                    <td style={{ padding: "9px 12px" }}><Badge label={b.category} color="#f59e0b" /></td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{b.class}</td>
                    <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center" }}>{b.copies}</td>
                    <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center", color: b.available < 1 ? "#dc2626" : "#10b981", fontWeight: 700 }}>{b.available}</td>
                    <td style={{ padding: "9px 12px", fontSize: 11, color: "#7c3aed" }}>{b.addedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === "loans" && (
        <>
          <Btn onClick={() => { setForm({ bookId: "", borrower: "", borrowerType: "student", borrowerId: "" }); setModal("add-loan"); }} style={{ marginBottom: 14 }}>+ Issue Book</Btn>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f8fafc" }}>{["Book","Borrower","Type","Loan Date","Due Date","Return Date","Status","Actions"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
              <tbody>
                {loans.map(l => (
                  <tr key={l.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{l.bookTitle}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{l.borrower}</td>
                    <td style={{ padding: "9px 12px" }}><Badge label={l.borrowerType} color="#0ea5e9" /></td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{fmtDate(l.loanDate)}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{fmtDate(l.dueDate)}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "#6b7280" }}>{l.returnDate ? fmtDate(l.returnDate) : "—"}</td>
                    <td style={{ padding: "9px 12px" }}><Badge label={l.status} color={l.status === "returned" ? "#10b981" : new Date(l.dueDate) < new Date() ? "#dc2626" : "#f59e0b"} /></td>
                    <td style={{ padding: "9px 12px" }}>
                      {l.status === "active" && <Btn onClick={() => returnBook(l)} size="sm" color="#10b981">Return</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {modal === "add-book" && (
        <Modal title="Add Book" onClose={() => setModal(null)}>
          {["title","author","isbn"].map(f => <Input key={f} label={f.replace(/^./, s => s.toUpperCase())} value={form[f] || ""} onChange={v => setForm(p => ({ ...p, [f]: v }))} />)}
          <Input label="Category" value={form.category || ""} onChange={v => setForm(p => ({ ...p, category: v }))} options={BOOK_CATEGORIES} />
          <Input label="Class" value={form.class || ""} onChange={v => setForm(p => ({ ...p, class: v }))} options={["General", ...CLASSES]} />
          <Input label="Number of Copies" value={form.copies || ""} onChange={v => setForm(p => ({ ...p, copies: v }))} type="number" />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} color="#6b7280">Cancel</Btn>
            <Btn onClick={saveBook}>Add Book</Btn>
          </div>
        </Modal>
      )}

      {modal === "add-loan" && (
        <Modal title="Issue Book" onClose={() => setModal(null)}>
          <Input label="Book" value={form.bookId || ""} onChange={v => setForm(p => ({ ...p, bookId: v }))} options={books.filter(b => b.available > 0).map(b => b.id)} />
          {form.bookId && <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>Selected: {books.find(b => b.id === form.bookId)?.title}</div>}
          <Input label="Borrower Name" value={form.borrower || ""} onChange={v => setForm(p => ({ ...p, borrower: v }))} />
          <Input label="Borrower Type" value={form.borrowerType || "student"} onChange={v => setForm(p => ({ ...p, borrowerType: v }))} options={["student","staff"]} />
          <Input label="Borrower ID" value={form.borrowerId || ""} onChange={v => setForm(p => ({ ...p, borrowerId: v }))} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} color="#6b7280">Cancel</Btn>
            <Btn onClick={saveLoan}>Issue Book</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── ALUMNI & ARCHIVES ────────────────────────────────────────
function Alumni({ oldStudents, setOldStudents, oldStaff, setOldStaff }) {
  const [tab, setTab] = useState("students");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", color: "#1e3a8a" }}>Alumni & Archives</h2>
      <div style={{ display: "flex", gap: 0, marginBottom: 20, border: "1.5px solid #e5e7eb", borderRadius: 8, overflow: "hidden", width: "fit-content" }}>
        {["students","staff"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 20px", background: tab === t ? "#1e3a8a" : "#fff", color: tab === t ? "#fff" : "#374151", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            {t === "students" ? "👨‍🎓 Old Students" : "👩‍🏫 Former Staff"}
          </button>
        ))}
      </div>
      {tab === "students" && (
        <>
          <Btn onClick={() => { setForm({ name: "", class: "JHS 3", graduationYear: "", achievements: "", currentStatus: "", notes: "" }); setModal("student"); }} style={{ marginBottom: 14 }}>+ Add Alumni Record</Btn>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f8fafc" }}>{["Name","Class","Grad Year","Achievements","Current Status","Notes"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
              <tbody>
                {oldStudents.map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.class}</td>
                    <td style={{ padding: "9px 12px" }}><Badge label={s.graduationYear} color="#10b981" /></td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.achievements}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.currentStatus}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "#6b7280" }}>{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {tab === "staff" && (
        <>
          <Btn onClick={() => { setForm({ name: "", role: "", dept: "", yearsServed: "", subject: "", reason: "", contactPhone: "", notes: "" }); setModal("staff"); }} style={{ marginBottom: 14 }}>+ Add Former Staff</Btn>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f8fafc" }}>{["Name","Role","Department","Years Served","Reason Left","Contact","Notes"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
              <tbody>
                {oldStaff.map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.role}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.dept}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.yearsServed}</td>
                    <td style={{ padding: "9px 12px" }}><Badge label={s.reason} color="#f59e0b" /></td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{s.contactPhone}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "#6b7280" }}>{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {modal === "student" && (
        <Modal title="Add Alumni Record" onClose={() => setModal(null)}>
          {["name","graduationYear","achievements","currentStatus","parentPhone","notes"].map(f => <Input key={f} label={f.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())} value={form[f] || ""} onChange={v => setForm(p => ({ ...p, [f]: v }))} />)}
          <Input label="Final Class" value={form.class || ""} onChange={v => setForm(p => ({ ...p, class: v }))} options={CLASSES} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} color="#6b7280">Cancel</Btn>
            <Btn onClick={() => { setOldStudents(p => [...p, { ...form, id: "OLD-" + uid() }]); setModal(null); }}>Save</Btn>
          </div>
        </Modal>
      )}
      {modal === "staff" && (
        <Modal title="Add Former Staff" onClose={() => setModal(null)}>
          {["name","yearsServed","subject","reason","contactPhone","notes"].map(f => <Input key={f} label={f.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())} value={form[f] || ""} onChange={v => setForm(p => ({ ...p, [f]: v }))} />)}
          <Input label="Role" value={form.role || ""} onChange={v => setForm(p => ({ ...p, role: v }))} options={Object.keys(ROLES)} />
          <Input label="Department" value={form.dept || ""} onChange={v => setForm(p => ({ ...p, dept: v }))} options={DEPARTMENTS} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(null)} color="#6b7280">Cancel</Btn>
            <Btn onClick={() => { setOldStaff(p => [...p, { ...form, id: "OLDS-" + uid() }]); setModal(null); }}>Save</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── EXPELLED / DROPOUT ───────────────────────────────────────
function Expelled({ expelled, setExpelled, currentUser }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", color: "#1e3a8a" }}>Expelled / Dropout Records</h2>
      <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 16px" }}>Confidential records of students who left under disciplinary or personal circumstances.</p>
      <Btn onClick={() => { setForm({ name: "", class: "", date: today(), reason: "", type: "expelled", parentNotified: false, notes: "" }); setModal(true); }} style={{ marginBottom: 14 }}>+ Add Record</Btn>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Name","Class","Date","Type","Reason","Parent Notified","Entered By","Notes"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontSize: 11, color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
          <tbody>
            {expelled.map(e => (
              <tr key={e.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{e.name}</td>
                <td style={{ padding: "9px 12px", fontSize: 12 }}>{e.class}</td>
                <td style={{ padding: "9px 12px", fontSize: 12 }}>{fmtDate(e.date)}</td>
                <td style={{ padding: "9px 12px" }}><Badge label={e.type} color={e.type === "expelled" ? "#dc2626" : "#f59e0b"} /></td>
                <td style={{ padding: "9px 12px", fontSize: 12 }}>{e.reason}</td>
                <td style={{ padding: "9px 12px" }}><Badge label={e.parentNotified ? "Yes" : "No"} color={e.parentNotified ? "#10b981" : "#dc2626"} /></td>
                <td style={{ padding: "9px 12px", fontSize: 11, color: "#7c3aed" }}>{e.enteredBy}</td>
                <td style={{ padding: "9px 12px", fontSize: 12, color: "#6b7280" }}>{e.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {expelled.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No records.</div>}
      </Card>
      {modal && (
        <Modal title="Add Expelled/Dropout Record" onClose={() => setModal(false)}>
          {["name","reason","notes"].map(f => <Input key={f} label={f.replace(/^./, s => s.toUpperCase())} value={form[f] || ""} onChange={v => setForm(p => ({ ...p, [f]: v }))} />)}
          <Input label="Class" value={form.class || ""} onChange={v => setForm(p => ({ ...p, class: v }))} options={CLASSES} />
          <Input label="Type" value={form.type || ""} onChange={v => setForm(p => ({ ...p, type: v }))} options={["expelled","dropout","transferred","deceased"]} />
          <Input label="Date" value={form.date || ""} onChange={v => setForm(p => ({ ...p, date: v }))} type="date" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <input type="checkbox" checked={!!form.parentNotified} onChange={e => setForm(p => ({ ...p, parentNotified: e.target.checked }))} id="pnot" />
            <label htmlFor="pnot" style={{ fontSize: 13, color: "#374151" }}>Parent/Guardian Notified</label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn onClick={() => setModal(false)} color="#6b7280">Cancel</Btn>
            <Btn onClick={() => { setExpelled(p => [...p, { ...form, id: "EXP-" + uid(), enteredBy: currentUser.code }]); setModal(false); }}>Save Record</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── ID CARDS ─────────────────────────────────────────────────
function IDCards({ students, users, school }) {
  const [tab, setTab] = useState("students");
  const [search, setSearch] = useState("");

  const filteredStudents = students.filter(s => s.status === "active" && (!search || s.name.toLowerCase().includes(search.toLowerCase()) || s.studentId?.includes(search)));
  const filteredStaff = users.filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.code?.includes(search));

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", color: "#1e3a8a" }}>ID Card Generator</h2>
      <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 16px" }}>Generate and print ID cards for students and all staff.</p>
      <div style={{ display: "flex", gap: 0, marginBottom: 16, border: "1.5px solid #e5e7eb", borderRadius: 8, overflow: "hidden", width: "fit-content" }}>
        {["students","staff"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 20px", background: tab === t ? "#1e3a8a" : "#fff", color: tab === t ? "#fff" : "#374151", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            {t === "students" ? "👨‍🎓 Students" : "👩‍🏫 Staff"}
          </button>
        ))}
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or ID…" style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, marginBottom: 14, boxSizing: "border-box" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
        {tab === "students" && filteredStudents.map(s => (
          <Card key={s.id} style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#1e3a8a", flexShrink: 0 }}>{s.name[0]}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{s.class}</div>
                <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>{s.studentId}</div>
              </div>
            </div>
            <Btn onClick={() => printIDCard(s, school, "student")} size="sm" color="#1e3a8a" style={{ marginTop: 10, width: "100%" }}>🖨 Print ID Card</Btn>
          </Card>
        ))}
        {tab === "staff" && filteredStaff.map(u => (
          <Card key={u.id} style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#7c3aed", flexShrink: 0 }}>{u.name[0]}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{u.name}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{ROLES[u.role]?.label}</div>
                <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>{u.code}</div>
              </div>
            </div>
            <Btn onClick={() => printIDCard(u, school, u.role === "teacher" ? "teacher" : "staff")} size="sm" color="#7c3aed" style={{ marginTop: 10, width: "100%" }}>🖨 Print ID Card</Btn>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────
function Settings({ school, setSchool, licence }) {
  const [form, setForm] = useState({ ...school });
  const [saved, setSaved] = useState(false);

  const save = () => {
    setSchool(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const daysLeft = Math.max(0, Math.ceil((new Date(licence.expiry) - new Date()) / 86400000));

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ margin: "0 0 4px", color: "#1e3a8a" }}>Settings</h2>
      <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 24px" }}>Customise school details. These appear on receipts, report cards, and official letters.</p>
      <Card style={{ marginBottom: 20 }}>
        <h4 style={{ margin: "0 0 16px", color: "#374151" }}>🏫 School Information</h4>
        {[["name","School Name"],["address","Address"],["phone","Phone"],["email","Email"],["motto","School Motto"],["principalName","Headmaster/Principal Name"],["established","Year Established"]].map(([f, l]) => (
          <Input key={f} label={l} value={form[f] || ""} onChange={v => setForm(p => ({ ...p, [f]: v }))} />
        ))}
        <Btn onClick={save} color={saved ? "#10b981" : "#1e3a8a"}>{saved ? "✓ Saved!" : "Save School Details"}</Btn>
      </Card>
      <Card>
        <h4 style={{ margin: "0 0 16px", color: "#374151" }}>🔑 Licence Information</h4>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}><span>Licence Type</span><Badge label={licence.type === "trial" ? "Free Trial" : "Licensed"} color={licence.type === "trial" ? "#f59e0b" : "#10b981"} /></div>
        {licence.tier && <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}><span>Tier</span><strong>{licence.tier}</strong></div>}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}><span>Expiry</span><strong>{fmtDate(licence.expiry)}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 13 }}><span>Days Remaining</span><Badge label={`${daysLeft} days`} color={daysLeft < 30 ? "#dc2626" : "#10b981"} /></div>
        {licence.type === "trial" && daysLeft < 30 && (
          <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: 12, marginTop: 12, fontSize: 12, color: "#92400e" }}>
            ⚠️ Your trial expires soon. To purchase a licence, contact: <strong>0597147460</strong>
          </div>
        )}
        <div style={{ marginTop: 14, padding: 14, background: "#f8fafc", borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Pricing</div>
          {Object.entries(LICENCE_TIERS).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid #f1f5f9" }}>
              <span>{v.label}</span><span style={{ fontWeight: 700, color: "#1e3a8a" }}>GH₵ {v.price.toLocaleString()}/yr</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────
// ─── BACKUP & RESTORE ────────────────────────────────────────────────────────

// ── INSTITUTION HELPERS (Update 5) ───────────────────────────────────────────
function loadInstitution(key) {
  try { return JSON.parse(localStorage.getItem(key + "_inst")) || { name: "", address: "" }; } catch { return { name: "", address: "" }; }
}
function saveInstitution(key, inst) {
  try { localStorage.setItem(key + "_inst", JSON.stringify(inst)); } catch {}
}


// ── LICENCE EXPIRY BANNER (Update 8) ─────────────────────────────────────────
function ExpiryBanner({ expiry, phone }) {
  if (!expiry || expiry === "—") return null;
  const days = Math.ceil((new Date(expiry) - new Date()) / 86400000);
  if (days > 30) return null;
  const bg  = days <= 7 ? "#dc2626" : "#d97706";
  const msg = days <= 0
    ? `Licence has expired — contact ${phone||"0597147460"} to renew`
    : days <= 7
      ? `⚠ Licence expires in ${days} day${days!==1?"s":""} — renew immediately`
      : `Licence expires in ${days} day${days!==1?"s":""} — contact ${phone||"0597147460"} to renew`;
  return (
    <div style={{ background: bg, color: "#fff", textAlign: "center", padding: "7px 16px", fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>
      {msg}
    </div>
  );
}


// ── RESET MODAL (Update 1) ───────────────────────────────────────────────────
function ResetModal({ onConfirm, onCancel, adminPin, accent, cardBg }) {
  const [pin,  setPin]  = useState("");
  const [err,  setErr]  = useState("");
  const [step, setStep] = useState(1);
  const check = () => {
    if (!adminPin) { setErr("No admin PIN set yet. Complete the setup wizard first."); return; }
    if (pin !== String(adminPin)) { setErr("Incorrect PIN. Try again."); setPin(""); return; }
    setStep(2);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, padding:20 }}>
      <div style={{ background: cardBg||"#1f2330", border:"1px solid #ef444455", borderRadius:14, padding:28, width:"min(94vw,400px)" }}>
        {step === 1 ? (<>
          <div style={{ fontSize:18, fontWeight:800, color:"#ef4444", marginBottom:8 }}>🔐 Admin PIN Required</div>
          <p style={{ fontSize:13, color:"#94a3b8", marginBottom:16 }}>Enter your admin PIN to access the reset function.</p>
          <input type="password" inputMode="numeric" maxLength={6} value={pin}
            onChange={e=>{setPin(e.target.value.replace(/\D/g,""));setErr("");}}
            onKeyDown={e=>e.key==="Enter"&&check()} placeholder="••••" autoFocus
            style={{ width:"100%", padding:12, background:"rgba(255,255,255,0.06)", border:`1.5px solid ${err?"#ef4444":"rgba(255,255,255,0.15)"}`, borderRadius:8, color:"#fff", fontSize:20, textAlign:"center", letterSpacing:6, outline:"none", boxSizing:"border-box", marginBottom:8, fontFamily:"inherit" }} />
          {err && <div style={{ color:"#fca5a5", fontSize:12, marginBottom:8 }}>{err}</div>}
          <div style={{ display:"flex", gap:10, marginTop:8 }}>
            <button onClick={onCancel} style={{ flex:1, padding:"10px 0", background:"transparent", border:"1px solid rgba(255,255,255,0.15)", borderRadius:8, color:"#94a3b8", fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
            <button onClick={check}    style={{ flex:1, padding:"10px 0", background:accent||"#2E86AB", color:"#fff", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Verify PIN</button>
          </div>
        </>) : (<>
          <div style={{ fontSize:18, fontWeight:800, color:"#ef4444", marginBottom:8 }}>⚠️ Confirm Full Reset</div>
          <p style={{ fontSize:13, color:"#94a3b8", marginBottom:6, lineHeight:1.7 }}>This will <strong style={{ color:"#ef4444" }}>permanently delete ALL data</strong> in this app — records, settings, everything.</p>
          <p style={{ fontSize:13, color:"#ef4444", fontWeight:700, marginBottom:20 }}>This cannot be undone.</p>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={onCancel}  style={{ flex:1, padding:"10px 0", background:"transparent", border:"1px solid rgba(255,255,255,0.15)", borderRadius:8, color:"#94a3b8", fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
            <button onClick={onConfirm} style={{ flex:1, padding:"10px 0", background:"#dc2626", color:"#fff", border:"none", borderRadius:8, fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>Delete All Data</button>
          </div>
        </>)}
      </div>
    </div>
  );
}


// ── FIRST-TIME SETUP WIZARD (Update 4) ───────────────────────────────────────
function SetupWizard({ onComplete, instLabel, accentColor, bgGrad }) {
  const [step,     setStep]     = useState(1);
  const [instName, setInstName] = useState("");
  const [instAddr, setInstAddr] = useState("");
  const [username, setUsername] = useState("");
  const [pin,      setPin]      = useState("");
  const [pin2,     setPin2]     = useState("");
  const [err,      setErr]      = useState("");

  const nextStep = () => {
    if (!instName.trim()) { setErr((instLabel||"Institution") + " name is required."); return; }
    setErr(""); setStep(2);
  };
  const finish = () => {
    if (!username.trim())  { setErr("Admin username is required."); return; }
    if (pin.length < 4)    { setErr("PIN must be at least 4 digits."); return; }
    if (pin !== pin2)      { setErr("PINs do not match."); return; }
    onComplete({ instName: instName.trim(), instAddr: instAddr.trim(), username: username.trim(), pin });
  };

  const inp = { width:"100%", padding:"11px 13px", background:"rgba(255,255,255,0.08)", border:"1.5px solid rgba(255,255,255,0.2)", borderRadius:8, color:"#fff", fontSize:14, outline:"none", boxSizing:"border-box", fontFamily:"inherit" };

  return (
    <div style={{ minHeight:"100vh", background: bgGrad||"#0a1628", display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:"'Inter','Segoe UI',sans-serif" }}>
      <div style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:18, padding:"36px 32px", width:"min(94vw,460px)", boxShadow:"0 24px 80px rgba(0,0,0,0.5)" }}>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ fontSize:40, marginBottom:10 }}>⚙️</div>
          <div style={{ fontSize:22, fontWeight:900, color: accentColor||"#c9a84c", marginBottom:4 }}>First-Time Setup</div>
          <div style={{ color:"rgba(255,255,255,0.55)", fontSize:13 }}>Step {step} of 2 — {step===1?"Institution Details":"Admin Account"}</div>
        </div>
        <div style={{ display:"flex", gap:6, marginBottom:24 }}>
          {[1,2].map(s=>(
            <div key={s} style={{ flex:1, height:4, borderRadius:2, background: s<=step ? (accentColor||"#c9a84c") : "rgba(255,255,255,0.15)" }} />
          ))}
        </div>
        {step === 1 && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div>
              <label style={{ fontSize:11, color:"rgba(255,255,255,0.6)", display:"block", marginBottom:5 }}>{instLabel||"Institution"} Name *</label>
              <input value={instName} onChange={e=>{setInstName(e.target.value);setErr("");}} placeholder={`e.g. My ${instLabel||"Business"}`} style={inp} />
            </div>
            <div>
              <label style={{ fontSize:11, color:"rgba(255,255,255,0.6)", display:"block", marginBottom:5 }}>Address</label>
              <input value={instAddr} onChange={e=>setInstAddr(e.target.value)} placeholder="e.g. Kumasi, Ashanti Region" style={inp} />
            </div>
            {err && <div style={{ color:"#fca5a5", fontSize:12 }}>{err}</div>}
            <button onClick={nextStep} style={{ width:"100%", padding:"13px 0", background: accentColor||"#c9a84c", color:"#000", border:"none", borderRadius:10, fontWeight:800, fontSize:15, cursor:"pointer", fontFamily:"inherit", marginTop:4 }}>Next →</button>
          </div>
        )}
        {step === 2 && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div>
              <label style={{ fontSize:11, color:"rgba(255,255,255,0.6)", display:"block", marginBottom:5 }}>Admin Username *</label>
              <input value={username} onChange={e=>{setUsername(e.target.value);setErr("");}} placeholder="e.g. admin" style={inp} />
            </div>
            <div>
              <label style={{ fontSize:11, color:"rgba(255,255,255,0.6)", display:"block", marginBottom:5 }}>Admin PIN * (4–6 digits)</label>
              <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e=>{setPin(e.target.value.replace(/\D/g,""));setErr("");}} placeholder="••••" style={{...inp, letterSpacing:4, textAlign:"center"}} />
            </div>
            <div>
              <label style={{ fontSize:11, color:"rgba(255,255,255,0.6)", display:"block", marginBottom:5 }}>Confirm PIN *</label>
              <input type="password" inputMode="numeric" maxLength={6} value={pin2} onChange={e=>{setPin2(e.target.value.replace(/\D/g,""));setErr("");}} placeholder="••••" style={{...inp, letterSpacing:4, textAlign:"center"}} />
            </div>
            {err && <div style={{ color:"#fca5a5", fontSize:12 }}>{err}</div>}
            <div style={{ display:"flex", gap:10, marginTop:4 }}>
              <button onClick={()=>{setStep(1);setErr("");}} style={{ flex:1, padding:"12px 0", background:"transparent", border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, color:"rgba(255,255,255,0.7)", fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>← Back</button>
              <button onClick={finish} style={{ flex:2, padding:"12px 0", background: accentColor||"#c9a84c", color:"#000", border:"none", borderRadius:8, fontWeight:800, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Complete Setup ✓</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EduBackup({ data, onRestore }) {
  const [confirmRestore, setConfirmRestore] = useState(null);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const showMsg = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); };

  const download = () => {
    const blob = new Blob([JSON.stringify({ app: "EduSmart School Manager", exportedAt: new Date().toISOString(), version: 4, data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `EduSmart-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    showMsg("ok", `Backup downloaded — ${data.students?.length||0} students, ${(data.users||[]).filter(u=>u.role!=="admin").length} staff, ${data.fees?.length||0} fee records.`);
  };

  const onFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try {
      const p = JSON.parse(reader.result);
      if (!p.data) { showMsg("err", "Not a valid EduSmart backup file."); return; }
      setConfirmRestore(p);
    } catch { showMsg("err", "Could not read file."); } };
    reader.readAsText(file); e.target.value = "";
  };

  const exportCSV = () => {
    const rows = [["Student ID", "Full Name", "Class", "Gender", "Date of Birth", "Parent Name", "Parent Phone", "Enrolled Date"]];
    (data.students || []).forEach(s => rows.push([s.id, s.name, s.class, s.gender, s.dob || "", s.parentName || "", s.parentPhone || "", s.enrolledDate || ""]));
    const csv = rows.map(r => r.map(c => `"${String(c||"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `EduSmart-students-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    showMsg("ok", "Students CSV exported.");
  };

  const S = {
    card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 16 },
    title: { fontWeight: 800, fontSize: 15, color: "#1e3a8a", marginBottom: 8 },
    desc: { fontSize: 12, color: "#64748b", marginBottom: 14, lineHeight: 1.6 },
    btn: (bg, tc="#fff") => ({ background: bg, color: tc, border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: 13, width: "100%" }),
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ fontWeight: 800, fontSize: 20, color: "#1e3a8a", marginBottom: 6 }}>💾 Backup & Restore</div>
      <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24, lineHeight: 1.7 }}>
        All school data — students, staff, fees, grades, attendance, library, alumni — lives in this browser's localStorage. Download a backup regularly and store it in Google Drive, email, or USB. A 20-year-old backup file will still restore perfectly.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 0 }}>
        <div style={S.card}>
          <div style={S.title}>⬇️ Export Full Backup</div>
          <p style={S.desc}>Downloads all school data as a single JSON file you can restore at any time.</p>
          <button onClick={download} style={S.btn("#1e3a8a")}>⬇️ Download Backup (.json)</button>
        </div>
        <div style={S.card}>
          <div style={S.title}>⬆️ Restore from Backup</div>
          <p style={S.desc}>Select a previously downloaded EduSmart .json backup to restore all records.</p>
          <label style={{ display: "block", textAlign: "center", padding: "10px 0", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#64748b" }}>
            📂 Choose Backup File…
            <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onFile} />
          </label>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.title}>📊 Export Students to CSV</div>
        <p style={S.desc}>Export your full student list as a spreadsheet for reporting or printing.</p>
        <button onClick={exportCSV} style={{ ...S.btn("#16a34a"), width: "auto" }}>📊 Export Students CSV</button>
      </div>
      {msg && (
        <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 12, background: msg.type === "ok" ? "#f0fdf4" : "#fef2f2", color: msg.type === "ok" ? "#15803d" : "#dc2626", fontSize: 13, fontWeight: 600, border: `1px solid ${msg.type === "ok" ? "#bbf7d0" : "#fecaca"}` }}>
          {msg.type === "ok" ? "✅ " : "❌ "}{msg.text}
        </div>
      )}
      <div style={S.card}>
        <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Current Data Summary</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[["Students", data.students?.length||0], ["Staff", (data.users||[]).filter(u=>u.role!=="admin").length], ["Fee Records", data.fees?.length||0], ["Library Books", data.books?.length||0], ["Attendance Records", data.attendance?.length||0], ["Grades", data.grades?.length||0], ["Alumni", (data.oldStudents?.length||0)+(data.oldStaff?.length||0)], ["Expelled", data.expelled?.length||0]].map(([l,v]) => (
            <div key={l} style={{ textAlign: "center", background: "#f8fafc", borderRadius: 8, padding: "12px 6px" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#1e3a8a" }}>{v}</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      {confirmRestore && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400 }} onClick={() => setConfirmRestore(null)}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#1e3a8a", marginBottom: 10 }}>⚠️ Confirm Restore</div>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>Backup from <strong style={{ color: "#1e293b" }}>{new Date(confirmRestore.exportedAt).toLocaleString()}</strong></p>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>This replaces ALL current school data with the backup. This cannot be undone.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmRestore(null)} style={{ flex: 1, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 0", color: "#64748b", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => { onRestore(confirmRestore.data); setConfirmRestore(null); showMsg("ok", "School data restored successfully."); }} style={{ flex: 1, background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: "pointer" }}>✅ Yes, Restore</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [licence, setLicence] = useState(() => getLS("edu_licence", null));
  const [setupDone, setSetupDone] = useState(()=>!!localStorage.getItem("edu_setup"));
  const [institution, setInstitution] = useState(()=>loadInstitution("EduSmart-v4"));
  const [showReset, setShowReset] = useState(false);
  // ── Auto-activate from portal launch URL ──────────────────────────────
  useEffect(() => {
    const urlKey = new URLSearchParams(window.location.search).get('key');
    if (urlKey && !getLS("edu_licence", null)) {
      const k = urlKey.toUpperCase().trim();
      if (/^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(k)) {
        const plan = k.split("-")[1]||"";
        const days = plan==="TRIAL"?14:plan==="1M"?30:plan==="6M"?182:plan==="12M"?365:/^\d+Y$/.test(plan)?Math.round(parseInt(plan)*365):365;
        const expiry = new Date(); expiry.setDate(expiry.getDate()+days);
        const lic = { type:"licensed", key:k, tier:"standard", expiry:expiry.toISOString(), school:getLS("edu_school", {name:"School"}) };
        setLS("edu_licence", lic); setLicence(lic);
        window.history.replaceState({},document.title,window.location.pathname);
      }
    }
  }, []);
  const [currentUser, setCurrentUser] = useState(null);
  const [active, setActive] = useState("dashboard");

  const [users, setUsers] = useState(() => getLS("edu_users", SEED_USERS));
  const [students, setStudents] = useState(() => getLS("edu_students", SEED_STUDENTS));
  const [fees, setFees] = useState(() => getLS("edu_fees", SEED_FEES));
  const [grades, setGrades] = useState(() => getLS("edu_grades", SEED_GRADES));
  const [attendance, setAttendance] = useState(() => getLS("edu_attendance", SEED_ATTENDANCE));
  const [books, setBooks] = useState(() => getLS("edu_books", SEED_BOOKS));
  const [loans, setLoans] = useState(() => getLS("edu_loans", SEED_BOOK_LOANS));
  const [oldStudents, setOldStudents] = useState(() => getLS("edu_old_students", SEED_OLD_STUDENTS));
  const [oldStaff, setOldStaff] = useState(() => getLS("edu_old_staff", SEED_OLD_STAFF));
  const [expelled, setExpelled] = useState(() => getLS("edu_expelled", SEED_EXPELLED));
  const [school, setSchool] = useState(() => getLS("edu_school", DEFAULT_SCHOOL));

  // Auto-save
  useEffect(() => { setLS("edu_users", users); }, [users]);
  useEffect(() => { setLS("edu_students", students); }, [students]);
  useEffect(() => { setLS("edu_fees", fees); }, [fees]);
  useEffect(() => { setLS("edu_grades", grades); }, [grades]);
  useEffect(() => { setLS("edu_attendance", attendance); }, [attendance]);
  useEffect(() => { setLS("edu_books", books); }, [books]);
  useEffect(() => { setLS("edu_loans", loans); }, [loans]);
  useEffect(() => { setLS("edu_old_students", oldStudents); }, [oldStudents]);
  useEffect(() => { setLS("edu_old_staff", oldStaff); }, [oldStaff]);
  useEffect(() => { setLS("edu_expelled", expelled); }, [expelled]);
  useEffect(() => { setLS("edu_school", school); }, [school]);
  useEffect(() => { if (licence) setLS("edu_licence", licence); }, [licence]);

  if (!licence) return <LicenceGate onActivate={l => setLicence(l)} />;
  if (!setupDone) return <SetupWizard
    instLabel="School"
    accentColor="#C9A84C"
    bgGrad="linear-gradient(135deg,#0A2240,#152850)"
    onComplete={({instName,instAddr,username,pin})=>{
      const adminUser = { id:"USR-001", code:"ADM001", name:username, role:"admin", username:username.toLowerCase().replace(/\s+/g,"_"), pin, dept:"Administration", subject:"", assignedClass:"", email:"admin@school.gh", phone:"", active:true };
      setUsers(prev=>[adminUser,...(prev||[]).filter(u=>u.role!=="admin")]);
      setInstitution({name:instName,address:instAddr}); saveInstitution("EduSmart-v4",{name:instName,address:instAddr});
      localStorage.setItem("edu_setup","1"); setSetupDone(true);
    }}
  />;

  const expired = new Date(licence.expiry) < new Date();
  if (expired) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fef2f2", fontFamily: "system-ui,sans-serif" }}>
      <Card style={{ maxWidth: 400, textAlign: "center" }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <h2 style={{ color: "#dc2626" }}>Licence Expired</h2>
        <p style={{ color: "#6b7280" }}>Your EduSmart licence has expired. Please renew to continue.</p>
        <p style={{ fontSize: 14 }}><strong>Contact:</strong> 0597147460 | aifarms101@gmail.com</p>
        <Btn onClick={() => setLicence(null)} color="#1e3a8a">Enter New Licence</Btn>
      </Card>
    </div>
  );

  if (!currentUser) return <LoginScreen users={users} onLogin={setCurrentUser} licence={licence} school={school} />;

  const navigate = section => {
    const item = NAV_ITEMS.find(n => n.key === section);
    if (item && (canAccess(currentUser.role, item.section) || item.section === "dashboard")) {
      setActive(section);
    }
  };

  const eduBackupData = { users, students, fees, grades, attendance, books, loans, oldStudents, oldStaff, expelled, school };

  const pages = {
    dashboard: <Dashboard students={students} staff={users} fees={fees} grades={grades} attendance={attendance} currentUser={currentUser} school={school} />,
    students: <Students students={students} setStudents={setStudents} currentUser={currentUser} />,
    staff: <Staff users={users} setUsers={setUsers} currentUser={currentUser} />,
    attendance: <Attendance attendance={attendance} setAttendance={setAttendance} students={students} currentUser={currentUser} />,
    grades: <Grades grades={grades} setGrades={setGrades} students={students} currentUser={currentUser} school={school} />,
    timetable: <Timetable currentUser={currentUser} />,
    fees: <Fees fees={fees} setFees={setFees} students={students} currentUser={currentUser} school={school} />,
    library: <Library books={books} setBooks={setBooks} loans={loans} setLoans={setLoans} currentUser={currentUser} />,
    alumni: <Alumni oldStudents={oldStudents} setOldStudents={setOldStudents} oldStaff={oldStaff} setOldStaff={setOldStaff} />,
    expelled: <Expelled expelled={expelled} setExpelled={setExpelled} currentUser={currentUser} />,
    idcards: <IDCards students={students} users={users} school={school} />,
    settings: <Settings school={school} setSchool={setSchool} licence={licence} />,
    backup: <EduBackup data={eduBackupData} onRestore={d => {
      if (d.users)       setUsers(d.users);
      if (d.students)    setStudents(d.students);
      if (d.fees)        setFees(d.fees);
      if (d.grades)      setGrades(d.grades);
      if (d.attendance)  setAttendance(d.attendance);
      if (d.books)       setBooks(d.books);
      if (d.loans)       setLoans(d.loans);
      if (d.oldStudents) setOldStudents(d.oldStudents);
      if (d.oldStaff)    setOldStaff(d.oldStaff);
      if (d.expelled)    setExpelled(d.expelled);
      if (d.school)      setSchool(d.school);
    }} />,
  };

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: "#f1f5f9", minHeight: "100vh" }}>
      <Sidebar currentUser={currentUser} active={active} onNavigate={navigate} school={school} onLogout={() => setCurrentUser(null)} />
      <div style={{ marginLeft: 220, padding: 28, minHeight: "100vh" }}>
        {pages[active] || <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>⛔ You do not have access to this section.<br /><small>Code: {currentUser.code}</small></div>}
      </div>
    </div>
  );
}
