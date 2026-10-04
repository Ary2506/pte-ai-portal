import React, { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Headphones, Mic, Moon, PenLine, Sun } from "lucide-react";
import { PRACTICE_SECTIONS, PRACTICE_TASKS } from "../practiceTaskRegistry.js";
import { BigScore, Delta, GridField, Label, ScanLines, SectionMeter, Trajectory, Waveform } from "./Instruments.jsx";
import { useInView } from "./motion.js";
import SignInPanel from "./SignInPanel.jsx";
import Voices from "./Voices.jsx";
import "./landing.css";
import SiteFooter from "../components/Footer.jsx";

// The signed-out surface. App renders this for every path while there is no user, which is why it
// carries its own navigation and its own theme toggle rather than relying on the app shell.
//
// Everything numeric on this page is either sample data that says so on screen (the hero report)
// or counted from the real registry below. Nothing is a claim about students, scores or results.

// Counted, not asserted: if a task is added to or removed from the registry this follows.
const TASK_TYPE_COUNT = PRACTICE_SECTIONS.reduce(
  (total, section) => total + PRACTICE_TASKS[section].filter(t => t.supported).length, 0);

const SAMPLE = {
  overall: 82,
  sections: [
    { name: "Speaking",  value: 79, section: "speaking" },
    { name: "Writing",   value: 84, section: "writing" },
    { name: "Reading",   value: 86, section: "reading" },
    { name: "Listening", value: 81, section: "listening" }
  ],
  trajectory: [72, 75, 78, 82],
  deltas: [
    { metric: "Fluency", change: 8 },
    { metric: "Pronunciation", change: 6 },
    { metric: "Grammar", change: 11 },
    { metric: "Vocabulary", change: 7 }
  ]
};

const NAV = [
  { label: "Practice", href: "#evaluation" },      // the four-section rail
  { label: "AI Evaluation", href: "#capabilities" }, // the Speaking/Writing AI tiles
  { label: "Mock Tests", href: "#mock-tests" },    // that tile specifically
  { label: "Progress", href: "#metrics" }
];

/* ---------------------------------------------------------------- navigation */

function TopNav({ theme, onToggleTheme, onSignIn }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return <header className={scrolled ? "ld-nav ld-nav--scrolled" : "ld-nav"}>
    <a className="ld-wordmark" href="#top">
      <span className="ld-wordmark__mark" aria-hidden="true">P</span>
      <span className="ld-wordmark__text">PTE CORE <em>AI</em></span>
    </a>

    <nav className="ld-nav__links" aria-label="Sections of this page">
      {NAV.map(item => <a key={item.label} href={item.href}>{item.label}</a>)}
    </nav>

    <div className="ld-nav__actions">
      <button type="button" className="ld-iconbtn" onClick={onToggleTheme}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
        {theme === "dark" ? <Sun size={17}/> : <Moon size={17}/>}
      </button>
      <button type="button" className="ld-btn ld-btn--primary ld-btn--sm" onClick={onSignIn}>Sign in</button>
    </div>
  </header>;
}

/* ---------------------------------------------------------------- hero visual */

function ScoreReport() {
  const [ref, inView] = useInView({ threshold: 0.2 });

  return <figure className="ld-report" ref={ref}>
    <figcaption className="ld-report__head">
      <Label tone="accent">AI Evaluation</Label>
      {/* Stated plainly on the surface itself: these are illustrative numbers, not a real result. */}
      <Label tone="quiet">Sample report</Label>
    </figcaption>

    <div className="ld-report__overall">
      <div>
        <Label>Overall score</Label>
        <BigScore value={SAMPLE.overall} animate={inView}/>
      </div>
      <div className="ld-report__traj">
        <Label tone="quiet">Last 4 attempts</Label>
        <Trajectory points={SAMPLE.trajectory} animate={inView}/>
        <span className="ld-report__trajnums num-mono" aria-hidden="true">
          {SAMPLE.trajectory.join("  →  ")}
        </span>
      </div>
    </div>

    <div className="ld-report__meters">
      {SAMPLE.sections.map((s, i) => <SectionMeter key={s.section} {...s} delay={i * 90} animate={inView}/>)}
    </div>

    <div className="ld-report__deltas">
      <Label tone="quiet">Since last attempt</Label>
      <div className="ld-report__deltarow">
        {SAMPLE.deltas.map(d => <Delta key={d.metric} {...d}/>)}
      </div>
    </div>
  </figure>;
}

/* ---------------------------------------------------------------- hero */

function Hero({ onSignIn }) {
  return <section className="ld-hero" id="top">
    <GridField>
      <div className="ld-hero__inner">
        <div className="ld-hero__copy">
          <Label tone="accent">PTE Core · AI evaluation</Label>
          <h1 className="ld-display">
            Your PTE<br/>score,<br/><em>engineered</em>
          </h1>
          <p className="ld-lede">
            Practice smarter with AI-powered evaluation across Speaking, Writing,
            Reading and Listening — and see exactly which skill is holding your score back.
          </p>
          <div className="ld-hero__cta">
            <button type="button" className="ld-btn ld-btn--primary" onClick={onSignIn}>
              Start practicing <ArrowRight size={17}/>
            </button>
            <a className="ld-btn ld-btn--ghost" href="#evaluation">Explore the platform</a>
          </div>
          <p className="ld-hero__note">
            Access is issued by your administrator. Sign in with the User ID you were given.
          </p>
        </div>

        <div className="ld-hero__visual">
          <ScoreReport/>
        </div>
      </div>
    </GridField>
  </section>;
}

/* ---------------------------------------------------------------- section rail */

const RAIL = [
  {
    key: "speaking", name: "Speaking", icon: Mic,
    note: "Pronunciation, fluency and oral reasoning scored from your own recording.",
    visual: <Waveform bars={34} live/>
  },
  {
    key: "writing", name: "Writing", icon: PenLine,
    note: "Grammar, vocabulary range and structure analysed line by line.",
    visual: <div className="ld-editor" aria-hidden="true">
      <span className="ld-editor__line"/>
      <span className="ld-editor__line ld-editor__line--flag"/>
      <span className="ld-editor__line ld-editor__line--short"/>
      <span className="ld-editor__caret"/>
    </div>
  },
  {
    key: "reading", name: "Reading", icon: BookOpen,
    note: "Comprehension, re-ordering and fill-in-the-blanks, scored objectively.",
    visual: <ScanLines rows={5} highlight={2}/>
  },
  {
    key: "listening", name: "Listening", icon: Headphones,
    note: "Dictation, summary and detail tasks against real audio.",
    visual: <div className="ld-transport" aria-hidden="true">
      <span className="ld-transport__play"/>
      <span className="ld-transport__track"><span className="ld-transport__head"/></span>
      <span className="ld-transport__time num-mono">00:41</span>
    </div>
  }
];

function SectionRail() {
  const [ref, inView] = useInView({ threshold: 0.2 });
  return <section className={inView ? "ld-rail is-in" : "ld-rail"} id="evaluation" ref={ref}>
    <div className="ld-rail__head">
      <Label tone="accent">Four skills, one engine</Label>
      <h2 className="ld-h2">Every section measured on its own terms.</h2>
    </div>
    <div className="ld-rail__grid">
      {RAIL.map((item, i) => {
        const Icon = item.icon;
        return <article className="ld-rail__cell" key={item.key} data-section={item.key} style={{ "--ld-i": i }}>
          <div className="ld-rail__visual">{item.visual}</div>
          <h3 className="ld-rail__name"><Icon size={15}/> {item.name}</h3>
          <p className="ld-rail__note">{item.note}</p>
        </article>;
      })}
    </div>
  </section>;
}

/* ---------------------------------------------------------------- capabilities */

function Capabilities() {
  const [ref, inView] = useInView({ threshold: 0.1 });
  return <section className={inView ? "ld-caps is-in" : "ld-caps"} id="capabilities" ref={ref}>
    <div className="ld-caps__head">
      <Label tone="accent">The platform</Label>
      <h2 className="ld-h2">Everything you need to reach your target score.</h2>
    </div>

    <div className="ld-bento">
      <article className="ld-tile ld-tile--wide" style={{ "--ld-i": 0 }}>
        <Label tone="accent">Speaking AI</Label>
        <h3>Hear what the examiner hears.</h3>
        <p>Record a response and get it scored on pronunciation, fluency and content — with the
          specific words that cost you marks.</p>
        <Waveform bars={40} live className="ld-tile__wave"/>
      </article>

      <article className="ld-tile" style={{ "--ld-i": 1 }}>
        <Label tone="accent">Writing AI</Label>
        <h3>Essays and emails, analysed.</h3>
        <p>Grammar, range, form and structure assessed against PTE criteria.</p>
      </article>

      <article className="ld-tile" style={{ "--ld-i": 2 }}>
        <Label tone="accent">Adaptive practice</Label>
        <h3>Work the weak skill.</h3>
        <p>Your section scores decide what is worth practicing next.</p>
      </article>

      <article className="ld-tile ld-tile--tall" style={{ "--ld-i": 3 }}>
        <Label tone="accent">Performance analytics</Label>
        <h3>Progress you can read.</h3>
        <p>Every attempt is kept, so improvement shows up as a trend rather than a feeling.</p>
        <div className="ld-tile__chart">
          <Trajectory points={[64, 69, 71, 76, 79, 84]} animate={inView} height={96}/>
          <div className="ld-tile__chartfoot">
            <Label tone="quiet">6 attempts</Label>
            <Delta metric="Overall" change={20}/>
          </div>
        </div>
      </article>

      <article className="ld-tile" style={{ "--ld-i": 4 }}>
        <Label tone="accent">Mock tests</Label>
        <h3>Full length, timed.</h3>
        <p>Sit a complete paper under exam conditions and get a sectioned report.</p>
      </article>

      <article className="ld-tile" style={{ "--ld-i": 5 }}>
        <Label tone="accent">Question bank</Label>
        <h3>Built for repetition.</h3>
        <p>A growing library across all four sections, with every attempt tracked.</p>
      </article>
    </div>
  </section>;
}

/* ---------------------------------------------------------------- mock tests */

// What a mock actually is in this product, stated accurately: one question per section, twenty
// minutes, scored from the student's own answers. The report figures below are illustrative and
// say so, exactly like the hero's.
const MOCK_REPORT = {
  overall: 87,
  sections: [
    { name: "Speaking",  value: 85, section: "speaking" },
    { name: "Writing",   value: 89, section: "writing" },
    { name: "Reading",   value: 81, section: "reading" },
    { name: "Listening", value: 92, section: "listening" }
  ]
};

const MOCK_FACTS = [
  { value: "4", caption: "Sections in one sitting" },
  { value: "20", unit: "min", caption: "Timed, auto-submitted" },
  { value: "0", unit: "preset", caption: "Scored from your answers" }
];

function MockTests() {
  const [ref, inView] = useInView({ threshold: 0.2 });

  return <section className={inView ? "ld-mock is-in" : "ld-mock"} id="mock-tests" ref={ref}>
    <div className="ld-mock__copy">
      <Label tone="accent">Mock tests</Label>
      <h2 className="ld-h2">Experience the real exam before test day.</h2>
      <p className="ld-lede">
        One question from every section, under a twenty-minute clock that submits for you when
        time runs out. Nothing is preset — the report comes from the answers you gave.
      </p>
      <dl className="ld-mock__facts">
        {MOCK_FACTS.map(fact => <div key={fact.caption}>
          <dt className="num-mono">{fact.value}{fact.unit && <span>{fact.unit}</span>}</dt>
          <dd>{fact.caption}</dd>
        </div>)}
      </dl>
    </div>

    <figure className="ld-report ld-mock__report">
      <figcaption className="ld-report__head">
        <Label tone="accent">Exam report</Label>
        <Label tone="quiet">Sample report</Label>
      </figcaption>
      <div className="ld-report__overall">
        <div>
          <Label>Overall</Label>
          <BigScore value={MOCK_REPORT.overall} outOf={100} animate={inView}/>
        </div>
      </div>
      <div className="ld-report__meters">
        {MOCK_REPORT.sections.map((row, i) => (
          <SectionMeter key={row.section} {...row} outOf={100} delay={i * 90} animate={inView}/>
        ))}
      </div>
    </figure>
  </section>;
}

/* ---------------------------------------------------------------- metrics */

const METRICS = [
  { value: String(TASK_TYPE_COUNT), unit: "", caption: "Practice task types" },
  { value: "4", unit: "", caption: "PTE skills covered" },
  { value: "AI", unit: "", caption: "Powered evaluation" },
  { value: "24", unit: "/7", caption: "Practice access" }
];

function Metrics() {
  const [ref, inView] = useInView({ threshold: 0.3 });
  return <section className={inView ? "ld-metrics is-in" : "ld-metrics"} id="metrics" ref={ref}>
    <Label tone="accent">Built for focused preparation</Label>
    <dl className="ld-metrics__grid">
      {METRICS.map((m, i) => <div className="ld-metrics__item" key={m.caption} style={{ "--ld-i": i }}>
        <dt className="ld-metrics__value num-mono">{m.value}<span>{m.unit}</span></dt>
        <dd className="ld-metrics__caption">{m.caption}</dd>
      </div>)}
    </dl>
  </section>;
}

/* ---------------------------------------------------------------- closing */

function FinalCta({ onSignIn }) {
  return <section className="ld-final">
    <GridField>
      <div className="ld-final__inner">
        <h2 className="ld-display ld-display--sm">Know your score.<br/><em>Know what to improve.</em></h2>
        <button type="button" className="ld-btn ld-btn--primary ld-btn--lg" onClick={onSignIn}>
          Start practicing <ArrowRight size={18}/>
        </button>
      </div>
    </GridField>
  </section>;
}

/* ---------------------------------------------------------------- page */

export default function Landing({ save, theme, toggleTheme }) {
  // Read once on mount and cleared, exactly as the old screen did, so a forced sign-out explains
  // itself. When there is one the sheet opens straight away — a message nobody can see because it
  // is behind a closed panel is not a message.
  const [notice] = useState(() => {
    const value = sessionStorage.getItem("pte_login_notice");
    sessionStorage.removeItem("pte_login_notice");
    return value || "";
  });
  const [signInOpen, setSignInOpen] = useState(() => !!notice);
  const openSignIn = () => setSignInOpen(true);

  return <div className="ld-page">
    <TopNav theme={theme} onToggleTheme={toggleTheme} onSignIn={openSignIn}/>
    <main>
      <Hero onSignIn={openSignIn}/>
      <SectionRail/>
      <Capabilities/>
      <MockTests/>
      <Voices/>
      <Metrics/>
      <FinalCta onSignIn={openSignIn}/>
    </main>
    <SiteFooter links={NAV} brandHref="#top"/>
    <SignInPanel open={signInOpen} onClose={() => setSignInOpen(false)} save={save} notice={notice}/>
  </div>;
}
