import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, Navigate, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  Activity, BarChart3, BookOpen, Brain, ChevronDown, Clock3, Headphones,
  Home, LogOut, Menu, Mic, PenLine, Play, Sparkles, Target,
  Trophy, UserRound, Volume2, X, CheckCircle2, AlertCircle, Shield, ChevronLeft, ChevronRight,
  Eye, EyeOff, Moon, Sun, PanelLeft, Search as SearchIcon, Lock
} from "lucide-react";
import { api, forceLogout, endStudentViewSession } from "./api.js";
import { Result, ObjectiveResult } from "./PracticeObjective.jsx";
import PracticePage from "./practice/Practice.jsx";
import PracticeHubPage from "./pages/PracticeHub.jsx";
import DashboardPage from "./pages/Dashboard.jsx";

// Loaded on demand. These routes are never part of the first paint -- a student lands on
// the dashboard, and Admin in particular is code a student never runs at all. Splitting them
// keeps the initial bundle to what the first screen actually needs.
const MockPage = React.lazy(() => import("./pages/Mock.jsx"));
const HistoryPage = React.lazy(() => import("./pages/History.jsx"));
const ProgressPage = React.lazy(() => import("./pages/Progress.jsx"));
const StudyPlanPage = React.lazy(() => import("./pages/StudyPlan.jsx"));
const ProfilePage = React.lazy(() => import("./pages/Profile.jsx"));
const AdminPage = React.lazy(() => import("./pages/Admin.jsx"));
const SharedAnswerPage = React.lazy(() => import("./pages/SharedAnswer.jsx"));
import { ReadingTask } from "./practice/Reading.jsx";
import { ListeningTask } from "./practice/Listening.jsx";
import SpeakingTaskModule from "./practice/Speaking.jsx";
import WritingTaskModule from "./practice/Writing.jsx";
import { Badge, Page } from "./components/common.jsx";
import { Button, ButtonLink, IconButton } from "./components/Button.jsx";
import { activeStudentView, endStudentView, enterStudentViewFromUrl, updateStudentViewProfile } from "./studentView.js";
import { adoptSameAccountSession, answerOtherTabs, clearSession, otherTabsUse, saveSession, tabSession, updateSessionUser } from "./session.js";
import Footer from "./components/Footer.jsx";
import Landing from "./landing/Landing.jsx";
import { ToastProvider, useToast } from "./components/toast.jsx";
import { RouteErrorBoundary } from "./components/ErrorBoundary.jsx";
import { SEARCH_MAX_LENGTH } from "./practice/answerLimits.js";
import { PRACTICE_SECTIONS, SECTION_LABELS, supportedTasksFor } from "./practiceTaskRegistry.js";
import { safeLocal } from "./safeStorage.js";
import { CurrentUserContext, lockReason, activeSectionsByExpiry } from "./access.js";

const SECTION_ICONS = { speaking: Mic, writing: PenLine, reading: BookOpen, listening: Headphones };

const SUBSCRIPTION_EXPIRED_MESSAGE = "Your 30-day subscription has expired. Please contact the administrator to renew your access.";
// setTimeout's delay is coerced to a 32-bit signed int — anything past this fires almost
// immediately instead of waiting. A subscription is realistically never more than ~24 days
// out from this cap, so a single timer is enough; no rescheduling loop is needed.
const MAX_TIMEOUT_MS = 2_147_483_647;

function getInitialTheme() {
  const saved = safeLocal.getItem("pte_theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#12182b" : "#f4f7fc");
    safeLocal.setItem("pte_theme", theme);
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
    // A student-view tab (studentView.js) runs as the viewed student, read only. The admin's own
    // stored sign-in is left exactly as it is.
    const view = enterStudentViewFromUrl() || activeStudentView();
    if (view) return { ...view.student, viewOnly: true };
    // Each tab keeps its own sign-in (session.js): a student here and an admin in another tab.
    return tabSession()?.user || null;
  });
  const save = (data) => {
    saveSession(data.token, data.user);
    setUser(data.user);
  };
  // Replaces the stored user after a self-service change (currently the target score). Written to
  // this tab's sign-in, so a reload keeps the new value.
  const updateUser = (next) => {
    if (user?.viewOnly) {
      updateStudentViewProfile(next);
      setUser({ ...next, viewOnly: true });
      return;
    }
    updateSessionUser(next);
    setUser(next);
  };
  // Signing out also leaves the current URL. Otherwise the sign-in sheet opens on top of the
  // previous account's page, and the next account lands there first — a student signing in where
  // an admin signed out from /admin would land on the admin gate first.
  const navigate = useNavigate();
  const logout = async () => {
    // Leaving a student view is not a sign-out: it ends the view and returns to the admin panel.
    // The server ends the pass first; if that fails this throws and the view stays as it is, so the
    // admin is never told it ended when it has not.
    if (user?.viewOnly) {
      await endStudentViewSession();
      endStudentView();
      // "/" leads the admin to the admin panel; see leaveStudentView in api.js for why not "/admin".
      window.location.assign("/");
      return;
    }
    // A new tab starts on the same session as the tab that signed in. If another open tab is still
    // using this one, only this tab signs out; ending the session on the server would sign that tab
    // out too. Otherwise the session is ended there as well. The request reads this tab's token as
    // it is sent, before the sign-in is cleared below.
    const shared = await otherTabsUse(tabSession()?.token);
    if (!shared) api.auth.logout();
    clearSession({ keepBrowser: shared }); setUser(null);
    navigate("/", { replace: true });
  };
  // Lets other tabs ask whether this tab is using their session (see logout above).
  useEffect(() => { answerOtherTabs(); }, []);

  // Another tab signing in as a different account, or signing out, does not change this tab: each
  // tab keeps its own sign-in. The one thing taken from another tab is this same account signing in
  // again there — the server keeps one session per account, so that ended this tab's session, and
  // this tab carries on with the new one (and any newer profile details) instead of being signed out.
  useEffect(() => {
    if (!user || user.viewOnly) return undefined;
    function onStorage(event) {
      if (event.key !== null && event.key !== "pte_token" && event.key !== "pte_user") return;
      const adopted = adoptSameAccountSession();
      if (adopted) setUser(adopted);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user]);

  useEffect(() => {
    // A viewed student's subscription running out ends nothing here; the admin is not signed out.
    if (!user || user.viewOnly || user.role === "admin" || !user.subscriptionEndDate) return;
    const msRemaining = new Date(user.subscriptionEndDate).getTime() - Date.now();
    if (user.subscriptionStatus !== "ACTIVE" || msRemaining <= 0) {
      forceLogout(SUBSCRIPTION_EXPIRED_MESSAGE);
      return;
    }
    const timer = setTimeout(() => forceLogout(SUBSCRIPTION_EXPIRED_MESSAGE), Math.min(msRemaining, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [user?.id, user?.subscriptionEndDate, user?.subscriptionStatus, user?.role]);

  // The stored user is whatever sign-in returned, possibly weeks ago. Re-read once per load so
  // section access reflects what the admin has granted since — and so a student signed in from
  // before per-section access existed picks up their `sections` list. Best-effort: on failure the
  // stored user stays, and the server enforces access regardless.
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => api.auth.me?.())
      .then(data => { if (!cancelled && data?.user) updateUser(data.user); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per signed-in user, not per update
  }, [user?.id]);

  // One section running out while others carry on is not a sign-out — the account timer above
  // handles the last one. It is a reason to re-read access, so that section locks on screen at the
  // moment it ends instead of on the next reload.
  const nextSectionEnd = activeSectionsByExpiry(user)
    .map(r => new Date(r.endDate).getTime())
    .find(t => !user?.subscriptionEndDate || t < new Date(user.subscriptionEndDate).getTime());
  useEffect(() => {
    if (!nextSectionEnd) return undefined;
    const wait = Math.min(Math.max(nextSectionEnd - Date.now(), 0) + 1000, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      Promise.resolve().then(() => api.auth.me?.()).then(data => { if (data?.user) updateUser(data.user); }).catch(() => {});
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextSectionEnd]);

  return { user, save, updateUser, logout };
}

function subscriptionLabel(user) {
  if (!user) return "";
  if (user.role === "admin") return "Admin access";
  if (!user.subscriptionEndDate || user.subscriptionStatus !== "ACTIVE") return "No active subscription";
  // When the active sections end on different dates, the account's own date (the LAST of them)
  // would overstate how long the student has, so the one running out first is named instead.
  // Sections sharing one date — every full plan bought at once — read exactly as before.
  const active = activeSectionsByExpiry(user);
  const soonest = active[0];
  if (soonest && active.some(r => r.endDate !== soonest.endDate)) {
    const days = Math.max(0, Math.ceil((new Date(soonest.endDate) - Date.now()) / 86400000));
    return `${SECTION_LABELS[soonest.section]}: ${days} day${days === 1 ? "" : "s"} left`;
  }
  const daysLeft = Math.max(0, Math.ceil((new Date(user.subscriptionEndDate) - Date.now()) / 86400000));
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
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
    {/* Straight to the Practice Hub. This was a mega-menu listing every section and task; the hub
        lists the same things with availability, progress and filters attached, so the dropdown was
        a second, thinner view of one destination. */}
    <NavLink to="/practice" className={cls} onClick={onNavigate}><Trophy size={18}/><span>PTE Practice</span></NavLink>
    <NavLink to="/mock" className={cls} onClick={onNavigate}><Trophy size={18}/><span>Take Mock Test</span></NavLink>
    <div className="nav-group-label">Performance</div>
    <NavLink to="/history" className={cls} onClick={onNavigate}><BarChart3 size={18}/><span>My Results</span></NavLink>
    <NavLink to="/progress" className={cls} onClick={onNavigate}><Activity size={18}/><span>Progress</span></NavLink>
    <NavLink to="/plan" className={cls} onClick={onNavigate}><Brain size={18}/><span>AI Study Plan</span></NavLink>
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
      { label: "Performance Intelligence", group: "Pages", to: "/progress" },
      { label: "AI Study Plan", group: "Pages", to: "/plan" },
      { label: "Profile", group: "Pages", to: "/profile" }
    ];
    // A task in a section the student does not hold stays findable — it shows them what their plan
    // leaves out — but is marked and does not navigate.
    const tasks = PRACTICE_SECTIONS.flatMap(section => {
      const lock = lockReason(user, section);
      return supportedTasksFor(section).map(t => ({
        label: `${t.label} — ${SECTION_LABELS[section]}`,
        group: "Practice tasks",
        to: `/${section}?type=${t.slug}`,
        locked: lock ? lock.label : null
      }));
    });
    const admin = user?.role === "admin" ? [
      { label: "Admin Dashboard", group: "Admin", to: "/admin" },
      { label: "Manage Users", group: "Admin", to: "/admin?tab=users" },
      { label: "Manage Questions", group: "Admin", to: "/admin?tab=questions" },
      { label: "Test Sessions", group: "Admin", to: "/admin?tab=testSessions" }
    ] : [];
    return [...pages, ...tasks, ...admin];
  }, [user?.role, user?.sections]);
}

// Matching how every other product spells this shortcut: ⌘K on a Mac, Ctrl K elsewhere.
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

function HeaderSearch({ user }) {
  const inputRef = useRef(null);
  const [term, setTerm] = useState("");
  const [highlight, setHighlight] = useState(0);
  const { open, setOpen, panelRef, triggerRef } = useDropdown();
  const navigate = useNavigate();
  const destinations = useSearchDestinations(user);

  const results = term.trim()
    ? destinations.filter(d => d.label.toLowerCase().includes(term.trim().toLowerCase())).slice(0, 8)
    : [];
  const grouped = results.reduce((acc, r) => { (acc[r.group] ||= []).push(r); return acc; }, {});

  function go(result) {
    if (!result?.to || result.locked) return;
    setTerm(""); setOpen(false);
    navigate(result.to);
  }
  useEffect(() => {
    function onShortcut(e) {
      if (e.key?.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, []);

  function onKeyDown(e) {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(results.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[highlight]); }
  }

  return <div className="search" ref={triggerRef}>
    <SearchIcon size={15} aria-hidden="true"/>
    <input
      ref={inputRef}
      placeholder="Search anything..."
      maxLength={SEARCH_MAX_LENGTH}
      value={term}
      onChange={e => { setTerm(e.target.value); setOpen(true); setHighlight(0); }}
      onFocus={() => setOpen(true)}
      onKeyDown={onKeyDown}
      role="combobox"
      aria-expanded={open && !!term.trim()}
      aria-controls="header-search-results"
      aria-label="Search anything"
    />
    {/* The shortcut that actually focuses this input, shown so it is discoverable rather than
        a secret. Hidden from assistive tech, which gets the same thing from the label. */}
    <kbd className="search-kbd" aria-hidden="true">{isMac ? "⌘" : "Ctrl"} K</kbd>
    {open && term.trim() && <div className="search-results" id="header-search-results" ref={panelRef} role="listbox">
      {results.length
        ? Object.entries(grouped).map(([group, items]) => <div key={group}>
            <div className="search-result-group">{group}</div>
            {items.map(r => {
              const idx = results.indexOf(r);
              return <button key={r.to} type="button" role="option" aria-selected={idx === highlight}
                aria-disabled={r.locked ? "true" : undefined}
                className={[idx === highlight ? "search-result active" : "search-result", r.locked ? "is-locked" : ""].filter(Boolean).join(" ")}
                onMouseEnter={() => setHighlight(idx)} onClick={() => go(r)}>
                {r.label}{r.locked && <span className="search-result-lock"><Lock size={12} aria-hidden="true"/> {r.locked}</span>}
              </button>;
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
  if (pathname === "/progress") return "Performance Intelligence";
  if (pathname === "/plan") return "AI Study Plan";
  if (pathname === "/profile") return "Profile";
  if (pathname.startsWith("/admin")) return "Admin";
  if (["/speaking", "/writing", "/reading", "/listening", "/practice"].some(p => pathname.startsWith(p))) return "PTE Practice";
  return "";
}

function Layout({ user, logout, children, theme, toggleTheme }) {
  const [mobile, setMobile] = useState(false);
  // Remembered per browser: someone who works with the rail collapsed wants it collapsed next
  // time too. Read defensively — a private window can throw on storage access.
  const [collapsed, setCollapsed] = useState(() => {
    try { return safeLocal.getItem("pte_sidebar_collapsed") === "1"; } catch { return false; }
  });
  const location = useLocation();
  const inAdminSection = user?.role === "admin" && location.pathname === "/admin";
  const closeMobile = () => setMobile(false);
  const toast = useToast();
  // Ending a student view waits on the server: one press at a time, and a failure is shown.
  const [leaving, setLeaving] = useState(false);
  async function handleLogout() {
    if (!user?.viewOnly) return logout();
    if (leaving) return;
    setLeaving(true);
    try {
      await logout();
    } catch (err) {
      toast?.error(err?.message || "Could not end this student view. Please try again.");
      setLeaving(false);
    }
  }

  function toggleCollapsed() {
    setCollapsed(value => {
      const next = !value;
      try { safeLocal.setItem("pte_sidebar_collapsed", next ? "1" : "0"); } catch { /* not fatal */ }
      return next;
    });
  }

  return <div className={collapsed ? "app-shell is-collapsed" : "app-shell"}>
    <aside className={mobile ? "sidebar mobile-open" : "sidebar"}>
      <div className="sidebar-top">
        {/* "Admin Mode", not "Admin Panel" — the Admin component's own <Page title="Admin Panel">
            heading already owns that exact string; two elements with identical text would make
            every existing screen.findByText("Admin Panel") test (and a real screen reader)
            ambiguous. */}
        <div className="brand"><span className="brand-mark" aria-hidden="true">P</span><span className="brand-text">PTE CORE <em>AI</em></span>{inAdminSection && <Badge tone="info">Admin Mode</Badge>}</div>
        <IconButton label="Close menu" className="mobile-close" icon={<X/>} onClick={closeMobile}/>
      </div>
      <nav>
        {inAdminSection ? <AdminSidebarNav onNavigate={closeMobile}/> : <StudentSidebarNav user={user} onNavigate={closeMobile}/>}
      </nav>
      <div className="sidebar-bottom">
        <NavLink to="/profile" className="nav-item"><UserRound size={18}/><span>Profile</span></NavLink>
        <button className="nav-item" onClick={handleLogout} disabled={leaving}><LogOut size={18}/><span>{user?.viewOnly ? "Exit student view" : "Log out"}</span></button>
      </div>
    </aside>
    <main className="main">
      {/* Admin's read-only view of one student's site (studentView.js). Always on screen, so it is
          never mistaken for the student's own session. */}
      {user?.viewOnly && (
        <div className="student-view-banner" role="status">
          <Eye size={17} aria-hidden="true"/>
          <span>Viewing Student: <b>{user.username}</b> — Read Only</span>
          <Button variant="secondary" size="sm" onClick={handleLogout} disabled={leaving}>{leaving ? "Ending view…" : "Back to Admin Panel"}</Button>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-left">
          <IconButton label="Open menu" className="mobile-menu" icon={<Menu/>} onClick={()=>setMobile(true)}/>
          <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="panel-toggle"
            icon={<PanelLeft/>} aria-pressed={collapsed} onClick={toggleCollapsed}/>
          <span className="topbar-breadcrumb"><b>{topbarLabel(location.pathname)}</b></span>
        </div>
        <HeaderSearch user={user}/>
        <div className="topbar-right">
          <ThemeToggle theme={theme} onToggle={toggleTheme} compact/>
          <div className="top-user"><div className="avatar">{user?.name?.slice(0,1).toUpperCase()}</div><div><b>{user?.name}</b><small>{subscriptionLabel(user)}</small></div><ChevronDown size={15}/></div>
        </div>
      </header>
      <div className="content">{children}</div>
      <Footer/>
    </main>
  </div>
}

// The one and only gate for the admin surface (there is a single /admin route today — the
// Users/Questions/Test Sessions tabs inside it are React state, not separate routes, so there is
// nothing nested left to separately guard). The role checked here is req.user.role as returned by
// the server at login/refresh — never anything derived client-side. A non-admin is never shown
// the Admin component itself, not even for a frame; they're sent to their dashboard, with no
// message — for them the admin page simply is not there. The server refuses every admin request
// from a non-admin regardless.
function AdminRoute({ user, children }) {
  if (user.role !== "admin") return <Navigate to="/dashboard" replace/>;
  return children;
}

// A practice section the student does not hold, reached by a link, a bookmark or a typed URL.
// Shown in place of the section rather than redirected away, so it is clear WHY nothing opened.
// The server refuses the section's content regardless; this only keeps the student from landing on
// a page that would fail one request at a time.
function SectionRoute({ user, section, children }) {
  const lock = lockReason(user, section);
  if (!lock) return children;
  return <Page title={SECTION_LABELS[section]} subtitle={lock.label}>
    <section className="panel section-locked" role="status">
      <span className="section-locked-icon" aria-hidden="true"><Lock size={22}/></span>
      <h3>{lock.kind === "expired" ? `${SECTION_LABELS[section]} access has expired` : `${SECTION_LABELS[section]} is not in your plan`}</h3>
      <p className="muted">{lock.message}</p>
      <ButtonLink variant="secondary" to="/practice">Back to PTE Practice</ButtonLink>
    </section>
  </Page>;
}

const PRACTICE_TASK_COMPONENTS = { speaking: SpeakingTaskModule, writing: WritingTaskModule, reading: ReadingTask, listening: ListeningTask };

export default function App() {
  const auth=useAuth();
  const { theme, toggleTheme } = useTheme();
  // Only used as the route boundary's reset key: when the path changes, a page that crashed stops
  // showing its fallback.
  const location = useLocation();
  // A shared-answer link is the same standalone page for everyone, signed in or not: one report,
  // none of the app around it. Decided before the auth gate so neither surface ever wraps it.
  if (location.pathname.startsWith("/shared-answer/")) {
    return <ToastProvider><RouteErrorBoundary resetKey={location.pathname}>
      <React.Suspense fallback={<main className="shared-report"><p className="muted">Loading…</p></main>}>
        <Routes><Route path="/shared-answer/:token" element={<SharedAnswerPage/>}/></Routes>
      </React.Suspense>
    </RouteErrorBoundary></ToastProvider>;
  }
  // Signed out, every path renders the public landing surface, which carries its own nav,
  // theme toggle and the sign-in sheet. Unchanged: the auth gate itself and what follows it.
  // ToastProvider wraps both surfaces, so a toast works on the landing page and inside the
  // workspace alike. It lives here rather than in main.jsx so that anything rendering <App/> —
  // every test among other things — gets a real toast host rather than a silent no-op.
  if(!auth.user) return <ToastProvider><Routes><Route path="*" element={<Landing save={auth.save} theme={theme} toggleTheme={toggleTheme}/>}/></Routes></ToastProvider>;
  // The boundary sits INSIDE Layout so a page that fails to render leaves the navigation, the
  // theme toggle and sign-out working — a broken Progress page must not strand the user. Keyed on
  // the path so moving to a working page clears the error without a reload.
  // Suspense is required by the lazy routes above; without it React throws on first navigation.
  return <ToastProvider><CurrentUserContext.Provider value={auth.user}><Layout user={auth.user} logout={auth.logout} theme={theme} toggleTheme={toggleTheme}>
    <RouteErrorBoundary resetKey={location.pathname}>
    <React.Suspense fallback={<Page><p className="muted">Loading…</p></Page>}><Routes>
    <Route path="/" element={<Navigate to={auth.user.role==="admin"?"/admin":"/dashboard"}/>}/>
    <Route path="/dashboard" element={<DashboardPage user={auth.user}/>}/>
    <Route path="/practice" element={<PracticeHubPage/>}/>
    {PRACTICE_SECTIONS.map(section => <Route key={section} path={`/${section}`} element={
      <SectionRoute user={auth.user} section={section}>
        <PracticePage section={section} taskComponents={PRACTICE_TASK_COMPONENTS}/>
      </SectionRoute>
    }/>)}
    <Route path="/mock" element={<MockPage/>}/>
    <Route path="/plan" element={<StudyPlanPage user={auth.user}/>}/>
    <Route path="/progress" element={<ProgressPage user={auth.user}/>}/>
    <Route path="/history" element={<HistoryPage/>}/>
    <Route path="/profile" element={<ProfilePage user={auth.user} onUserChange={auth.updateUser}/>}/>
    <Route path="/admin" element={<AdminRoute user={auth.user}><AdminPage/></AdminRoute>}/>
    <Route path="*" element={<Navigate to="/dashboard"/>}/>
  </Routes></React.Suspense></RouteErrorBoundary></Layout></CurrentUserContext.Provider></ToastProvider>
}
