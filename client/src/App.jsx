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
import PracticePage from "./practice/Practice.jsx";
import PracticeHubPage from "./pages/PracticeHub.jsx";
import DashboardPage from "./pages/Dashboard.jsx";
import ProfilePage from "./pages/Profile.jsx";
import MockPage from "./pages/Mock.jsx";
import HistoryPage from "./pages/History.jsx";
import AdminPage from "./pages/Admin.jsx";
import { ReadingTask } from "./practice/Reading.jsx";
import { ListeningTask } from "./practice/Listening.jsx";
import SpeakingTaskModule from "./practice/Speaking.jsx";
import WritingTaskModule from "./practice/Writing.jsx";
import { Badge, Page } from "./components/common.jsx";
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
    <div className="auth-visual"><div className="brand large"><span className="brand-mark" aria-hidden="true">P</span><span><span>PTE CORE</span> AI</span></div><h1>Practice smarter.<br/>Reach your target score.</h1><p>One workspace for speaking, writing, reading, listening, mock tests and personalized AI feedback.</p><div className="auth-features"><div className="auth-feature"><CheckCircle2 size={16}/> All four PTE sections, one practice library</div><div className="auth-feature"><CheckCircle2 size={16}/> Objective scoring for every reading/listening task</div><div className="auth-feature"><CheckCircle2 size={16}/> Full-length mock tests with a real practice report</div></div><div className="visual-card"><Sparkles size={20}/><b>AI-powered practice</b><span>Track every attempt and understand exactly what to improve.</span></div></div>
    <div className="auth-card"><div className="brand"><span className="brand-mark" aria-hidden="true">P</span><span><span>PTE CORE</span> AI</span></div><h2>Welcome back</h2><p className="muted">Sign in with the User ID and password provided by your administrator.</p><div className="alert notice"><AlertCircle size={17}/><span><b>⚠️ One Device &amp; One Browser Policy</b><br/>Your account is restricted to one device and one browser. Please log in using the device and browser you intend to use for your regular PTE practice.</span></div>{notice && <div className="alert error"><AlertCircle size={17}/>{notice}</div>}{error && <div className="alert error"><AlertCircle size={17}/>{error}</div>}<form onSubmit={submit}><label>User ID<input required autoCapitalize="none" autoCorrect="off" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="e.g. pte001"/></label><label>Password<div className="password-field"><input required type={showPassword ? "text" : "password"} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Your password"/><button type="button" className="password-toggle" onClick={()=>setShowPassword(s=>!s)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} tabIndex={-1}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label><button className="primary full" disabled={busy}>{busy ? "Signing in..." : "Sign In"}</button></form><p className="muted" style={{marginTop:18}}>Don't have an account? Contact your administrator to get access.</p></div>
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
      { label: "Test Sessions", group: "Admin", to: "/admin?tab=testSessions" }
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
        <div className="brand"><span className="brand-mark" aria-hidden="true">P</span><span><span>PTE CORE</span> AI</span>{inAdminSection && <Badge tone="info">Admin Mode</Badge>}</div>
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

export function ToastHost({toasts,dismiss}) {
  if(!toasts.length) return null;
  return <div className="toast-host" role="status" aria-live="polite">{toasts.map(t=><button key={t.id} type="button" className={`toast toast-${t.type}`} onClick={()=>dismiss(t.id)}>{t.message}<span className="sr-only"> — dismiss</span></button>)}</div>
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
