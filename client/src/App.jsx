import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, Navigate, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  Activity, BarChart3, BookOpen, Brain, ChevronDown, Clock3, Headphones,
  Home, LogOut, Menu, Mic, PenLine, Play, Settings, Sparkles, Target,
  Trophy, UserRound, Volume2, X, CheckCircle2, AlertCircle, Shield, ChevronLeft, ChevronRight,
  Eye, EyeOff, Moon, Sun
} from "lucide-react";
import { api, forceLogout } from "./api.js";
import { Result, ObjectiveResult } from "./PracticeObjective.jsx";
import { AdminQuestionsPanel } from "./AdminQuestions.jsx";
import PracticePage from "./practice/Practice.jsx";
import PracticeHubPage from "./pages/PracticeHub.jsx";
import DashboardPage from "./pages/Dashboard.jsx";
import ProfilePage from "./pages/Profile.jsx";
import MockPage from "./pages/Mock.jsx";
import HistoryPage from "./pages/History.jsx";
import AdminPage from "./pages/Admin.jsx";
import { MockResultRow } from "./pages/History.jsx";
import { ReadingTask } from "./practice/Reading.jsx";
import { ListeningTask } from "./practice/Listening.jsx";
import SpeakingTaskModule from "./practice/Speaking.jsx";
import WritingTaskModule from "./practice/Writing.jsx";
import { Badge, Empty, Page, SkeletonCards, SkeletonRows } from "./components/common.jsx";
import { PRACTICE_SECTIONS, SECTION_LABELS, PRACTICE_TASKS, MORE_ITEMS, supportedTasksFor } from "./practiceTaskRegistry.js";

const SECTION_ICONS = { speaking: Mic, writing: PenLine, reading: BookOpen, listening: Headphones };
const PRACTICE_PATHS = new Set(["/practice", "/speaking", "/writing", "/reading", "/listening"]);
const MORE_PATHS = new Set(MORE_ITEMS.filter(m => m.to).map(m => m.to));

const SUBSCRIPTION_EXPIRED_MESSAGE = "Your 30-day subscription has expired. Please contact the administrator to renew your access.";
// setTimeout's delay is coerced to a 32-bit signed int — anything past this fires almost
// immediately instead of waiting. A subscription is realistically never more than ~24 days
// out from this cap, so a single timer is enough; no rescheduling loop is needed.
const MAX_TIMEOUT_MS = 2_147_483_647;

function getInitialTheme() {
  const saved = localStorage.getItem("pte_theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#12182b" : "#f4f7fc");
    localStorage.setItem("pte_theme", theme);
  }, [theme]);
  return { theme, toggleTheme: () => setTheme(current => current === "dark" ? "light" : "dark") };
}

function ThemeToggle({ theme, onToggle, compact = false }) {
  const isDark = theme === "dark";
  return <button
    type="button"
    className={compact ? "theme-toggle theme-toggle-compact" : "theme-toggle"}
    onClick={onToggle}
    aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
    title={`Switch to ${isDark ? "light" : "dark"} mode`}
  >
    {isDark ? <Sun size={17}/> : <Moon size={17}/>}<span>{isDark ? "Light mode" : "Dark mode"}</span>
  </button>;
}

function useAuth() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pte_user") || "null"); } catch { return null; }
  });
  const save = (data) => {
    localStorage.setItem("pte_token", data.token);
    localStorage.setItem("pte_user", JSON.stringify(data.user));
    setUser(data.user);
  };
  const logout = () => {
    api.auth.logout();
    localStorage.removeItem("pte_token"); localStorage.removeItem("pte_user"); setUser(null);
  };
  useEffect(() => {
    if (!user || user.role === "admin" || !user.subscriptionEndDate) return;
    const msRemaining = new Date(user.subscriptionEndDate).getTime() - Date.now();
    if (user.subscriptionStatus !== "ACTIVE" || msRemaining <= 0) {
      forceLogout(SUBSCRIPTION_EXPIRED_MESSAGE);
      return;
    }
    const timer = setTimeout(() => forceLogout(SUBSCRIPTION_EXPIRED_MESSAGE), Math.min(msRemaining, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [user?.id, user?.subscriptionEndDate, user?.subscriptionStatus, user?.role]);
  return { user, save, logout };
}

function subscriptionLabel(user) {
  if (!user) return "";
  if (user.role === "admin") return "Admin access";
  if (!user.subscriptionEndDate || user.subscriptionStatus !== "ACTIVE") return "No active subscription";
  const daysLeft = Math.max(0, Math.ceil((new Date(user.subscriptionEndDate) - Date.now()) / 86400000));
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}

function Auth({ save, theme, toggleTheme }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [notice] = useState(() => {
    const n = sessionStorage.getItem("pte_login_notice");
    sessionStorage.removeItem("pte_login_notice");
    return n || "";
  });
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  async function submit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const data = await api.auth.signin({ username: form.username, password: form.password });
      save(data);
      navigate(data.user.role === "admin" ? "/admin" : "/dashboard");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="auth-page">
    <div className="auth-theme-control"><ThemeToggle theme={theme} onToggle={toggleTheme}/></div>
    <div className="auth-visual"><div className="brand large"><span className="brand-mark" aria-hidden="true">P</span><span><span>PTE</span> AI</span></div><h1>Practice smarter.<br/>Reach your target score.</h1><p>One workspace for speaking, writing, reading, listening, mock tests and personalized AI feedback.</p><div className="auth-features"><div className="auth-feature"><CheckCircle2 size={16}/> All four PTE sections, one practice library</div><div className="auth-feature"><CheckCircle2 size={16}/> Objective scoring for every reading/listening task</div><div className="auth-feature"><CheckCircle2 size={16}/> Full-length mock tests with a real practice report</div></div><div className="visual-card"><Sparkles size={20}/><b>AI-powered practice</b><span>Track every attempt and understand exactly what to improve.</span></div></div>
    <div className="auth-card"><div className="brand"><span className="brand-mark" aria-hidden="true">P</span><span><span>PTE</span> AI</span></div><h2>Welcome back</h2><p className="muted">Sign in with the User ID and password provided by your administrator.</p><div className="alert notice"><AlertCircle size={17}/><span><b>⚠️ One Device &amp; One Browser Policy</b><br/>Your account is restricted to one device and one browser. Please log in using the device and browser you intend to use for your regular PTE practice.</span></div>{notice && <div className="alert error"><AlertCircle size={17}/>{notice}</div>}{error && <div className="alert error"><AlertCircle size={17}/>{error}</div>}<form onSubmit={submit}><label>User ID<input required autoCapitalize="none" autoCorrect="off" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="e.g. pte001"/></label><label>Password<div className="password-field"><input required type={showPassword ? "text" : "password"} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Your password"/><button type="button" className="password-toggle" onClick={()=>setShowPassword(s=>!s)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} tabIndex={-1}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label><button className="primary full" disabled={busy}>{busy ? "Signing in..." : "Sign In"}</button></form><p className="muted" style={{marginTop:18}}>Don't have an account? Contact your administrator to get access.</p></div>
  </div>;
}

function useDropdown() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } }
    function onPointerDown(e) { if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return; setOpen(false); }
    document.addEventListener("keydown", onKeyDown); document.addEventListener("mousedown", onPointerDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("mousedown", onPointerDown); };
  }, [open]);
  return { open, setOpen, panelRef, triggerRef };
}

function PteMegaMenu({ onNavigate }) {
  const { open, setOpen, panelRef, triggerRef } = useDropdown();
  const [accordionOpen, setAccordionOpen] = useState(() => new Set());
  const navigate = useNavigate();
  const location = useLocation();
  const active = PRACTICE_PATHS.has(location.pathname);
  function go(section, slug) { setOpen(false); onNavigate?.(); navigate(slug ? `/${section}?type=${slug}` : `/${section}`); }
  function toggleAccordion(section) { setAccordionOpen(prev => { const next = new Set(prev); next.has(section) ? next.delete(section) : next.add(section); return next; }); }
  return <div className="mega-menu-wrap">
    <button ref={triggerRef} className={active ? "nav-item active" : "nav-item"} aria-expanded={open} aria-haspopup="true" aria-controls="pte-practice-panel" onClick={() => setOpen(o => !o)}>
      <Trophy size={18} /><span>PTE Practice</span><ChevronDown size={14} className={open ? "chev open" : "chev"} />
    </button>
    {open && <div className="mega-menu-backdrop" aria-hidden="true"/>}
    {open && <div id="pte-practice-panel" ref={panelRef} role="region" aria-label="PTE Practice menu" className="mega-menu">
      <div className="mega-menu-head">
        <span className="tab active">PTE Academic / UKVI</span>
        <span className="tab" title="This portal's practice library isn't split by exam variant yet — the same available questions are shown for both.">PTE Core</span>
      </div>
      <div className="mega-menu-grid">
        {PRACTICE_SECTIONS.map(section => <div className="mega-menu-col" key={section}>
          <button className="mega-menu-col-head" onClick={() => toggleAccordion(section)} aria-expanded={accordionOpen.has(section)} aria-controls={`mega-col-${section}`}>
            {SECTION_LABELS[section]}<ChevronDown size={14} className="chev mobile-only" />
          </button>
          <div id={`mega-col-${section}`} className={accordionOpen.has(section) ? "mega-menu-col-list open" : "mega-menu-col-list"}>
            {PRACTICE_TASKS[section].map(t => t.supported
              ? <button key={t.slug} className="mega-menu-link" onClick={() => go(section, t.slug)}>{t.label}</button>
              : <span key={t.slug} className="mega-menu-link disabled">{t.label}<Badge tone="neutral">Coming Soon</Badge></span>
            )}
          </div>
        </div>)}
      </div>
      <div className="mega-menu-foot">
        <NavLink to="/practice" className="link" onClick={() => { setOpen(false); onNavigate?.(); }}>Open the full Practice Hub →</NavLink>
      </div>
    </div>}
  </div>;
}

// The "More" dropdown (Part 2/3) — Vocabulary/Shadowing/AI Score Report Analysis/Study
// Materials genuinely don't exist yet in this portal and are rendered disabled with a Coming
// Soon badge rather than a dead link; AI Study Plan/Mock Tests/Practice History reuse their
// existing routes unchanged.
function MoreMenu({ onNavigate }) {
  const { open, setOpen, panelRef, triggerRef } = useDropdown();
  const navigate = useNavigate();
  const location = useLocation();
  const active = MORE_PATHS.has(location.pathname);

  return <div className="mega-menu-wrap">
    <button ref={triggerRef} className={active ? "nav-item active" : "nav-item"} aria-expanded={open} aria-haspopup="true" aria-controls="more-panel" onClick={() => setOpen(o => !o)}>
      <Settings size={18} /><span>More</span><ChevronDown size={14} className={open ? "chev open" : "chev"} />
    </button>
    {open && <div className="mega-menu-backdrop" aria-hidden="true"/>}
    {open && <div id="more-panel" ref={panelRef} role="region" aria-label="More menu" className="mega-menu more-menu">
      {MORE_ITEMS.map(m => m.to
        ? <button key={m.key} className="mega-menu-link" onClick={() => { setOpen(false); onNavigate?.(); navigate(m.to); }}>{m.label}</button>
        : <span key={m.key} className="mega-menu-link disabled">{m.label}<Badge tone="neutral">Coming Soon</Badge></span>
      )}
    </div>}
  </div>;
}

// The two sidebar variants are structurally distinct, not the same nav with a relabeled item:
// the admin one has no PTE Practice mega-menu / More menu at all (those are student concerns),
// and the student one's Admin Panel link — only ever shown to an actual admin — is a normal,
// visible top-level nav item rather than buried at the bottom next to Logout.
// Reads the admin tab straight from the URL (Admin() itself keeps the two in sync — see its own
// useSearchParams wiring) so a sidebar link and a browser back/forward action always agree on
// which tab is "active", without prop-drilling tab state down from Admin(). Distinct labels from
// the in-page tab strip ("Manage Users" vs "Users", "Question Library" vs "Questions", "Mock
// Attempts" vs "Test Sessions") are deliberate — both are real, working destinations, just named
// for their different context (quick sidebar access vs. the page's own tab strip).
function AdminSidebarNav({ onNavigate }) {
  const [searchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "dashboard";
  const cls = key => currentTab === key ? "nav-item active" : "nav-item";
  // Plain <Link>, not <NavLink>, for the three tab shortcuts: they all share the /admin
  // pathname and differ only by ?tab=, and NavLink's own active-matching ignores search params
  // entirely — it would mark all three "active" at once regardless of which tab is actually
  // selected. <Link> never auto-applies an active class, so cls() above is the only source of
  // truth for which one is highlighted.
  return <>
    <div className="nav-group-label">Overview</div>
    <NavLink to="/admin" end className={({isActive})=>isActive && currentTab==="dashboard" ?"nav-item active":"nav-item"} onClick={onNavigate}><Shield size={18}/><span>Admin Dashboard</span></NavLink>
    <div className="nav-group-label">Administration</div>
    <Link to="/admin?tab=users" className={cls("users")} onClick={onNavigate}><UserRound size={18}/><span>Manage Users</span></Link>
    <Link to="/admin?tab=questions" className={cls("questions")} onClick={onNavigate}><BookOpen size={18}/><span>Content Library</span></Link>
    <Link to="/admin?tab=testSessions" className={cls("testSessions")} onClick={onNavigate}><Trophy size={18}/><span>Mock Attempts</span></Link>
    <div className="nav-group-label">Other</div>
    <NavLink to="/dashboard" className="nav-item" onClick={onNavigate}><Home size={18}/><span>Student Site</span></NavLink>
  </>;
}

function StudentSidebarNav({ user, onNavigate }) {
  const cls = ({isActive}) => isActive ? "nav-item active" : "nav-item";
  return <>
    <div className="nav-group-label">Main</div>
    <NavLink to="/dashboard" className={cls} onClick={onNavigate}><Home size={18}/><span>Dashboard</span></NavLink>
    <div className="nav-group-label">Practice</div>
    <PteMegaMenu onNavigate={onNavigate}/>
    <NavLink to="/mock" className={cls} onClick={onNavigate}><Trophy size={18}/><span>Take Mock Test</span></NavLink>
    <NavLink to="/history" className={cls} onClick={onNavigate}><BarChart3 size={18}/><span>My Results</span></NavLink>
    <MoreMenu onNavigate={onNavigate}/>
    {user?.role === "admin" && <div className="nav-group-label">Admin</div>}
    {user?.role === "admin" && <NavLink to="/admin" className="nav-item admin-panel-link" onClick={onNavigate}><Shield size={18}/><span>Admin Panel</span></NavLink>}
  </>;
}

function useSearchDestinations(user) {
  return useMemo(() => {
    const pages = [
      { label: "Dashboard", group: "Pages", to: "/dashboard" },
      { label: "PTE Practice", group: "Pages", to: "/practice" },
      { label: "Mock Tests", group: "Pages", to: "/mock" },
      { label: "Practice History", group: "Pages", to: "/history" },
      { label: "AI Study Plan", group: "Pages", to: "/plan" },
      { label: "Profile", group: "Pages", to: "/profile" }
    ];
    const tasks = PRACTICE_SECTIONS.flatMap(section =>
      supportedTasksFor(section).map(t => ({ label: `${t.label} — ${SECTION_LABELS[section]}`, group: "Practice tasks", to: `/${section}?type=${t.slug}` }))
    );
    const admin = user?.role === "admin" ? [
      { label: "Admin Dashboard", group: "Admin", to: "/admin" },
      { label: "Manage Users", group: "Admin", to: "/admin?tab=users" },
      { label: "Manage Questions", group: "Admin", to: "/admin?tab=questions" },
      { label: "Test Sessions", group: "Admin", to: "/admin?tab=sessions" }
    ] : [];
    return [...pages, ...tasks, ...admin];
  }, [user?.role]);
}

function HeaderSearch({ user }) {
  const [term, setTerm] = useState("");
  const [highlight, setHighlight] = useState(0);
  const { open, setOpen, panelRef, triggerRef } = useDropdown();
  const navigate = useNavigate();
  const destinations = useSearchDestinations(user);

  const results = term.trim()
    ? destinations.filter(d => d.label.toLowerCase().includes(term.trim().toLowerCase())).slice(0, 8)
    : [];
  const grouped = results.reduce((acc, r) => { (acc[r.group] ||= []).push(r); return acc; }, {});

  function go(to) {
    if (!to) return;
    setTerm(""); setOpen(false);
    navigate(to);
  }
  function onKeyDown(e) {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(results.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[highlight]?.to); }
  }

  return <div className="search" ref={triggerRef}>
    <span aria-hidden="true">⌕</span>
    <input
      placeholder="Search anything..."
      value={term}
      onChange={e => { setTerm(e.target.value); setOpen(true); setHighlight(0); }}
      onFocus={() => setOpen(true)}
      onKeyDown={onKeyDown}
      role="combobox"
      aria-expanded={open && !!term.trim()}
      aria-controls="header-search-results"
      aria-label="Search anything"
    />
    {open && term.trim() && <div className="search-results" id="header-search-results" ref={panelRef} role="listbox">
      {results.length
        ? Object.entries(grouped).map(([group, items]) => <div key={group}>
            <div className="search-result-group">{group}</div>
            {items.map(r => {
              const idx = results.indexOf(r);
              return <button key={r.to} type="button" role="option" aria-selected={idx === highlight}
                className={idx === highlight ? "search-result active" : "search-result"}
                onMouseEnter={() => setHighlight(idx)} onClick={() => go(r.to)}>{r.label}</button>;
            })}
          </div>)
        : <div className="search-empty">No matches for "{term}"</div>}
    </div>}
  </div>;
}

function topbarLabel(pathname) {
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname === "/mock") return "Mock Tests";
  if (pathname === "/history") return "Practice History";
  if (pathname === "/plan") return "AI Study Plan";
  if (pathname === "/profile") return "Profile";
  if (pathname.startsWith("/admin")) return "Admin";
  if (["/speaking", "/writing", "/reading", "/listening", "/practice"].some(p => pathname.startsWith(p))) return "PTE Practice";
  return "";
}

function Layout({ user, logout, children, theme, toggleTheme }) {
  const [mobile, setMobile] = useState(false);
  const location = useLocation();
  const inAdminSection = user?.role === "admin" && location.pathname === "/admin";
  const closeMobile = () => setMobile(false);
  return <div className="app-shell">
    <aside className={mobile ? "sidebar mobile-open" : "sidebar"}>
      <div className="sidebar-top">
        {/* "Admin Mode", not "Admin Panel" — the Admin component's own <Page title="Admin Panel">
            heading already owns that exact string; two elements with identical text would make
            every existing screen.findByText("Admin Panel") test (and a real screen reader)
            ambiguous. */}
        <div className="brand"><span className="brand-mark" aria-hidden="true">P</span><span><span>PTE</span> AI</span>{inAdminSection && <Badge tone="info">Admin Mode</Badge>}</div>
        <button className="icon-btn mobile-close" onClick={closeMobile} aria-label="Close menu"><X size={19}/></button>
      </div>
      <nav>
        {inAdminSection ? <AdminSidebarNav onNavigate={closeMobile}/> : <StudentSidebarNav user={user} onNavigate={closeMobile}/>}
      </nav>
      <div className="sidebar-bottom">
        <NavLink to="/profile" className="nav-item"><UserRound size={18}/><span>Profile</span></NavLink>
        <button className="nav-item" onClick={logout}><LogOut size={18}/><span>Log out</span></button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn mobile-menu" onClick={()=>setMobile(true)} aria-label="Open menu"><Menu size={21}/></button>
          <span className="topbar-breadcrumb"><b>{topbarLabel(location.pathname)}</b></span>
        </div>
        <HeaderSearch user={user}/>
        <ThemeToggle theme={theme} onToggle={toggleTheme} compact/>
        <div className="top-user"><div className="avatar">{user?.name?.slice(0,1).toUpperCase()}</div><div><b>{user?.name}</b><small>{subscriptionLabel(user)}</small></div><ChevronDown size={15}/></div>
      </header>
      <div className="content">{children}</div>
    </main>
  </div>
}

function Plan() {
  const [data,setData]=useState(null);useEffect(()=>{api.plan().then(setData).catch(()=>{})},[]);
  return <Page title="Personal Study Plan" subtitle="Your plan adapts to your practice history."><div className="plan-hero panel"><div className="plan-icon"><Brain/></div><div><span className="eyebrow">FOCUS AREA</span><h2>{data?.weakest||"Speaking"}</h2><p>Build consistency in your weakest section first.</p></div></div><div className="two-col"><section className="panel"><h3>Today's tasks</h3>{(data?.tasks||["Complete 10 speaking questions","Review mistakes","Learn 10 words","Take a mini test"]).map((x,i)=><div className="check-row" key={i}><CheckCircle2 size={19}/><span>{x}</span></div>)}</section><section className="panel"><h3>Section performance</h3>{(data?.sectionScores||[]).map(x=><div className="bar-row" key={x.section}><span>{x.section}</span><div><i style={{width:`${Math.min(100,x.score)}%`}}/></div><b>{x.score}</b></div>)}</section></div></Page>
}

function accountStatusTone(s){ return s==="ACTIVE"?"good":s==="BLOCKED"?"bad":"warn" }
function difficultyTone(d){ return d==="easy"?"good":d==="hard"?"bad":"warn" }
function paymentStatusTone(s){ return s==="PAID"?"good":s==="PENDING"?"warn":s==="FAILED"?"bad":"neutral" }
function subscriptionTone(s){ return s==="ACTIVE"?"good":s==="EXPIRED"?"bad":"neutral" }
function fmtDate(d){ return d ? new Date(d).toLocaleDateString() : "—" }
function fmtDateTime(d){ return d ? new Date(d).toLocaleString() : "—" }
// Maps the exact `reason` code the server already returns on a rejected sign-in to a short,
// student-safe label an admin can scan quickly — never a raw device identifier here.
function loginAttemptReasonLabel(reason) {
  const labels = {
    SUCCESS: "Signed in",
    INVALID_CREDENTIALS: "Wrong User ID or password",
    ACCOUNT_BLOCKED: "Account blocked",
    ACCOUNT_SUSPENDED: "Account suspended",
    SUBSCRIPTION_EXPIRED: "Subscription expired",
    SUBSCRIPTION_INACTIVE: "Subscription not activated",
    DEVICE_NOT_REGISTERED: "Device restriction",
    ACCOUNT_ALREADY_ACTIVE: "Already active on another device"
  };
  return labels[reason] || reason;
}
function daysRemaining(u){
  if(!u.subscriptionEndDate || u.subscriptionStatus!=="ACTIVE") return "—";
  return Math.max(0, Math.ceil((new Date(u.subscriptionEndDate)-Date.now())/86400000));
}

export function ToastHost({toasts,dismiss}) {
  if(!toasts.length) return null;
  return <div className="toast-host" role="status" aria-live="polite">{toasts.map(t=><button key={t.id} type="button" className={`toast toast-${t.type}`} onClick={()=>dismiss(t.id)}>{t.message}<span className="sr-only"> — dismiss</span></button>)}</div>
}

function ConfirmDialog({open,title,message,confirmLabel,danger,busy,onConfirm,onCancel}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onCancel(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if(!open) return null;
  return <div className="modal-overlay confirm-overlay" onClick={e=>{e.stopPropagation();onCancel()}}>
    <div className="modal-panel confirm-panel" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}>
      <h3>{title}</h3>
      <p className="muted">{message}</p>
      <div className="modal-actions">
        <button className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={danger?"primary danger":"primary"} onClick={onConfirm} disabled={busy}>{busy?"Working...":confirmLabel}</button>
      </div>
    </div>
  </div>
}

function StatTile({label,value,tone,onClick}) {
  return <button type="button" className={`stat-tile${onClick?" clickable":""}${tone?` stat-${tone}`:""}`} onClick={onClick} disabled={!onClick}>
    <span className="stat-value">{value}</span>
    <span className="stat-label">{label}</span>
  </button>
}

const ACTIVITY_LABELS = {
  USER_CREATED:"created", USER_BLOCKED:"blocked", USER_ACTIVATED:"activated", USER_SUSPENDED:"suspended",
  USER_UPDATED:"updated", PASSWORD_RESET:"reset the password of", SUBSCRIPTION_RENEWED:"renewed the subscription of",
  SUBSCRIPTION_CHANGED:"changed the subscription of", FORCE_LOGOUT:"force-logged-out"
};

export function AdminDashboard({notify, goToUsers, goToQuestions}) {
  const [stats,setStats]=useState(null);
  const [questionStats,setQuestionStats]=useState(null);
  const [activity,setActivity]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  useEffect(()=>{ load(); },[]);

  function load() {
    setLoading(true); setError("");
    Promise.all([api.admin.getStats(), api.admin.getAuditLog(8), api.admin.questions.stats()])
      .then(([s,a,q])=>{setStats(s);setActivity(a.logs);setQuestionStats(q)})
      .catch(e=>{setError(e.message);notify("error",e.message)})
      .finally(()=>setLoading(false));
  }

  if (loading) return <div className="admin-dashboard">
    <SkeletonCards count={8} gridClass="stat-grid"/>
    <SkeletonRows count={4}/>
  </div>;
  if (error) return <div className="panel error-state"><AlertCircle size={30}/><h4>Unable to load the dashboard</h4><p>Please check your connection and try again.</p><button className="secondary" onClick={load}>Retry</button></div>;

  return <div className="admin-dashboard">
    <section className="admin-hero">
      <div>
        <span className="eyebrow">ADMIN COMMAND CENTER</span>
        <h2>Run your learning portal with clarity.</h2>
        <p>Manage student access, subscriptions, and practice content from one focused workspace.</p>
      </div>
      <div className="admin-hero-metric">
        <span>Active learners</span>
        <strong>{stats.accountStatus.active}</strong>
        <small><span className="live-dot"/> Live account status</small>
      </div>
    </section>
    <div className="stat-grid">
      <StatTile label="Total users" value={stats.totalUsers}/>
      <StatTile label="Active accounts" value={stats.accountStatus.active} tone="good" onClick={()=>goToUsers({status:"ACTIVE"})}/>
      <StatTile label="Blocked" value={stats.accountStatus.blocked} tone="bad" onClick={()=>goToUsers({status:"BLOCKED"})}/>
      <StatTile label="Suspended" value={stats.accountStatus.suspended} tone="warn" onClick={()=>goToUsers({status:"SUSPENDED"})}/>
      <StatTile label="Pending payment" value={stats.paymentStatus.pending} tone="warn" onClick={()=>goToUsers({paymentStatus:"PENDING"})}/>
      <StatTile label="Paid" value={stats.paymentStatus.paid} tone="good" onClick={()=>goToUsers({paymentStatus:"PAID"})}/>
      <StatTile label="Expiring within 7 days" value={stats.subscription.expiringWithin7Days} tone="warn" onClick={()=>goToUsers({subscription:"EXPIRING"})}/>
      <StatTile label="Expired subscriptions" value={stats.subscription.expired} tone="bad" onClick={()=>goToUsers({subscription:"EXPIRED"})}/>
    </div>
    {questionStats && <>
      <h2 className="section-title">Question library</h2>
      <div className="stat-grid mini-grid">
        <StatTile label="Total questions" value={questionStats.total} onClick={goToQuestions}/>
        <StatTile label="Active" value={questionStats.active} tone="good" onClick={goToQuestions}/>
        <StatTile label="Inactive" value={questionStats.inactive} tone="warn" onClick={goToQuestions}/>
        <StatTile label="Objective" value={questionStats.byEvaluationType.objective||0} onClick={goToQuestions}/>
        <StatTile label="Subjective" value={questionStats.byEvaluationType.subjective||0} onClick={goToQuestions}/>
      </div>
    </>}
    <section className="panel">
      <div className="panel-head"><div><h3>Recent admin activity</h3><p className="muted">Last {activity.length} action{activity.length===1?"":"s"}</p></div></div>
      {activity.length ? <div className="activity-list">{activity.map(a=><div className="activity-row" key={a.id}>
          <span className="activity-dot"/>
          <div><p><b>{a.admin?.username||"admin"}</b> {ACTIVITY_LABELS[a.action]||a.action.toLowerCase()} {a.target ? <b>{a.target.username}</b> : ""}</p><small className="muted">{fmtDateTime(a.createdAt)}</small></div>
        </div>)}</div> : <Empty text="No admin activity yet."/>}
    </section>
  </div>
}

const SUBSCRIPTION_FILTERS = [
  ["", "All subscriptions"], ["ACTIVE","Active"], ["EXPIRING","Expiring soon (7 days)"], ["EXPIRED","Expired"], ["NOT_ACTIVATED","Not activated"]
];

// The message an admin copies and sends to a newly created student — reuses window.location.origin
// (the real address this admin panel is actually running at) rather than hardcoding a domain, so
// it's correct in every environment without configuration.
function buildAccountCreatedMessage({ username, password }) {
  const loginUrl = window.location.origin;
  return `MyPTEScore – Your Path to PTE Success

Comprehensive PTE exam preparation with AI-powered scoring at myptescore.com

Hello! 👋

Your MyPTEScore account is ready.

🔐 Login Details

👤 Username: ${username}
🔑 Password: ${password}

🌐 Login here: ${loginUrl}

⚠️ IMPORTANT NOTE

Your account is device restricted. It will only work on one device and one browser.

👉 Please log in from the device and browser you plan to use every day.

Once logged in, your account will automatically be locked to that device and browser. You will not be able to access your account from another device or browser.

🔒 This restriction helps protect your account and prevents account sharing.

If you need to change your device or browser, please contact the administrator for assistance.

Please log in and start practicing. Feel free to reach out if you need any help! 😊`;
}

function buildPasswordResetMessage({ username, password }) {
  const loginUrl = window.location.origin;
  return `MyPTEScore – Your Path to PTE Success

Hello! 👋

Your MyPTEScore password has been reset.

🔐 Updated Login Details

👤 Username: ${username}
🔑 Your new password: ${password}

🌐 Login here: ${loginUrl}

⚠️ IMPORTANT NOTE

For your security, you have been signed out from any active session. Please sign in again using your new password.

Your account is device restricted. Please log in from the device and browser you plan to use every day.

If you need any help, please contact the administrator.`;
}

function CredentialMessageModal({ title, description, message, onClose }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  function copy() {
    navigator.clipboard?.writeText(message).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-panel" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
      <p className="muted" style={{marginTop:-6}}>{description}</p>
      <textarea readOnly className="answer-area" style={{height:360,fontFamily:"monospace",fontSize:12}} value={message} onClick={e => e.target.select()}/>
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>Close</button>
        <button className="primary" onClick={copy}>{copied ? "Copied!" : "Copy message"}</button>
      </div>
    </div>
  </div>;
}

function AccountCreatedModal({ account, onClose }) {
  return <CredentialMessageModal
    title="Account created"
    description="Copy this message and send it to the student — it includes their login details and explains the one-device/one-browser policy."
    message={buildAccountCreatedMessage(account)}
    onClose={onClose}
  />;
}

function PasswordResetModal({ account, onClose }) {
  return <CredentialMessageModal
    title="Password reset"
    description="Copy this message and send it to the student — it clearly includes their new password and explains that they must sign in again."
    message={buildPasswordResetMessage(account)}
    onClose={onClose}
  />;
}

export function AdminUsers({notify, initialFilters, onFiltersApplied}) {
  const [users,setUsers]=useState([]);
  const [total,setTotal]=useState(0);
  const [totalPages,setTotalPages]=useState(1);
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("");
  const [paymentStatus,setPaymentStatus]=useState("");
  const [subscription,setSubscription]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [showCreate,setShowCreate]=useState(false);
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState({username:"",name:"",email:"",password:"",paymentStatus:"PAID",subscriptionDays:30});
  const [detailId,setDetailId]=useState(null);
  const [createdAccount,setCreatedAccount]=useState(null);

  useEffect(()=>{
    if (!initialFilters) return;
    setStatus(initialFilters.status||"");
    setPaymentStatus(initialFilters.paymentStatus||"");
    setSubscription(initialFilters.subscription||"");
    onFiltersApplied?.();
  },[initialFilters]);

  function load(pageArg) {
    setLoading(true); setError("");
    api.admin.listUsers({ page: pageArg||page, limit:20, search, status, paymentStatus, subscription })
      .then(d=>{setUsers(d.users);setTotal(d.total);setTotalPages(d.totalPages);setPage(d.page)})
      .catch(e=>setError(e.message))
      .finally(()=>setLoading(false));
  }
  useEffect(()=>{load(1)},[status,paymentStatus,subscription]);

  async function createUser(e) {
    e.preventDefault(); setCreating(true); setError("");
    try {
      const d = await api.admin.createUser(form);
      notify("success", `User "${d.user.username}" created. Temporary password: ${d.temporaryPassword} — share this with them securely.`);
      setCreatedAccount({ username: d.user.username, password: d.temporaryPassword });
      setForm({username:"",name:"",email:"",password:"",paymentStatus:"PAID",subscriptionDays:30});
      setShowCreate(false);
      load(1);
    } catch (e) { setError(e.message); } finally { setCreating(false); }
  }

  return <div>
    <div className="panel-head">
      <div><h3>User accounts</h3><p className="muted">{total} total · registration is admin-only</p></div>
      <button className="primary" onClick={()=>setShowCreate(s=>!s)}>{showCreate ? "Cancel" : "+ Create user"}</button>
    </div>
    {error && <div className="alert error">{error}</div>}
    {showCreate && <form onSubmit={createUser} className="admin-create-form">
      <label>User ID<input required value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="pte002"/></label>
      <label>Name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name"/></label>
      <label>Email (optional)<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Password (blank = auto-generate)<input value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
      <label>Payment status
        <select value={form.paymentStatus} onChange={e=>setForm({...form,paymentStatus:e.target.value})}>
          <option value="PAID">Paid — activate now</option>
          <option value="PENDING">Pending — don't activate yet</option>
        </select>
      </label>
      <label>Subscription length
        <select value={form.subscriptionDays} onChange={e=>setForm({...form,subscriptionDays:e.target.value})}>
          <option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option>
        </select>
      </label>
      <button className="primary" disabled={creating}>{creating ? "Creating..." : "Create user"}</button>
    </form>}
    <div className="filter-bar">
      <div className="search admin-search"><span aria-hidden="true">⌕</span><input placeholder="Search by User ID, name or email..." aria-label="Search users" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load(1)}/></div>
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter by account status">
        <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="BLOCKED">Blocked</option><option value="SUSPENDED">Suspended</option>
      </select>
      <select value={paymentStatus} onChange={e=>setPaymentStatus(e.target.value)} aria-label="Filter by payment status">
        <option value="">All payments</option><option value="PAID">Paid</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="REFUNDED">Refunded</option>
      </select>
      <select value={subscription} onChange={e=>setSubscription(e.target.value)} aria-label="Filter by subscription status">
        {SUBSCRIPTION_FILTERS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
      </select>
    </div>
    {loading ? <SkeletonRows count={8}/> : !users.length ? <Empty text="No users match these filters."/> : <>
      <div className="table-wrap"><table><thead><tr>
        <th>User ID</th><th>Name</th><th>Email</th><th>Status</th><th>Payment</th><th>Subscription</th><th>Days left</th><th>Last login</th><th>Session</th><th>Created</th><th>Actions</th>
      </tr></thead><tbody>
        {users.map(u=><tr key={u.id}>
          <td><b>{u.username}</b>{u.role==="admin" && <span className="chip" style={{marginLeft:6}}>admin</span>}</td>
          <td>{u.name}</td>
          <td className="mono-cell">{u.email||"—"}</td>
          <td><Badge tone={accountStatusTone(u.accountStatus)}>{u.accountStatus}</Badge></td>
          <td><Badge tone={paymentStatusTone(u.paymentStatus)}>{u.paymentStatus}</Badge></td>
          <td><Badge tone={subscriptionTone(u.subscriptionStatus)}>{u.subscriptionStatus.replace("_"," ")}</Badge></td>
          <td>{daysRemaining(u)}</td>
          <td>{fmtDateTime(u.lastLoginAt)}</td>
          <td><Badge tone={u.sessionStatus==="ACTIVE"?"info":"neutral"}>{u.sessionStatus}</Badge></td>
          <td>{fmtDate(u.createdAt)}</td>
          <td>{u.role!=="admin" && <button className="text-button" onClick={()=>setDetailId(u.id)}>Manage</button>}</td>
        </tr>)}
      </tbody></table></div>
      <div className="pager">
        <button className="secondary" disabled={page<=1} onClick={()=>load(page-1)}>‹ Previous</button>
        <span className="muted">Page {page} of {totalPages} · {total} users</span>
        <button className="secondary" disabled={page>=totalPages} onClick={()=>load(page+1)}>Next ›</button>
      </div>
    </>}
    {detailId && <AdminUserDetail id={detailId} notify={notify} onClose={()=>{setDetailId(null); load();}}/>}
    {createdAccount && <AccountCreatedModal account={createdAccount} onClose={()=>setCreatedAccount(null)}/>}
  </div>
}

function AdminUserDetail({id, notify, onClose}) {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [confirmAction,setConfirmAction]=useState(null);
  const [customDays,setCustomDays]=useState("");
  const [subForm,setSubForm]=useState({paymentStatus:"PENDING",subscriptionStartDate:"",subscriptionEndDate:""});
  const [busy,setBusy]=useState(false);
  const [resetAccount,setResetAccount]=useState(null);

  function load(){
    setLoading(true); setError("");
    api.admin.getUser(id).then(d=>{
      setData(d);
      setSubForm({
        paymentStatus: d.user.paymentStatus,
        subscriptionStartDate: d.user.subscriptionStartDate ? d.user.subscriptionStartDate.slice(0,10) : "",
        subscriptionEndDate: d.user.subscriptionEndDate ? d.user.subscriptionEndDate.slice(0,10) : ""
      });
    }).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  }
  useEffect(()=>{load()},[id]);
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(fn, successMsg) {
    setBusy(true); setError("");
    try { await fn(); notify("success", successMsg); load(); }
    catch (e) { setError(e.message); notify("error", e.message); }
    finally { setBusy(false); }
  }

  async function runConfirm() {
    if (!confirmAction) return;
    setBusy(true);
    try { await confirmAction.run(); notify("success", confirmAction.successMsg); setConfirmAction(null); load(); }
    catch (e) { notify("error", e.message); setConfirmAction(null); }
    finally { setBusy(false); }
  }

  const u = data?.user;

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-panel detail-panel" role="dialog" aria-modal="true" aria-label={u ? u.name : "User details"} onClick={e=>e.stopPropagation()}>
      <div className="modal-head"><h3>{u ? u.name : "User details"}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
      {loading ? <Empty text="Loading user..."/> : !u ? <div className="alert error">{error}</div> : <>
        {error && <div className="alert error">{error}</div>}
        <div className="detail-grid">
          <section>
            <h4>Account</h4>
            <dl>
              <dt>User ID</dt><dd>{u.username}</dd>
              <dt>Name</dt><dd>{u.name}</dd>
              <dt>Email</dt><dd>{u.email||"—"}</dd>
              <dt>Status</dt><dd><Badge tone={accountStatusTone(u.accountStatus)}>{u.accountStatus}</Badge></dd>
              <dt>Created</dt><dd>{fmtDateTime(u.createdAt)}</dd>
              <dt>Created by</dt><dd>{u.createdBy?.username||"—"}</dd>
            </dl>
          </section>
          <section>
            <h4>Subscription</h4>
            <dl>
              <dt>Payment</dt><dd><Badge tone={paymentStatusTone(u.paymentStatus)}>{u.paymentStatus}</Badge></dd>
              <dt>Payment ID</dt><dd>{u.paymentId||"—"}</dd>
              <dt>Start</dt><dd>{fmtDate(u.subscriptionStartDate)}</dd>
              <dt>Expiry</dt><dd>{fmtDate(u.subscriptionEndDate)}</dd>
              <dt>Days remaining</dt><dd>{daysRemaining(u)}</dd>
              <dt>Status</dt><dd><Badge tone={subscriptionTone(u.subscriptionStatus)}>{u.subscriptionStatus.replace("_"," ")}</Badge></dd>
            </dl>
          </section>
          <section>
            <h4>Login &amp; sessions</h4>
            <dl><dt>Last login</dt><dd>{fmtDateTime(u.lastLoginAt)}</dd></dl>
            <div className="session-list">
              {data.sessions.length ? data.sessions.map(s=><div className="session-row" key={s.id}>
                <Badge tone={s.status==="ACTIVE"?"info":s.status==="REVOKED"?"bad":"neutral"}>{s.status}</Badge>
                <div>
                  <small>{s.userAgent||"Unknown device"}{s.ipAddress?` · ${s.ipAddress}`:""}</small>
                  <small className="muted">Created {fmtDateTime(s.createdAt)} · Last active {fmtDateTime(s.lastActiveAt)}</small>
                </div>
              </div>) : <p className="muted">No sessions yet.</p>}
            </div>
          </section>
        </div>

        <h4>Recent login attempts</h4>
        <div className="session-list">
          {data.loginAttempts?.length ? data.loginAttempts.map(a=><div className="session-row" key={a.id}>
            <Badge tone={a.success?"good":"bad"}>{a.success?"Success":"Failed"}</Badge>
            <div>
              <small>{loginAttemptReasonLabel(a.reason)}{a.ipAddress?` · ${a.ipAddress}`:""}</small>
              <small className="muted">{fmtDateTime(a.createdAt)}</small>
            </div>
          </div>) : <p className="muted">No login attempts recorded yet.</p>}
        </div>

        <h4>Actions</h4>
        <div className="detail-actions">
          {u.accountStatus!=="ACTIVE" && <button className="secondary" disabled={busy} onClick={()=>act(()=>api.admin.setStatus(u.id,"ACTIVE"),"Account activated")}>Activate</button>}
          {u.accountStatus!=="BLOCKED" && <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Block this user?",message:`${u.username} will immediately lose access and be signed out of any active session.`,label:"Block user",danger:true,successMsg:"User blocked",run:()=>api.admin.setStatus(u.id,"BLOCKED")})}>Block</button>}
          {u.accountStatus!=="SUSPENDED" && <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Suspend this user?",message:`${u.username} will immediately lose access and be signed out of any active session.`,label:"Suspend user",danger:true,successMsg:"User suspended",run:()=>api.admin.setStatus(u.id,"SUSPENDED")})}>Suspend</button>}
          <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Force logout?",message:`Any active session for ${u.username} will be revoked immediately.`,label:"Force logout now",danger:true,successMsg:"Sessions revoked",run:()=>api.admin.revokeSessions(u.id)})}>Force logout</button>
          <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Reset password?",message:`A new temporary password will be generated for ${u.username} and all their sessions will be signed out.`,label:"Reset password now",danger:false,successMsg:"Password reset",run:async()=>{const d=await api.admin.resetPassword(u.id,"");setResetAccount({username:u.username,password:d.temporaryPassword})}})}>Reset password</button>
        </div>

        <h4>Renew subscription</h4>
        <div className="renew-row">
          {[30,60,90].map(d=><button key={d} className="secondary" disabled={busy} onClick={()=>act(()=>api.admin.renew(u.id,d), `Renewed for ${d} days`)}>+{d} days</button>)}
          <input type="number" min="1" placeholder="Custom days" aria-label="Custom number of days" value={customDays} onChange={e=>setCustomDays(e.target.value)}/>
          <button className="secondary" disabled={busy||!customDays} onClick={()=>act(()=>api.admin.renew(u.id,Number(customDays)), `Renewed for ${customDays} days`)}>Apply</button>
        </div>

        <h4>Change subscription</h4>
        <form className="admin-create-form" onSubmit={e=>{e.preventDefault();act(()=>api.admin.setSubscription(u.id,{paymentStatus:subForm.paymentStatus,subscriptionStartDate:subForm.subscriptionStartDate||undefined,subscriptionEndDate:subForm.subscriptionEndDate||undefined}),"Subscription updated")}}>
          <label>Payment status<select value={subForm.paymentStatus} onChange={e=>setSubForm({...subForm,paymentStatus:e.target.value})}>
            <option value="PENDING">Pending</option><option value="PAID">Paid</option><option value="FAILED">Failed</option><option value="REFUNDED">Refunded</option>
          </select></label>
          <label>Start date<input type="date" value={subForm.subscriptionStartDate} onChange={e=>setSubForm({...subForm,subscriptionStartDate:e.target.value})}/></label>
          <label>Expiry date<input type="date" value={subForm.subscriptionEndDate} onChange={e=>setSubForm({...subForm,subscriptionEndDate:e.target.value})}/></label>
          <button className="primary" disabled={busy}>Save subscription</button>
        </form>
      </>}
    </div>
    <ConfirmDialog open={!!confirmAction} title={confirmAction?.title} message={confirmAction?.message} confirmLabel={confirmAction?.label} danger={confirmAction?.danger} busy={busy} onConfirm={runConfirm} onCancel={()=>setConfirmAction(null)}/>
    {resetAccount && <PasswordResetModal account={resetAccount} onClose={()=>setResetAccount(null)}/>}
  </div>
}

function testSessionStatusTone(s) { return s==="COMPLETED"?"good":s==="EXPIRED"?"bad":s==="ABANDONED"?"neutral":"info" }

export function AdminTestSessions() {
  const [sessions,setSessions]=useState([]);
  const [total,setTotal]=useState(0);
  const [totalPages,setTotalPages]=useState(1);
  const [page,setPage]=useState(1);
  const [status,setStatus]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [detailId,setDetailId]=useState(null);

  function load(pageArg) {
    setLoading(true); setError("");
    api.admin.testSessions.list({ page: pageArg||page, limit:20, status })
      .then(d=>{setSessions(d.testSessions);setTotal(d.total);setTotalPages(d.totalPages);setPage(d.page)})
      .catch(e=>setError(e.message))
      .finally(()=>setLoading(false));
  }
  useEffect(()=>{load(1)},[status]);

  return <div>
    <div className="panel-head">
      <div><h3>Mock test attempts</h3><p className="muted">{total} total</p></div>
    </div>
    {error && <div className="alert error">{error}</div>}
    <div className="filter-bar">
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="COMPLETED">Completed</option>
        <option value="EXPIRED">Expired</option>
        <option value="ABANDONED">Abandoned</option>
      </select>
    </div>
    {loading ? <SkeletonRows count={8}/> : !sessions.length ? <Empty text="No mock test attempts match these filters."/> : <>
      <div className="table-wrap"><table><thead><tr>
        <th>Student</th><th>Status</th><th>Score</th><th>Pending AI</th><th>Started</th><th>Submitted</th><th>Expires</th><th>Actions</th>
      </tr></thead><tbody>
        {sessions.map(s=><tr key={s._id}>
          <td><b>{s.user?.username||"—"}</b></td>
          <td><Badge tone={testSessionStatusTone(s.status)}>{s.status}</Badge></td>
          <td>{s.totalScore}/{s.totalMaxScore}</td>
          <td>{s.pendingSubjective ? <Badge tone="warn">Pending</Badge> : "—"}</td>
          <td>{fmtDateTime(s.startedAt)}</td>
          <td>{fmtDateTime(s.submittedAt)}</td>
          <td>{fmtDateTime(s.expiresAt)}</td>
          <td><button className="text-button" onClick={()=>setDetailId(s._id)}>View</button></td>
        </tr>)}
      </tbody></table></div>
      <div className="pager">
        <button className="secondary" disabled={page<=1} onClick={()=>load(page-1)}>‹ Previous</button>
        <span className="muted">Page {page} of {totalPages} · {total} attempts</span>
        <button className="secondary" disabled={page>=totalPages} onClick={()=>load(page+1)}>Next ›</button>
      </div>
    </>}
    {detailId && <AdminTestSessionDetail id={detailId} onClose={()=>setDetailId(null)}/>}
  </div>
}

function AdminTestSessionDetail({id, onClose}) {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    setLoading(true); setError("");
    api.admin.testSessions.get(id).then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[id]);
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const s = data?.testSession;

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-panel detail-panel" role="dialog" aria-modal="true" aria-label={s ? `${s.user?.username}'s mock attempt` : "Mock attempt"} onClick={e=>e.stopPropagation()}>
      <div className="modal-head"><h3>{s ? `${s.user?.username}'s mock attempt` : "Mock attempt"}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button></div>
      {loading ? <Empty text="Loading attempt..."/> : !s ? <div className="alert error">{error}</div> : <>
        <div className="mock-detail-summary">
          <Badge tone={testSessionStatusTone(s.status)}>{s.status}</Badge>
          <span className="score-pill">{s.totalScore}/{s.totalMaxScore}</span>
          <span className="muted">Started {fmtDateTime(s.startedAt)}</span>
        </div>
        <div className="mock-detail-list">
          {data.results.length ? data.results.map(r=><MockResultRow key={r._id} r={r}/>) : <p className="muted">No answers have been submitted in this attempt yet.</p>}
        </div>
      </>}
    </div>
  </div>;
}

// The one and only gate for the admin surface (there is a single /admin route today — the
// Users/Questions/Test Sessions tabs inside it are React state, not separate routes, so there is
// nothing nested left to separately guard). The role checked here is req.user.role as returned by
// the server at login/refresh — never anything derived client-side. A non-admin is never shown
// the Admin component itself, not even for a frame; they're redirected immediately, with a
// one-time notice (read by Dashboard) so the redirect is visible, not silent.
function AdminRoute({ user, children }) {
  if (user.role !== "admin") {
    sessionStorage.setItem("pte_access_denied_notice", "Access denied — this account does not have admin permissions.");
    return <Navigate to="/dashboard" replace/>;
  }
  return children;
}

const PRACTICE_TASK_COMPONENTS = { speaking: SpeakingTaskModule, writing: WritingTaskModule, reading: ReadingTask, listening: ListeningTask };

export default function App() {
  const auth=useAuth();
  const { theme, toggleTheme } = useTheme();
  if(!auth.user) return <Routes><Route path="*" element={<Auth save={auth.save} theme={theme} toggleTheme={toggleTheme}/>}/></Routes>;
  return <Layout user={auth.user} logout={auth.logout} theme={theme} toggleTheme={toggleTheme}><Routes>
    <Route path="/" element={<Navigate to={auth.user.role==="admin"?"/admin":"/dashboard"}/>}/>
    <Route path="/dashboard" element={<DashboardPage user={auth.user}/>}/>
    <Route path="/practice" element={<PracticeHubPage/>}/>
    <Route path="/speaking" element={<PracticePage section="speaking" taskComponents={PRACTICE_TASK_COMPONENTS}/>}/>
    <Route path="/writing" element={<PracticePage section="writing" taskComponents={PRACTICE_TASK_COMPONENTS}/>}/>
    <Route path="/reading" element={<PracticePage section="reading" taskComponents={PRACTICE_TASK_COMPONENTS}/>}/>
    <Route path="/listening" element={<PracticePage section="listening" taskComponents={PRACTICE_TASK_COMPONENTS}/>}/>
    <Route path="/mock" element={<MockPage/>}/>
    <Route path="/plan" element={<Plan/>}/>
    <Route path="/history" element={<HistoryPage/>}/>
    <Route path="/profile" element={<ProfilePage user={auth.user}/>}/>
    <Route path="/admin" element={<AdminRoute user={auth.user}><AdminPage/></AdminRoute>}/>
    <Route path="*" element={<Navigate to="/dashboard"/>}/>
  </Routes></Layout>
}
