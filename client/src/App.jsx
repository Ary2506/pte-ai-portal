import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  Activity, BarChart3, BookOpen, Brain, ChevronDown, Clock3, Headphones,
  Home, LogOut, Menu, Mic, PenLine, Play, Settings, Sparkles, Target,
  Trophy, UserRound, Volume2, X, CheckCircle2, AlertCircle, Shield, ChevronLeft, ChevronRight,
  Eye, EyeOff
} from "lucide-react";
import { api, forceLogout } from "./api.js";
import { Result, ObjectiveResult, ReadingTask, ListeningTask } from "./PracticeObjective.jsx";
import { AdminQuestionsPanel } from "./AdminQuestions.jsx";
import { PRACTICE_SECTIONS, SECTION_LABELS, PRACTICE_TASKS, MORE_ITEMS, supportedTasksFor, taskInfo } from "./practiceTaskRegistry.js";

const SECTION_ICONS = { speaking: Mic, writing: PenLine, reading: BookOpen, listening: Headphones };
const SECTION_DESCRIPTIONS = {
  speaking: "Read aloud, describe images and answer spoken prompts with instant AI feedback.",
  writing: "Summarize text and write essays scored on structure, grammar and content.",
  reading: "Fill blanks, reorder paragraphs and answer questions with objective scoring.",
  listening: "Summarize, transcribe and answer questions from real audio passages."
};
const PRACTICE_PATHS = new Set(["/practice", "/speaking", "/writing", "/reading", "/listening"]);
const MORE_PATHS = new Set(MORE_ITEMS.filter(m => m.to).map(m => m.to));

const SUBSCRIPTION_EXPIRED_MESSAGE = "Your 30-day subscription has expired. Please contact the administrator to renew your access.";
// setTimeout's delay is coerced to a 32-bit signed int — anything past this fires almost
// immediately instead of waiting. A subscription is realistically never more than ~24 days
// out from this cap, so a single timer is enough; no rescheduling loop is needed.
const MAX_TIMEOUT_MS = 2_147_483_647;

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

  // UX only: proactively signs a student out the instant their cached subscription end date
  // passes, so a tab left open doesn't keep looking "logged in" after expiry. This can never
  // grant or extend access — it only ever ends a session early, using the server-issued
  // subscriptionEndDate as-is. The actual authorization boundary is the backend's
  // requireActiveSubscription middleware, checked fresh on every request regardless of this
  // timer. Admins are never subject to it. Reuses the exact same clear-and-redirect flow
  // (forceLogout) that a rejected API response already triggers — not a second mechanism.
  useEffect(() => {
    if (!user || user.role === "admin") return;
    if (!user.subscriptionEndDate) return;

    // EXPIRED (or already past its end date) means the cached copy is stale — sign out right
    // away rather than only when a live ACTIVE session ticks past its own expiry.
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

function Auth({ save }) {
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
      // The role used here is exactly what the server just returned in the signin response
      // (server/src/utils/subscription.js's publicUser(), sourced from the User document) —
      // never inferred from the submitted username or any other client-side guess.
      navigate(data.user.role === "admin" ? "/admin" : "/dashboard");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return <div className="auth-page">
    <div className="auth-visual">
      <div className="brand large"><span>PTE</span> AI</div>
      <h1>Practice smarter.<br/>Reach your target score.</h1>
      <p>One workspace for speaking, writing, reading, listening, mock tests and personalized AI feedback.</p>
      <div className="auth-features">
        <div className="auth-feature"><CheckCircle2 size={16}/> All four PTE sections, one practice library</div>
        <div className="auth-feature"><CheckCircle2 size={16}/> Objective scoring for every reading/listening task</div>
        <div className="auth-feature"><CheckCircle2 size={16}/> Full-length mock tests with a real practice report</div>
      </div>
      <div className="visual-card"><Sparkles size={20}/><b>AI-powered practice</b><span>Track every attempt and understand exactly what to improve.</span></div>
    </div>
    <div className="auth-card">
      <div className="brand"><span>PTE</span> AI</div>
      <h2>Welcome back</h2>
      <p className="muted">Sign in with the User ID and password provided by your administrator.</p>
      <div className="alert notice">
        <AlertCircle size={17}/>
        <span><b>⚠️ One Device &amp; One Browser Policy</b><br/>Your account is restricted to one device and one browser. Please log in using the device and browser you intend to use for your regular PTE practice.</span>
      </div>
      {notice && <div className="alert error"><AlertCircle size={17}/>{notice}</div>}
      {error && <div className="alert error"><AlertCircle size={17}/>{error}</div>}
      <form onSubmit={submit}>
        <label>User ID<input required autoCapitalize="none" autoCorrect="off" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="e.g. pte001"/></label>
        <label>Password
          <div className="password-field">
            <input required type={showPassword ? "text" : "password"} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Your password"/>
            <button type="button" className="password-toggle" onClick={()=>setShowPassword(s=>!s)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} tabIndex={-1}>
              {showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}
            </button>
          </div>
        </label>
        <button className="primary full" disabled={busy}>{busy ? "Signing in..." : "Sign In"}</button>
      </form>
      <p className="muted" style={{marginTop:18}}>Don't have an account? Contact your administrator to get access.</p>
    </div>
  </div>
}

// Shared by PteMegaMenu and MoreMenu — a small dropdown/flyout that opens on click, closes on a
// second click / outside click / Escape, and returns focus to its own trigger on Escape. No
// focus-trap (the panel's contents are a handful of simple links, not a modal workflow), but
// every explicit Part 3 behavior (click to open/close, outside click, Escape, aria-expanded) is
// implemented here once and reused by both menus rather than duplicated.
function useDropdown() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    }
    function onPointerDown(e) {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return { open, setOpen, panelRef, triggerRef };
}

// The PTE Practice mega-menu (Part 3). Renders one markup tree that behaves as a desktop
// 4-column flyout grid or a mobile full-width accordion (Part 24) purely via CSS media query
// (matching this file's existing responsive pattern, e.g. .mobile-menu/.mobile-close) rather
// than JS viewport detection, so there is no duplicated markup or client/server mismatch risk.
function PteMegaMenu({ onNavigate }) {
  const { open, setOpen, panelRef, triggerRef } = useDropdown();
  const [accordionOpen, setAccordionOpen] = useState(() => new Set());
  const navigate = useNavigate();
  const location = useLocation();
  const active = PRACTICE_PATHS.has(location.pathname);

  function go(section, slug) {
    setOpen(false);
    onNavigate?.();
    navigate(slug ? `/${section}?type=${slug}` : `/${section}`);
  }
  function toggleAccordion(section) {
    setAccordionOpen(prev => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });
  }

  return <div className="mega-menu-wrap">
    <button
      ref={triggerRef}
      className={active ? "nav-item active" : "nav-item"}
      aria-expanded={open}
      aria-haspopup="true"
      aria-controls="pte-practice-panel"
      onClick={() => setOpen(o => !o)}
    >
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
function AdminSidebarNav({ onNavigate }) {
  return <>
    <NavLink to="/admin" end className={({isActive})=>isActive?"nav-item active":"nav-item"} onClick={onNavigate}><Shield size={18}/><span>Admin Dashboard</span></NavLink>
    <NavLink to="/dashboard" className="nav-item" onClick={onNavigate}><Home size={18}/><span>Student Site</span></NavLink>
  </>;
}
function StudentSidebarNav({ user, onNavigate }) {
  return <>
    <NavLink to="/dashboard" className={({isActive})=>isActive?"nav-item active":"nav-item"} onClick={onNavigate}><Home size={18}/><span>Dashboard</span></NavLink>
    <PteMegaMenu onNavigate={onNavigate}/>
    <MoreMenu onNavigate={onNavigate}/>
    {user?.role === "admin" && <NavLink to="/admin" className="nav-item admin-panel-link" onClick={onNavigate}><Shield size={18}/><span>Admin Panel</span></NavLink>}
  </>;
}

// Real destinations only — every entry navigates somewhere that actually exists and works
// (Part 33: no decorative search). Practice tasks are pulled from the same registry the mega-menu
// and Practice Hub already use, so this can never list a task that isn't genuinely supported.
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
    <span>⌕</span>
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

function Layout({ user, logout, children }) {
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
        <div className="brand"><span>PTE</span> AI{inAdminSection && <Badge tone="info">Admin Mode</Badge>}</div>
        <button className="icon-btn mobile-close" onClick={closeMobile}><X size={19}/></button>
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
          <button className="icon-btn mobile-menu" onClick={()=>setMobile(true)}><Menu size={21}/></button>
          <span className="topbar-breadcrumb"><b>{topbarLabel(location.pathname)}</b></span>
        </div>
        <HeaderSearch user={user}/>
        <div className="top-user"><div className="avatar">{user?.name?.slice(0,1).toUpperCase()}</div><div><b>{user?.name}</b><small>{subscriptionLabel(user)}</small></div><ChevronDown size={15}/></div>
      </header>
      <div className="content">{children}</div>
    </main>
  </div>
}

// Real skeleton placeholders (Part 25) — shown while a request is actually in flight, replaced
// the instant real data arrives. Never a substitute for real content, never shown once data (or
// a genuine empty/error state) is known.
function SkeletonCards({ count = 4, gridClass = "score-grid" }) {
  return <div className={gridClass} aria-hidden="true">{Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton skeleton-card"/>)}</div>;
}
function SkeletonRows({ count = 5 }) {
  return <div aria-hidden="true">{Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton skeleton-row"/>)}</div>;
}

function fmtLongDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" }) : "—";
}

// Reads only fields the server already put on the cached user object (from /auth/signin or
// /auth/me) — never computes validity independently. subscriptionStatus itself is server-derived
// (see server/src/utils/subscription.js); this only formats it for display.
function SubscriptionCard({ user }) {
  if (!user || user.role === "admin") return null;
  const status = user.subscriptionStatus;

  if (status === "EXPIRED") {
    return <div className="panel subscription-card subscription-card-expired">
      <div className="subscription-card-head"><h3>Subscription</h3><Badge tone="bad">EXPIRED</Badge></div>
      <p className="subscription-card-message">Your 30-day subscription has expired.</p>
      <p className="muted">Please contact the administrator for renewal.</p>
    </div>;
  }

  if (status !== "ACTIVE") {
    return <div className="panel subscription-card">
      <div className="subscription-card-head"><h3>Subscription</h3><Badge tone="warn">NOT ACTIVATED</Badge></div>
      <p className="muted">Your subscription has not been activated yet. Please contact the administrator.</p>
    </div>;
  }

  const daysLeft = user.subscriptionEndDate ? Math.max(0, Math.ceil((new Date(user.subscriptionEndDate) - Date.now()) / 86400000)) : null;
  return <div className="panel subscription-card">
    <div className="subscription-card-head"><h3>Subscription</h3><Badge tone="good">ACTIVE</Badge></div>
    <div className="subscription-card-grid">
      <div><span>Started</span><b>{fmtLongDate(user.subscriptionStartDate)}</b></div>
      <div><span>Expires</span><b>{fmtLongDate(user.subscriptionEndDate)}</b></div>
      <div><span>Days remaining</span><b>{daysLeft ?? "—"}</b></div>
    </div>
  </div>;
}

// Reuses the exact subscription-card layout/classes (head + 3-column grid) — no new CSS.
function StreakCard({ streak }) {
  if (!streak) return null;
  const { currentStreak, longestStreak, learnedToday, lastLearningDate } = streak;
  return <div className="panel subscription-card">
    <div className="subscription-card-head">
      <h3>🔥 {currentStreak} Day Streak</h3>
      <Badge tone={learnedToday ? "good" : "warn"}>{learnedToday ? "Learned today" : "Not yet today"}</Badge>
    </div>
    <div className="subscription-card-grid">
      <div><span>Current streak</span><b>{currentStreak} day{currentStreak === 1 ? "" : "s"}</b></div>
      <div><span>Longest streak</span><b>{longestStreak} day{longestStreak === 1 ? "" : "s"}</b></div>
      <div><span>Last activity</span><b>{lastLearningDate || "—"}</b></div>
    </div>
    <p className="muted" style={{marginTop:12}}>{learnedToday ? "Keep learning every day!" : "Complete a practice activity today to keep your streak going."}</p>
  </div>;
}

const WEEKDAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function WeeklyActivity({ days }) {
  if (!days?.length) return null;
  return <div className="panel" style={{marginBottom:18}}>
    <h3 style={{marginTop:0}}>This Week</h3>
    <div style={{display:"flex",gap:10,justifyContent:"space-between"}}>
      {days.map(d => {
        const label = WEEKDAY_LABELS[new Date(`${d.date}T00:00:00Z`).getUTCDay()];
        return <div key={d.date} style={{textAlign:"center"}}>
          <small className="muted" style={{display:"block",marginBottom:4}}>{label}</small>
          <span style={{fontSize:18}} aria-label={d.active ? "Learned" : "No activity"}>{d.active ? "✅" : "❌"}</span>
        </div>;
      })}
    </div>
  </div>;
}

function Dashboard({ user }) {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  // Read once and cleared immediately — set only by AdminRoute when a non-admin was just
  // redirected away from /admin, so the denial is visible instead of a silent bounce, but never
  // reappears on an ordinary visit to the dashboard.
  const [accessDenied,setAccessDenied]=useState(() => {
    const n = sessionStorage.getItem("pte_access_denied_notice");
    sessionStorage.removeItem("pte_access_denied_notice");
    return n || "";
  });
  useEffect(()=>{api.dashboard().then(setData).catch(()=>{}).finally(()=>setLoading(false));},[]);
  const stats=data?.stats;
  return <Page title="Welcome back 👋" subtitle="Keep practicing to achieve your target PTE score.">
    {accessDenied && <div className="alert error"><AlertCircle size={17}/>{accessDenied}</div>}
    <SubscriptionCard user={user}/>
    <StreakCard streak={data?.streak}/>
    <WeeklyActivity days={data?.weeklyActivity}/>
    <div className="hero-row"><div><span className="eyebrow">YOUR TARGET</span><h1>{stats?.targetScore || 79}</h1><span className="muted">Overall target score</span></div><NavLink className="primary" to="/speaking"><Play size={17}/> Continue Practice</NavLink></div>
    {loading ? <SkeletonCards count={5}/> : <div className="score-grid">
      <div className="score-card score-card-ring">
        <span>Overall Score</span>
        <ScoreRing value={stats?.overall || 0} max={90}/>
        <small>Practice average</small>
      </div>
      {(data?.bySection||[]).map(x=><ScoreCard key={x.section} title={x.section} value={x.score} sub="Average score"/>)}
    </div>}
    <div className="two-col">
      <section className="panel"><div className="panel-head"><div><h3>Your Progress</h3><p className="muted">Performance by section</p></div><span className="chip">Live</span></div>{loading ? <SkeletonRows count={4}/> : <div className="bars">{(data?.bySection||[]).map(x=><div className="bar-row" key={x.section}><span>{x.section}</span><div><i style={{width:`${Math.min(100,x.score)}%`}}/></div><b>{x.score}</b></div>)}</div>}</section>
      <section className="panel"><div className="panel-head"><div><h3>Recent Practice</h3><p className="muted">Latest submissions</p></div><NavLink to="/history" className="link">View all</NavLink></div>{loading ? <SkeletonRows count={3}/> : (data?.recent||[]).length ? data.recent.map(s=><div className="recent" key={s._id}><div className="recent-icon"><Activity size={16}/></div><div><b>{s.type}</b><small>{s.section}</small></div><strong>{s.score}</strong></div>) : <Empty text="Your practice attempts will appear here."/>}</section>
    </div>
    <h2 className="section-title">Recommended for you</h2>
    <div className="feature-grid">
      <Feature title="Practice Read Aloud" icon={<Mic/>} text="Improve your pronunciation and fluency." to="/speaking"/>
      <Feature title="Write an Essay" icon={<PenLine/>} text="Improve structure and writing skills." to="/writing"/>
      <Feature title="Full Mock Test" icon={<Trophy/>} text="Simulate the real test experience." to="/mock"/>
      <Feature title="Personal Study Plan" icon={<Target/>} text="Focus on your weakest areas." to="/plan"/>
    </div>
  </Page>
}

function ScoreCard({title,value,sub}) { return <div className="score-card"><span>{title}</span><strong>{value}</strong><small>{sub}</small></div> }

// Real circular progress (Part 14) — driven entirely by the student's actual average score,
// never a decorative or fixed fill.
function ScoreRing({ value, max = 90 }) {
  const pct = max ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const r = 45, c = 2 * Math.PI * r;
  return <div className="progress-ring sm">
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <circle className="track" cx="50" cy="50" r={r}/>
      <circle className="fill" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}/>
    </svg>
    <div className="progress-ring-label">{value}</div>
  </div>;
}

// One task card (Part 4). `state` is derived purely from real data — never hardcoded — so a
// task never claims to be practicable unless the backend both supports the type AND currently
// has at least one active question for it (Phase 15/16's known content gaps: reading/listening
// mcq-multiple and hard difficulty are exactly why this second check exists, not just the first).
// A single task row (one per PTE task type), styled as a compact list rather than a card grid —
// each row carries only real, verified signals: "AI Score" only when this task actually gets AI
// evaluation (never invented weighting/percentages we have no real data for), "No content yet"
// only when the type is genuinely backend-supported but the question bank has zero active
// questions for it (checked live against GET /api/questions, never assumed), and "Coming Soon"
// only when the type has no backend support at all.
function PracticeTaskRow({ section, task, hasContent, onStart }) {
  const startable = task.supported && hasContent;
  let badge = null;
  if (!task.supported) badge = <span className="practice-row-badge soon">Coming Soon</span>;
  else if (!hasContent) badge = <span className="practice-row-badge empty">No content yet</span>;
  else if (task.hasAI) badge = <span className="practice-row-badge ai">AI Score</span>;

  const content = <><span>{task.label}</span>{badge}</>;
  return startable
    ? <button type="button" className="practice-row" onClick={() => onStart(section, task.slug)}>{content}</button>
    : <span className="practice-row disabled" aria-disabled="true">{content}</span>;
}

// /practice — the full Practice Hub (Part 4). Loads question metadata once per section (4
// requests total, not one per task type and never the mega-menu's job) purely to know which
// supported task types actually have content today — no audio, no full question bodies beyond
// what GET /api/questions already safely returns to a student.
function PracticeHub() {
  const navigate = useNavigate();
  const [available, setAvailable] = useState(null); // Set of "section:type" once loaded

  useEffect(() => {
    Promise.all(PRACTICE_SECTIONS.map(section => api.questions(section).then(d => ({ section, questions: d.questions })).catch(() => ({ section, questions: [] }))))
      .then(results => {
        const set = new Set();
        results.forEach(({ section, questions }) => questions.forEach(q => set.add(`${section}:${q.type}`)));
        setAvailable(set);
      });
  }, []);

  function start(section, slug) { navigate(`/${section}?type=${slug}`); }

  return <Page title="PTE Practice" subtitle="Practice every section, improve your skills, and understand your mistakes.">
    <div className="panel practice-hub-panel">
      <div className="exam-variant-toggle" role="tablist">
        <span className="exam-variant-tab active" role="tab" aria-selected="true">PTE Core</span>
        <span className="exam-variant-tab" role="tab" aria-selected="false" title="This portal's practice library isn't split by exam variant yet — the same available questions are shown for both.">PTE Academic / UKVI</span>
      </div>
      <div className="practice-columns">
        {PRACTICE_SECTIONS.map(section => {
          const SectionIcon = SECTION_ICONS[section];
          return <div className="practice-column" key={section}>
            <h3 className="practice-column-head"><span className="practice-column-icon"><SectionIcon size={15}/></span>{SECTION_LABELS[section]}</h3>
            <p className="practice-column-desc">{SECTION_DESCRIPTIONS[section]}</p>
            <div className="practice-column-list">
              {PRACTICE_TASKS[section].map(task => <PracticeTaskRow
                key={task.slug}
                section={section}
                task={task}
                hasContent={available ? available.has(`${section}:${task.slug}`) : false}
                onStart={start}
              />)}
            </div>
          </div>;
        })}
      </div>
      <div className="practice-more-section">
        <h3 className="practice-column-head">More</h3>
        <div className="practice-more-row">
          {MORE_ITEMS.map(m => m.to
            ? <NavLink key={m.key} to={m.to} className="practice-more-link">{m.label}</NavLink>
            : <span key={m.key} className="practice-more-link disabled" aria-disabled="true">{m.label}</span>
          )}
        </div>
      </div>
    </div>
  </Page>;
}
function Feature({title,text,icon,to}) { return <NavLink className="feature-card" to={to}><div className="feature-icon">{icon}</div><b>{title}</b><p>{text}</p><span>Start →</span></NavLink> }

function Page({title,subtitle,children,actions}) { return <><div className="page-head"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{actions}</div>{children}</> }

// Reads the desired-type slug straight from the URL (?type=) so the Practice Hub and the
// mega-menu can deep-link into a specific task — the existing /speaking|writing|reading|listening
// routes are reused as-is (Part 25: no new routes needed), only now search-param-aware. Falls
// back to this section's first supported task, matching the exact previous default behavior when
// no ?type= is present (so every existing test that renders e.g. "/speaking" unchanged still
// lands on the same default task).
function Practice({ section }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tasks = supportedTasksFor(section);
  const requestedSlug = searchParams.get("type");
  const [type, setType] = useState(() => tasks.find(t => t.slug === requestedSlug) || tasks[0]);

  useEffect(() => {
    const match = tasks.find(t => t.slug === requestedSlug);
    if (match && match.slug !== type?.slug) setType(match);
    // Only re-sync when the URL itself changes (e.g. a mega-menu deep link into an already-
    // mounted Practice) — a same-section tab click below manages `type` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, requestedSlug]);

  function selectType(t) {
    setType(t);
    setSearchParams(t.slug === tasks[0].slug ? {} : { type: t.slug });
  }

  return <Page title={SECTION_LABELS[section]} subtitle={`Practice ${section} tasks with timing, scoring and feedback.`}>
    <p className="muted" style={{marginTop:-14,marginBottom:16}}>PTE Practice &gt; {SECTION_LABELS[section]}{type ? ` > ${type.label}` : ""}</p>
    <div className="practice-tabs">{tasks.map(t=><button key={t.slug} className={type?.slug===t.slug?"tab active":"tab"} onClick={()=>selectType(t)}>{t.label}</button>)}</div>
    {type
      ? <PracticeTask section={section} label={type.label} slug={type.slug}/>
      : <Empty text="No practice questions available yet."/>}
  </Page>
}

// The question-picker shown before a multi-question task (only when there's genuinely more than
// one question to choose from — a single-question task skips straight to it, unchanged). "Done"
// is real, not decorative: it's derived from the student's own practice history (GET
// /submissions/history, already scoped server-side to this student and to standalone practice,
// never mock attempts), matching exactly which of these specific questions they've already
// submitted an answer for. No score/streak/bookmark/"Shadow" affordances are shown here — this
// portal has no real data or feature behind any of those, and inventing UI for them would be
// exactly the "fake functionality" this project has consistently avoided.
// "All / Undone / Done" — a real filter over real data (the student's own attempt history), not
// APEUni's "Mark"/"My Score"/"Shadowing" dropdowns, which this portal has no feature behind.
// Deliberately client-side only: the full list was already fetched, so filtering it needs no
// extra request and can't itself become a new source of truth that drifts from the real data.
const PROGRESS_FILTERS = [
  { key: "all", label: "All" },
  { key: "undone", label: "Undone" },
  { key: "done", label: "Done" }
];

// Search matches the same fields APEUni's own question search covers (title, and the question's
// own identifier) — never a fabricated "relevance" ranking, just a real case-insensitive
// substring match against real data already in memory (the full list was already fetched, so
// this needs no extra request). Matching the position number too (e.g. typing "4" finds "#4")
// mirrors how a student would actually try to jump to a specific numbered question.
function matchesSearch(q, i, term) {
  if (!term) return true;
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return q.title.toLowerCase().includes(needle) || q._id.toLowerCase().includes(needle) || String(i + 1) === needle;
}

function QuestionListView({ questions, progress, onSelect, section, label }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const doneCount = questions.filter(q => progress.has(q._id)).length;
  const undoneCount = questions.length - doneCount;
  const filterCounts = { all: questions.length, undone: undoneCount, done: doneCount };
  const rows = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => filter === "all" || (filter === "done") === progress.has(q._id))
    .filter(({ q, i }) => matchesSearch(q, i, search));
  const TaskIcon = SECTION_ICONS[section];

  return <div className="panel question-list-panel">
    {TaskIcon && <div className="question-list-banner">
      <span className="question-list-banner-icon"><TaskIcon size={18}/></span>
      <h2>{label}</h2>
    </div>}
    <div className="question-list-head">
      <div className="question-list-filters" role="tablist" aria-label="Filter by practice status">
        {PROGRESS_FILTERS.map(f => <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
          className={filter === f.key ? "question-list-filter active" : "question-list-filter"} onClick={() => setFilter(f.key)}>{f.label}<span className="question-list-filter-count">{filterCounts[f.key]}</span></button>)}
      </div>
      <div className="search question-list-search"><span>⌕</span><input placeholder="Search by title or question number..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search questions"/></div>
      <span className="muted">Done {doneCount}, Found {rows.length} question{rows.length === 1 ? "" : "s"}</span>
    </div>
    <div className="question-list">
      {rows.map(({ q, i }) => {
        const attempt = progress.get(q._id);
        return <button key={q._id} type="button" className="question-list-row" onClick={() => onSelect(i)}>
          <span className="question-row-number">#{i + 1}</span>
          <span className="question-list-title">{q.title}</span>
          {attempt
            ? <span className="question-row-status">
                {attempt.evaluationStatus === "FAILED"
                  ? <Badge tone="warn">Evaluation failed</Badge>
                  : <Badge tone="good"><CheckCircle2 size={12}/> Done · {attempt.score}/{attempt.maxScore}</Badge>}
              </span>
            : <Badge tone="neutral">Undone</Badge>}
        </button>;
      })}
      {!rows.length && <p className="muted" style={{padding:"14px 6px"}}>No questions match {search.trim() ? "your search" : "this filter"}.</p>}
    </div>
  </div>;
}

// The reusable multi-question practice session (Part 6/11/12 "Practice Multiple Questions"): the
// server already returns every active question for this section+type in one call — this just
// lets the student page through what was already fetched, entirely client-side. Each question is
// still submitted individually through the exact same existing task components/API, so nothing
// about scoring, ownership, or duplicate protection changes — this is navigation chrome only.
function PracticeTask({section,label,slug}) {
  const [questions,setQuestions]=useState([]);
  const [idx,setIdx]=useState(null); // null = showing the question list, not yet inside a question
  const [loading,setLoading]=useState(true);
  // Real content genuinely being empty and the request itself failing look identical to a
  // student unless tracked separately — this used to collapse both into the same "No practice
  // questions available yet." message. `error` is only ever set when the request itself rejects
  // (a real fetch/network failure), never for a normal response with zero items.
  const [error,setError]=useState(false);
  // questionId -> the student's own most recent full Submission for that question (history() is
  // already sorted newest-first server-side, so the first match kept per id is the latest
  // attempt) — the whole stored document (score/feedback/transcript/answer/...), not just a
  // summary, so a completed question can be reopened to show its real stored result (Phase 19,
  // Part 10) instead of AI ever being re-run just to view it.
  const [progress,setProgress]=useState(new Map());
  function load(){
    setLoading(true); setError(false);
    Promise.all([
      api.questions(section, slug),
      Promise.resolve(api.history()).catch(()=>({submissions:[]}))
    ]).then(([qData, hData])=>{
      const loadedQuestions = qData?.questions || [];
      const loadedSubmissions = hData?.submissions || [];
      const map = new Map();
      for (const s of loadedSubmissions) {
        const qid = s.question?._id;
        if (qid && !map.has(qid)) map.set(qid, s);
      }
      setQuestions(loadedQuestions);
      setProgress(map);
      // A single question is opened directly — no list step for something with nothing to pick
      // from. More than one always starts at the list, even if the student re-visits this exact
      // task later (browsing the list again is itself harmless and never re-triggers anything).
      setIdx(loadedQuestions.length === 1 ? 0 : null);
    }).catch(()=>setError(true))
      .finally(()=>setLoading(false));
  }
  useEffect(load,[section,slug]);

  if (loading) return <div className="panel question-list-panel"><SkeletonRows count={6}/></div>;
  if (error) return <div className="panel error-state">
    <AlertCircle size={30}/>
    <h4>Unable to load your questions</h4>
    <p>Please check your connection and try again.</p>
    <button className="secondary" onClick={load}>Retry</button>
  </div>;
  if (!questions.length) return <Empty text="No practice questions available yet."/>;

  if (idx === null) return <QuestionListView questions={questions} progress={progress} onSelect={setIdx} section={section} label={label}/>;

  const q=questions[idx];
  const existingResult = q ? progress.get(q._id) : null;
  const body = section==="speaking" ? <SpeakingTask key={q?._id} type={label} question={q} existingResult={existingResult}/>
    : section==="writing" ? <WritingTask key={q?._id} type={label} question={q} existingResult={existingResult}/>
    : section==="reading" ? <ReadingTask key={q?._id} question={q} existingResult={existingResult}/>
    : <ListeningTask key={q?._id} question={q} existingResult={existingResult}/>;

  return <div>
    {questions.length > 1 && <div className="mock-progress-bar" role="group" aria-label="Question navigation">
      <button className="text-button" style={{marginTop:0}} onClick={()=>setIdx(null)}><ChevronLeft size={15}/> Back to list</button>
      <span>Question {idx+1} / {questions.length}</span>
      <div style={{display:"flex",gap:8}}>
        <button className="secondary" onClick={()=>setIdx(i=>Math.max(0,i-1))} disabled={idx===0}><ChevronLeft size={15}/> Previous</button>
        <button className="secondary" onClick={()=>setIdx(i=>Math.min(questions.length-1,i+1))} disabled={idx===questions.length-1}>Next <ChevronRight size={15}/></button>
      </div>
    </div>}
    {body}
  </div>;
}

// UX-only cap matching each task's real PTE time budget — the browser stops the recording for
// the student. The server never sees or trusts a client-declared duration; durationSeconds is
// only ever a heuristic-evaluation input signal (see server/src/services/ai/evaluator.js), never
// a security or scoring boundary.
const SPEAKING_DURATION_LIMITS = { "read-aloud": 40, "repeat-sentence": 15, "describe-image": 40, "answer-short-question": 10 };
const DEFAULT_SPEAKING_DURATION_LIMIT = 40;

function SpeakingTask({type,question,testSessionId,onAnswered,existingResult}) {
  const [recording,setRecording]=useState(false), [seconds,setSeconds]=useState(0), [blob,setBlob]=useState(null), [transcript,setTranscript]=useState(""), [result,setResult]=useState(()=>existingResult||null), [error,setError]=useState(""), [busy,setBusy]=useState(false), [retrying,setRetrying]=useState(false);
  const recorder=useRef(null), chunks=useRef([]), timer=useRef(null), recognition=useRef(null), elapsedRef=useRef(0);
  const limit = SPEAKING_DURATION_LIMITS[question?.type] || DEFAULT_SPEAKING_DURATION_LIMIT;
  useEffect(()=>()=>clearInterval(timer.current),[]);
  // Guarded so a manual "Stop Recording" click and the auto-stop-at-limit tick can never both
  // run to completion — whichever happens first clears recorder.current, and the other becomes
  // a no-op, instead of MediaRecorder.stop() firing twice or a second onstop producing a second blob.
  function stop(){
    if(!recorder.current) return;
    clearInterval(timer.current);
    recorder.current.stop();
    recorder.current=null;
    recognition.current?.stop();
    recognition.current=null;
    setRecording(false);
  }
  function start() {
    setError(""); setResult(null); setBlob(null); setTranscript(""); chunks.current=[]; elapsedRef.current=0;
    navigator.mediaDevices?.getUserMedia({audio:true}).then(stream=>{
      const r=new MediaRecorder(stream); recorder.current=r;
      r.ondataavailable=e=>{if(e.data.size) chunks.current.push(e.data)};
      r.onstop=()=>{setBlob(new Blob(chunks.current,{type:"audio/webm"}));stream.getTracks().forEach(t=>t.stop())};
      r.start(); setRecording(true); setSeconds(0);
      // A plain ref counter (not the seconds state, which stays stale inside this closure) drives
      // the stop decision; setSeconds only ever updates the display.
      timer.current=setInterval(()=>{
        elapsedRef.current+=1;
        setSeconds(elapsedRef.current);
        if(elapsedRef.current>=limit) stop();
      },1000);
      const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(SR){const rec=new SR(); rec.continuous=true;rec.interimResults=true;rec.lang="en-US";rec.onresult=e=>{let t="";for(let i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript+" ";setTranscript(t.trim())};rec.start();recognition.current=rec;}
    }).catch(()=>setError("Microphone permission is required. Check your browser permissions and try again."));
  }
  async function submit(){if(!blob){setError("Record an answer first.");return} setBusy(true); setError(""); const f=new FormData();f.append("audio",blob,"speaking.webm");f.append("section","speaking");f.append("type",type);f.append("transcript",transcript);f.append("durationSeconds",seconds);if(question?._id)f.append("questionId",question._id);if(testSessionId)f.append("testSessionId",testSessionId);try{const d=await api.submit(f);setResult(d.submission);onAnswered?.(d.submission)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function retry(){setRetrying(true);setError("");try{setResult((await api.retryEvaluation(result._id)).submission)}catch(e){setError(e.message)}finally{setRetrying(false)}}
  const durationLabel = recording ? `${formatMMSS(seconds*1000)} / ${formatMMSS(limit*1000)}` : `Ready · limit ${formatMMSS(limit*1000)}`;
  return <div className="task-layout"><section className="panel task-main"><div className="task-meta"><span className="chip">{type}</span><span className={seconds>=limit?"speaking-duration-cap low":"speaking-duration-cap"}><Clock3 size={15}/> {durationLabel}</span></div><h2>{question?.title||type}</h2><p className="instruction">{question?.prompt||"Your speaking question will load from the practice library."}</p>{question?.imageUrl&&<img src={question.imageUrl} alt="" style={{maxWidth:"100%",borderRadius:9,margin:"12px 0"}}/>}{question?.audioUrl&&<audio className="audio" controls src={question.audioUrl}/>}<div className="record-box">{recording?<><div className="pulse"><Mic size={30}/></div><h3>Recording...</h3><div className="wave">{Array.from({length:36}).map((_,i)=><i key={i} style={{height:`${10+Math.random()*42}px`}}/>)}</div></>:<><div className="mic-circle"><Mic size={30}/></div><h3>Record your answer</h3><p className="muted">Speak naturally and clearly. Your browser can transcribe speech when supported. Only your transcript is evaluated — pronunciation and audio quality are not analyzed.</p></>}</div>{transcript&&<div className="transcript"><b>Live transcript</b><p>{transcript}</p></div>}{error&&<div className="alert error">{error}</div>}{result?<Result result={result} onRetry={retry} retrying={retrying}/>:<div className="task-actions"><button className="secondary" onClick={recording?stop:start} disabled={busy}>{recording?"Stop Recording":"Start Recording"}</button><button className="primary" disabled={!blob||busy} onClick={submit}>{busy?"Evaluating...":"Submit for AI Feedback"}</button></div>}</section><aside className="panel tips"><h3>Speaking tips</h3><ul><li>Maintain steady fluency.</li><li>Pronounce words clearly.</li><li>Avoid long pauses.</li><li>Focus on the whole prompt.</li></ul><div className="tip-box"><Sparkles size={18}/><b>AI analysis</b><p>We evaluate your submitted response and return a practice score — see the note under your result for what is and isn't measured.</p></div></aside></div>
}

// UI guidance only — the server's own MAX_TEXT_LENGTH (character-based) remains the sole
// enforced limit; a word count outside this range is still accepted and scored, exactly as
// before. Keyed by the question's actual type slug (swt/essay), not its display title.
const WRITING_WORD_RANGES = { swt: [40, 100], essay: [200, 300] };

function WordCountBadge({ count, range }) {
  if (!range) return <span className="word-count">{count} words</span>;
  const [min, max] = range;
  const tone = count < min ? "low" : count > max ? "high" : "good";
  return <span className={`word-count ${tone}`}>{count} / {min}–{max} words</span>;
}

function WritingTask({type,question,testSessionId,onAnswered,existingResult}) {
  const [text,setText]=useState(()=>existingResult?.transcript||(typeof existingResult?.answer==="string"?existingResult.answer:"")),[result,setResult]=useState(()=>existingResult||null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[retrying,setRetrying]=useState(false);
  async function submit(){if(!text.trim()){setError("Write a response before submitting.");return} setBusy(true); setError(""); const f=new FormData();f.append("section","writing");f.append("type",type);f.append("answer",JSON.stringify(text));f.append("transcript",text);if(question?._id)f.append("questionId",question._id);if(testSessionId)f.append("testSessionId",testSessionId);try{const d=await api.submit(f);setResult(d.submission);onAnswered?.(d.submission)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function retry(){setRetrying(true);setError("");try{setResult((await api.retryEvaluation(result._id)).submission)}catch(e){setError(e.message)}finally{setRetrying(false)}}
  const wordCount = text.trim()?text.trim().split(/\s+/).length:0;
  return <div className="task-layout"><section className="panel task-main"><div className="task-meta"><span className="chip">{type}</span><WordCountBadge count={wordCount} range={WRITING_WORD_RANGES[question?.type]}/></div><h2>{question?.title||type}</h2><p className="instruction">{question?.prompt||"Write your answer below."}</p>{question?.passage&&<div className="passage">{question.passage}</div>}<textarea className="answer-area" value={text} onChange={e=>setText(e.target.value)} placeholder="Type your answer here..." disabled={!!result}/>{error&&<div className="alert error">{error}</div>}{result?<Result result={result} onRetry={retry} retrying={retrying}/>:<button className="primary right" disabled={!text.trim()||busy} onClick={submit}>{busy?"Evaluating...":"Submit for AI Feedback"}</button>}</section><aside className="panel tips"><h3>Writing tips</h3><ul><li>Answer the exact task.</li><li>Use clear sentence structure.</li><li>Check grammar and spelling.</li><li>Keep your ideas relevant.</li></ul></aside></div>
}

function formatMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Purely cosmetic — the server's own expiresAt comparison is what actually rejects late
// answers/completion (see routes/testSessions.js's expireIfNeeded). This never reads or sends
// a remaining-time value itself, only displays what the parent already computed.
function MockTimer({ remainingMs }) {
  const low = remainingMs !== null && remainingMs <= 2 * 60 * 1000;
  return <div className={low ? "mock-timer low" : "mock-timer"}>
    <Clock3 size={16} />
    <div><span className="mock-timer-label">Time Remaining</span><strong>{remainingMs === null ? "--:--" : formatMMSS(remainingMs)}</strong></div>
  </div>;
}

// Navigation only ever indexes into the questions the server already returned at session
// start — there is no way to jump to a question id the student supplies.
function MockQuestionNav({ questions, idx, answered, onJump }) {
  return <div className="mock-qnav" role="tablist" aria-label="Question overview">
    {questions.map((q, i) => {
      const state = i === idx ? "current" : answered[i] ? "answered" : "unanswered";
      return <button key={q._id || i} type="button" className={`mock-qnav-item ${state}`} onClick={() => onJump(i)} aria-current={i === idx || undefined} title={`Question ${i + 1} — ${state}`}>{i + 1}</button>;
    })}
  </div>;
}

function Mock() {
  const [session,setSession]=useState(null);
  const [idx,setIdx]=useState(0);
  const [answered,setAnswered]=useState({});
  const [result,setResult]=useState(null);
  const [starting,setStarting]=useState(false);
  const [finishing,setFinishing]=useState(false);
  const [error,setError]=useState("");
  const [remainingMs,setRemainingMs]=useState(null);
  const [timeUp,setTimeUp]=useState(false);
  // "EXPIRED" | "ALREADY_COMPLETED" | null — a dedicated terminal state so these read as
  // deliberate outcomes, never as the generic error alert.
  const [terminal,setTerminal]=useState(null);
  const [showConfirm,setShowConfirm]=useState(false);
  // Two separate live regions (not one region with a changing politeness attribute — screen
  // readers don't reliably pick up a live region's politeness changing after the fact): routine
  // state changes are polite (won't interrupt), the two time-critical ones are assertive.
  const [politeAnnouncement,setPoliteAnnouncement]=useState("");
  const [assertiveAnnouncement,setAssertiveAnnouncement]=useState("");
  const timerIdRef=useRef(null);
  const autoSubmittedRef=useRef(false);
  const lowTimeAnnouncedRef=useRef(false);

  async function start() {
    setStarting(true); setError("");
    try {
      const d = await api.testSessions.start();
      autoSubmittedRef.current=false; lowTimeAnnouncedRef.current=false;
      setSession(d); setIdx(0); setAnswered({}); setTimeUp(false); setTerminal(null); setRemainingMs(null);
      setPoliteAnnouncement(""); setAssertiveAnnouncement("");
    } catch(e){ setError(e.message); } finally { setStarting(false); }
  }

  async function finish() {
    setFinishing(true); setError(""); setPoliteAnnouncement("Finishing your test…");
    try {
      const d = await api.testSessions.complete(session.testSession._id);
      setResult(d.testSession);
      setPoliteAnnouncement("Your mock test has been completed and scored.");
    } catch(e){
      // The frontend never marks the test completed on its own — only a real 200 from the
      // server (above) does that. A rejection here always renders one of the dedicated
      // terminal states below, never a fabricated result.
      if (e.code === "TEST_SESSION_EXPIRED") { setTerminal("EXPIRED"); setAssertiveAnnouncement("Your test session has expired."); }
      else if (e.code === "SESSION_ALREADY_COMPLETED") { setTerminal("ALREADY_COMPLETED"); setPoliteAnnouncement("This test was already completed."); }
      else setError(e.message);
    } finally { setFinishing(false); }
  }

  // Recomputed each tick from the server-issued expiresAt (not decremented locally), so a
  // backgrounded/throttled tab still shows the true remaining time the instant it's visible
  // again, and a page reload of this same in-progress session would recover the right value too.
  useEffect(() => {
    if (!session || result || terminal) return;
    const expiresAtMs = new Date(session.testSession.expiresAt).getTime();
    function tick() {
      const remaining = expiresAtMs - Date.now();
      setRemainingMs(Math.max(0, remaining));
      // Announced once when crossing the threshold, never on every tick — a screen reader
      // would be unusable if this fired every second.
      if (remaining > 0 && remaining <= 2 * 60 * 1000 && !lowTimeAnnouncedRef.current) {
        lowTimeAnnouncedRef.current = true;
        setPoliteAnnouncement("Less than 2 minutes remaining.");
      }
      if (remaining <= 0) {
        clearInterval(timerIdRef.current);
        if (!autoSubmittedRef.current) {
          autoSubmittedRef.current = true;
          setAssertiveAnnouncement("Time is up. Submitting your test now.");
          setTimeUp(true);
          finish();
        }
      }
    }
    tick();
    timerIdRef.current = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timerIdRef.current);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [session?.testSession?._id, result, terminal]);

  // Present in every branch below so an announcement made right before a state transition (e.g.
  // "Time is up" just before the timeUp screen renders) is never lost to an unmounted node.
  const liveRegions = <>
    <div aria-live="polite" className="sr-only">{politeAnnouncement}</div>
    <div aria-live="assertive" className="sr-only">{assertiveAnnouncement}</div>
  </>;

  if (result) {
    return <>{liveRegions}<Page title="Mock Test Complete" subtitle="Here is your practice report.">
      <div className="mock-result">
        <div className="big-score">{result.totalScore}<small> / {result.totalMaxScore}</small></div>
        <h2>Practice Score</h2>
        <p className="muted">Based on your actual answers this attempt — a practice score, not an official Pearson PTE score.</p>
        <div className="score-grid">{result.sectionScores.map(s=><ScoreCard key={s.section} title={s.section} value={`${s.score}/${s.maxScore}`} sub="Section score"/>)}</div>
        <NavLink className="primary" to="/dashboard">Back to Dashboard</NavLink>
      </div>
    </Page></>;
  }

  if (terminal === "EXPIRED") {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
      <div className="mock-card panel mock-terminal expired">
        <Clock3 size={40}/><h2>Mock Test Expired</h2>
        <p>Your allotted test time has ended. Your test can no longer accept answers.</p>
        <NavLink className="primary" to="/dashboard">Back to Dashboard</NavLink>
      </div>
    </Page></>;
  }

  if (terminal === "ALREADY_COMPLETED") {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
      <div className="mock-card panel mock-terminal">
        <CheckCircle2 size={40}/><h2>This Test Was Already Completed</h2>
        <p>This mock attempt has already been submitted and scored.</p>
        <NavLink className="primary" to="/history">View History</NavLink>
      </div>
    </Page></>;
  }

  if (!session) {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
      <div className="mock-card panel">
        <Trophy size={40}/><h2>Full PTE Practice Mock</h2>
        <p>One question per section, scored from your actual answers — not a preset result.</p>
        <ul><li>Speaking</li><li>Writing</li><li>Reading</li><li>Listening</li></ul>
        <p className="muted">20 minutes total for this compact mock.</p>
        {error && <div className="alert error">{error}</div>}
        <button className="primary" disabled={starting} onClick={start}>{starting?"Preparing...":"Start Mock Test"}</button>
      </div>
    </Page></>;
  }

  if (timeUp) {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
      <div className="mock-card panel mock-terminal">
        <Clock3 size={40}/><h2>Time's Up</h2>
        <p>Submitting your test now…</p>
      </div>
    </Page></>;
  }

  const q = session.questions[idx];
  const isLast = idx === session.questions.length - 1;
  const answeredCount = Object.keys(answered).length;
  const unansweredCount = session.questions.length - answeredCount;
  function onAnswered(submission){ setAnswered(a=>({...a,[idx]:submission})); }
  const confirmMessage = `You have answered ${answeredCount} of ${session.questions.length} questions, with ${formatMMSS(remainingMs ?? 0)} remaining.`
    + (unansweredCount > 0 ? " You still have unanswered questions." : "");

  return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
    <div className="mock-progress-bar">
      <span>Question {idx+1} of {session.questions.length}</span>
      <span className="chip">{q.section}</span>
      <MockTimer remainingMs={remainingMs}/>
    </div>
    <div
      className="mock-progress-track"
      role="progressbar"
      aria-valuenow={idx+1}
      aria-valuemin={1}
      aria-valuemax={session.questions.length}
      aria-valuetext={`Question ${idx+1} of ${session.questions.length}`}
    >
      <div className="mock-progress-fill" style={{width: `${((idx+1)/session.questions.length)*100}%`}}/>
    </div>
    <MockQuestionNav questions={session.questions} idx={idx} answered={answered} onJump={setIdx}/>
    {q.section==="speaking" && <SpeakingTask type={q.title} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
    {q.section==="writing" && <WritingTask type={q.title} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
    {q.section==="reading" && <ReadingTask question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
    {q.section==="listening" && <ListeningTask question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
    {error && <div className="alert error">{error}</div>}
    <div className="mock-nav">
      <button className="secondary" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}>‹ Previous</button>
      {!isLast && <button className="primary" onClick={()=>setIdx(i=>i+1)}>Next ›</button>}
      <button className="secondary" disabled={finishing} onClick={()=>setShowConfirm(true)}>{finishing?"Finishing...":"Finish Test"}</button>
    </div>
    <ConfirmDialog
      open={showConfirm}
      title="Finish mock test?"
      message={confirmMessage}
      confirmLabel="Finish Test"
      busy={finishing}
      onConfirm={()=>{ setShowConfirm(false); finish(); }}
      onCancel={()=>setShowConfirm(false)}
    />
  </Page></>;
}

function Plan() {
  const [data,setData]=useState(null);useEffect(()=>{api.plan().then(setData).catch(()=>{})},[]);
  return <Page title="Personal Study Plan" subtitle="Your plan adapts to your practice history."><div className="plan-hero panel"><div className="plan-icon"><Brain/></div><div><span className="eyebrow">FOCUS AREA</span><h2>{data?.weakest||"Speaking"}</h2><p>Build consistency in your weakest section first.</p></div></div><div className="two-col"><section className="panel"><h3>Today's tasks</h3>{(data?.tasks||["Complete 10 speaking questions","Review mistakes","Learn 10 words","Take a mini test"]).map((x,i)=><div className="check-row" key={i}><CheckCircle2 size={19}/><span>{x}</span></div>)}</section><section className="panel"><h3>Section performance</h3>{(data?.sectionScores||[]).map(x=><div className="bar-row" key={x.section}><span>{x.section}</span><div><i style={{width:`${Math.min(100,x.score)}%`}}/></div><b>{x.score}</b></div>)}</section></div></Page>
}

// Shared by the student's own mock-attempt detail view and the admin inspection view — both
// endpoints return the identical safe-projected shape (see server/src/routes/testSessions.js's
// loadSessionResults), so one renderer serves both without duplicating the answer-key guard.
function describeAnswer(r) {
  const opts = r.question?.options;
  if (Array.isArray(opts) && opts.length) {
    if (typeof r.answer === "number") return opts[r.answer] ?? String(r.answer);
    if (Array.isArray(r.answer)) return r.answer.map(i => opts[i] ?? i).join(", ");
  }
  if (typeof r.answer === "string" && r.answer) return r.answer;
  if (r.transcript) return r.transcript;
  return "—";
}

function MockResultRow({ r }) {
  return <div className="mock-result-row panel">
    <div className="task-meta"><span className="chip">{r.section}</span><span>{r.question?.title || r.type}</span></div>
    {r.question?.prompt && <p className="instruction">{r.question.prompt}</p>}
    {r.question?.passage && <div className="passage">{r.question.passage}</div>}
    <p className="muted">Your answer: {describeAnswer(r)}</p>
    {r.evaluationType === "objective" ? <ObjectiveResult result={r}/> : <Result result={r}/>}
  </div>;
}

function MockAttemptDetail({ id, onClose }) {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    setLoading(true); setError("");
    api.testSessions.details(id).then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[id]);
  const s = data?.testSession;

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-panel detail-panel" onClick={e=>e.stopPropagation()}>
      <div className="modal-head"><h3>Mock Test Details</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>
      {loading ? <Empty text="Loading attempt..."/> : !s ? <div className="alert error">{error}</div> : <>
        <div className="mock-detail-summary">
          <span className="score-pill">{s.totalScore}/{s.totalMaxScore}</span>
          <span className="muted">{s.submittedAt ? new Date(s.submittedAt).toLocaleString() : "In progress"}</span>
        </div>
        <div className="mock-detail-list">
          {data.results.length ? data.results.map(r=><MockResultRow key={r._id} r={r}/>) : <p className="muted">No answers were submitted in this attempt.</p>}
        </div>
      </>}
    </div>
  </div>;
}

// "Today"/"Yesterday" reads more naturally than a repeated full timestamp in a history list
// (Part 18) — falls back to the exact existing toLocaleString() format for anything older, so
// this never hides real information, only shortens the two most common, most-glanced-at cases.
function fmtRelativeDateTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return date.toLocaleString();
}

const HISTORY_SECTION_FILTERS = ["all", ...PRACTICE_SECTIONS];

function History() {
  const [rows,setRows]=useState([]);
  const [mocks,setMocks]=useState([]);
  const [detailId,setDetailId]=useState(null);
  const [sectionFilter,setSectionFilter]=useState("all");
  useEffect(()=>{
    api.history().then(d=>setRows(d.submissions)).catch(()=>{});
    api.testSessions.list().then(d=>setMocks(d.testSessions)).catch(()=>{});
  },[]);
  // Client-side only — the full list is already fetched, and this is real data already on the
  // page, not a second source of truth that could drift from it.
  const filteredRows = sectionFilter === "all" ? rows : rows.filter(r => r.section === sectionFilter);
  return <Page title="Practice History" subtitle="Review your recent attempts and scores.">
    <h2 className="section-title" style={{marginTop:0}}>Mock test attempts</h2>
    <div className="panel table-wrap">
      <table><thead><tr><th>Date</th><th>Total</th><th>Speaking</th><th>Writing</th><th>Reading</th><th>Listening</th><th></th></tr></thead>
      <tbody>{mocks.map(m=><tr key={m._id}>
        <td>{fmtRelativeDateTime(m.submittedAt)}</td>
        <td><span className="score-pill">{m.totalScore}/{m.totalMaxScore}</span></td>
        {["speaking","writing","reading","listening"].map(sec=>{
          const s=(m.sectionScores||[]).find(x=>x.section===sec);
          return <td key={sec}>{s?`${s.score}/${s.maxScore}`:"—"}</td>;
        })}
        <td><button className="text-button" onClick={()=>setDetailId(m._id)}>View Details</button></td>
      </tr>)}</tbody></table>
      {!mocks.length && <Empty text="No completed mock tests yet."/>}
    </div>
    <div className="panel-head" style={{marginTop:30,marginBottom:0}}>
      <h2 className="section-title" style={{margin:0}}>Practice attempts</h2>
      <div className="question-list-filters" role="tablist" aria-label="Filter by section">
        {HISTORY_SECTION_FILTERS.map(s => <button key={s} type="button" role="tab" aria-selected={sectionFilter===s}
          className={sectionFilter===s ? "question-list-filter active" : "question-list-filter"}
          onClick={()=>setSectionFilter(s)} style={{textTransform:"capitalize"}}>{s === "all" ? "All" : SECTION_LABELS[s]}</button>)}
      </div>
    </div>
    <div className="panel table-wrap" style={{marginTop:14}}><table><thead><tr><th>Task</th><th>Section</th><th>Evaluation</th><th>Score</th><th>Date</th></tr></thead><tbody>{filteredRows.map(r=><tr key={r._id}><td><b>{r.type}</b></td><td style={{textTransform:"capitalize"}}>{r.section}</td><td>{r.evaluationType==="subjective" ? <Badge tone="info">AI Evaluation</Badge> : <Badge tone="neutral">Objective</Badge>}</td><td>{historyScoreCell(r)}</td><td>{fmtRelativeDateTime(r.createdAt)}</td></tr>)}</tbody></table>{!filteredRows.length&&<Empty text={rows.length ? "No practice attempts match this filter." : "No practice submissions yet. Start a task from the sidebar."}/>}</div>
    {detailId && <MockAttemptDetail id={detailId} onClose={()=>setDetailId(null)}/>}
  </Page>
}

function historyScoreCell(r) {
  if (r.evaluationStatus==="PENDING" || r.evaluationStatus==="PROCESSING") return <span className="muted">Evaluating…</span>;
  if (r.evaluationStatus==="FAILED") return <Badge tone="bad">Failed</Badge>;
  return <span className="score-pill">{r.score}{r.maxScore?`/${r.maxScore}`:""}</span>;
}

function Profile({user}) {
  const start = user.subscriptionStartDate ? new Date(user.subscriptionStartDate).toLocaleDateString() : "—";
  const end = user.subscriptionEndDate ? new Date(user.subscriptionEndDate).toLocaleDateString() : "—";
  const status = user.role === "admin" ? "Admin access" : user.subscriptionStatus === "ACTIVE" ? "Active" : user.subscriptionStatus === "EXPIRED" ? "Expired" : "Not activated";
  return <Page title="Profile" subtitle="Manage your account."><div className="profile-card panel"><div className="profile-avatar">{user.name.slice(0,1).toUpperCase()}</div><h2>{user.name}</h2><p>User ID: {user.username}</p><div className="profile-grid"><div><span>Role</span><b>{user.role}</b></div><div><span>Target score</span><b>{user.targetScore}</b></div><div><span>Subscription</span><b>{status}</b></div>{user.role!=="admin"&&<div><span>Access until</span><b>{end}</b></div>}</div><p className="muted">{user.role==="admin" ? "Administrator accounts are not subject to subscription limits." : `Started ${start}. To change your password or extend access, contact your administrator.`}</p></div></Page>
}

function Badge({tone,children}) { return <span className={`badge badge-${tone}`}>{children}</span> }
function accountStatusTone(s){ return s==="ACTIVE"?"good":s==="BLOCKED"?"bad":"warn" }
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

function ToastHost({toasts,dismiss}) {
  if(!toasts.length) return null;
  return <div className="toast-host">{toasts.map(t=><div key={t.id} className={`toast toast-${t.type}`} onClick={()=>dismiss(t.id)}>{t.message}</div>)}</div>
}

function ConfirmDialog({open,title,message,confirmLabel,danger,busy,onConfirm,onCancel}) {
  if(!open) return null;
  return <div className="modal-overlay confirm-overlay" onClick={e=>{e.stopPropagation();onCancel()}}>
    <div className="modal-panel confirm-panel" onClick={e=>e.stopPropagation()}>
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

function AdminDashboard({notify, goToUsers, goToQuestions}) {
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
      <h2 className="section-title">Question bank</h2>
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

function AccountCreatedModal({ account, onClose }) {
  const [copied, setCopied] = useState(false);
  const message = buildAccountCreatedMessage(account);
  function copy() {
    navigator.clipboard?.writeText(message).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-panel" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h3>Account created</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>
      <p className="muted" style={{marginTop:-6}}>Copy this message and send it to the student — it includes their login details and explains the one-device/one-browser policy.</p>
      <textarea readOnly className="answer-area" style={{height:360,fontFamily:"monospace",fontSize:12}} value={message} onClick={e => e.target.select()}/>
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>Close</button>
        <button className="primary" onClick={copy}>{copied ? "Copied!" : "Copy message"}</button>
      </div>
    </div>
  </div>;
}

function AdminUsers({notify, initialFilters, onFiltersApplied}) {
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
      <div className="search admin-search"><span>⌕</span><input placeholder="Search by User ID, name or email..." value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load(1)}/></div>
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
    <div className="modal-panel detail-panel" onClick={e=>e.stopPropagation()}>
      <div className="modal-head"><h3>{u ? u.name : "User details"}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>
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
          <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Reset password?",message:`A new temporary password will be generated for ${u.username} and all their sessions will be signed out.`,label:"Reset password now",danger:false,successMsg:"Password reset",run:async()=>{const d=await api.admin.resetPassword(u.id,"");notify("success",`New password for ${u.username}: ${d.temporaryPassword}`)}})}>Reset password</button>
        </div>

        <h4>Renew subscription</h4>
        <div className="renew-row">
          {[30,60,90].map(d=><button key={d} className="secondary" disabled={busy} onClick={()=>act(()=>api.admin.renew(u.id,d), `Renewed for ${d} days`)}>+{d} days</button>)}
          <input type="number" min="1" placeholder="Custom days" value={customDays} onChange={e=>setCustomDays(e.target.value)}/>
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
  </div>
}

function testSessionStatusTone(s) { return s==="COMPLETED"?"good":s==="EXPIRED"?"bad":s==="ABANDONED"?"neutral":"info" }

function AdminTestSessions() {
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
  const s = data?.testSession;

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-panel detail-panel" onClick={e=>e.stopPropagation()}>
      <div className="modal-head"><h3>{s ? `${s.user?.username}'s mock attempt` : "Mock attempt"}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>
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

function Admin() {
  const [tab,setTab]=useState("dashboard");
  const [toasts,setToasts]=useState([]);
  const [usersFilter,setUsersFilter]=useState(null);

  function notify(type, message) {
    const id = Date.now()+Math.random();
    setToasts(t=>[...t,{id,type,message}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)), 6000);
  }
  function goToUsers(filters) { setUsersFilter(filters); setTab("users"); }

  return <Page title="Admin Panel" subtitle="Manage users and the practice content library.">
    <div className="practice-tabs">
      <button className={tab==="dashboard"?"tab active":"tab"} onClick={()=>setTab("dashboard")}>Dashboard</button>
      <button className={tab==="users"?"tab active":"tab"} onClick={()=>setTab("users")}>Users</button>
      <button className={tab==="questions"?"tab active":"tab"} onClick={()=>setTab("questions")}>Questions</button>
      <button className={tab==="testSessions"?"tab active":"tab"} onClick={()=>setTab("testSessions")}>Test Sessions</button>
    </div>
    {tab==="dashboard" && <AdminDashboard notify={notify} goToUsers={goToUsers} goToQuestions={()=>setTab("questions")}/>}
    {tab==="users" && <div className="panel"><AdminUsers notify={notify} initialFilters={usersFilter} onFiltersApplied={()=>setUsersFilter(null)}/></div>}
    {tab==="questions" && <div className="panel"><AdminQuestionsPanel notify={notify}/></div>}
    {tab==="testSessions" && <div className="panel"><AdminTestSessions/></div>}
    <ToastHost toasts={toasts} dismiss={id=>setToasts(t=>t.filter(x=>x.id!==id))}/>
  </Page>
}

function Empty({text}) {return <div className="empty">{text}</div>}

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

export default function App() {
  const auth=useAuth();
  if(!auth.user) return <Routes><Route path="*" element={<Auth save={auth.save}/>}/></Routes>;
  return <Layout user={auth.user} logout={auth.logout}><Routes>
    <Route path="/" element={<Navigate to={auth.user.role==="admin"?"/admin":"/dashboard"}/>}/>
    <Route path="/dashboard" element={<Dashboard user={auth.user}/>}/>
    <Route path="/practice" element={<PracticeHub/>}/>
    <Route path="/speaking" element={<Practice section="speaking"/>}/>
    <Route path="/writing" element={<Practice section="writing"/>}/>
    <Route path="/reading" element={<Practice section="reading"/>}/>
    <Route path="/listening" element={<Practice section="listening"/>}/>
    <Route path="/mock" element={<Mock/>}/>
    <Route path="/plan" element={<Plan/>}/>
    <Route path="/history" element={<History/>}/>
    <Route path="/profile" element={<Profile user={auth.user}/>}/>
    <Route path="/admin" element={<AdminRoute user={auth.user}><Admin/></AdminRoute>}/>
    <Route path="*" element={<Navigate to="/dashboard"/>}/>
  </Routes></Layout>
}
