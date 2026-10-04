import React from "react";
import { BadgeCheck } from "lucide-react";
import { Label } from "./Instruments.jsx";
import { useInView } from "./motion.js";

// ============================================================================
// PLACEHOLDER CONTENT — REPLACE BEFORE THIS IS SHOWN TO REAL STUDENTS.
//
// These names and quotes are invented. They are here to build and size the
// section, not to be published as genuine feedback: presenting made-up quotes
// as real student experience misleads the people deciding whether to pay for
// the product, and is the kind of claim that is hard to walk back later.
//
// Swap this array for real, consented feedback and the section works unchanged.
// If there is no real feedback yet, remove <Voices/> from Landing.jsx rather
// than shipping these.
// ============================================================================
export const SAMPLE_FEEDBACK = [
  { name: "Harpreet Kaur",   quote: "The section scores finally told me it was listening holding me back, not speaking." },
  { name: "Daniel Okafor",   quote: "Re-doing the same reorder questions until they clicked is what moved my reading." },
  { name: "Mei Lin Chong",   quote: "Getting a score the moment I submit meant I actually practiced every day." },
  { name: "Arjun Mehta",     quote: "The mock test felt close enough to the real thing that exam day wasn't a shock." },
  { name: "Sofia Almeida",   quote: "Seeing fluency and pronunciation scored separately told me exactly what to drill." },
  { name: "Nguyen Thi Hoa",  quote: "I stopped guessing what to study. The weakest section was just there on screen." },
  { name: "Omar Haddad",     quote: "Being able to replay my own recording next to the score changed how I practice." },
  { name: "Priya Raghavan",  quote: "Four weeks of short daily sessions did more than my old weekend cramming." }
];

// A fixed palette indexed by position — deterministic, so an avatar keeps its colour between
// renders instead of flickering to a new one each time the marquee re-paints.
const AVATAR_TONES = ["a", "b", "c", "d", "e", "f"];

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
}

function VoiceCard({ person, index }) {
  return <article className="ld-voice">
    <span className={`ld-voice__avatar ld-voice__avatar--${AVATAR_TONES[index % AVATAR_TONES.length]}`} aria-hidden="true">
      {initials(person.name)}
    </span>
    <div className="ld-voice__body">
      <h4 className="ld-voice__name">{person.name}</h4>
      <p className="ld-voice__quote">{person.quote}</p>
    </div>
  </article>;
}

const POINTS = [
  {
    title: "Measured, not guessed",
    body: "Every answer is scored against PTE criteria, so progress is a number you can check rather than a feeling."
  },
  {
    // Replaces the reference's mentor line: this product has no mentors, and claiming them
    // would be the one thing on the page that is not true.
    title: "Practice that follows your weakest skill",
    body: "Your section scores decide what is worth doing next, so study time lands where it changes the score."
  },
  {
    title: "Confidence beyond the exam",
    body: "The speaking, writing and listening you drill here is the English you keep using after test day."
  }
];

export default function Voices() {
  const [ref, inView] = useInView({ threshold: 0.15 });

  return <section className={inView ? "ld-trust is-in" : "ld-trust"} id="voices" ref={ref}>
    <div className="ld-trust__copy">
      <Label tone="accent">Why it works</Label>
      <h2 className="ld-h2">Built for learners.<br/>Built for the score.</h2>

      <ul className="ld-points">
        {POINTS.map((point, i) => <li className="ld-point" key={point.title} style={{ "--ld-i": i }}>
          <BadgeCheck size={18} className="ld-point__icon"/>
          <div>
            <h3>{point.title}</h3>
            <p>{point.body}</p>
          </div>
        </li>)}
      </ul>
    </div>

    {/* The column scrolls itself. The first copy is the real, readable list; the second is a
        duplicate hidden from assistive tech, which is what makes the loop seamless — without it
        the track would visibly snap back to the top on every cycle. */}
    <div className="ld-marquee">
      <div className="ld-marquee__track">
        <div className="ld-marquee__set">
          {SAMPLE_FEEDBACK.map((person, i) => <VoiceCard key={person.name} person={person} index={i}/>)}
        </div>
        <div className="ld-marquee__set" aria-hidden="true">
          {SAMPLE_FEEDBACK.map((person, i) => <VoiceCard key={`${person.name}-dup`} person={person} index={i}/>)}
        </div>
      </div>
    </div>
  </section>;
}
