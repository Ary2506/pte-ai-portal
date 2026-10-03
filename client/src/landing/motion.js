import { useEffect, useRef, useState } from "react";

// Motion helpers for the landing page. There is no animation library in this project and the
// redesign does not justify adding one, so these are small rAF/IntersectionObserver hooks.
//
// Every one of them checks prefers-reduced-motion and, when it is set, jumps straight to the
// finished state rather than animating quickly. A count-up that still counts, only faster, is
// exactly what that setting exists to prevent.

export function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Eases out hard at the start and settles — a score landing on its value, not drifting to it.
const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Counts from 0 to `target` once `start` is true. Returns the current value, already rounded.
 */
export function useCountUp(target, { duration = 1100, start = true, decimals = 0 } = {}) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));

  useEffect(() => {
    if (!start) return;
    if (prefersReducedMotion()) { setValue(target); return; }
    // jsdom has no rAF timing worth animating through, and a test should see the final number.
    if (typeof requestAnimationFrame !== "function") { setValue(target); return; }

    let frame = 0;
    const began = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      const raw = target * easeOutExpo(t);
      const factor = 10 ** decimals;
      setValue(Math.round(raw * factor) / factor);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, start, decimals]);

  return value;
}

/**
 * Attaches to an element and reports when it first scrolls into view, so entrances fire where the
 * reader actually is rather than all at once on load. Stays true once fired — a section that
 * re-animated every time it scrolled past would be noise.
 */
export function useInView({ threshold = 0.25, once = true } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const node = ref.current;
    // No IntersectionObserver (jsdom, older browsers): show the content rather than hide it.
    if (!node || typeof IntersectionObserver !== "function") { setInView(true); return; }
    if (prefersReducedMotion()) { setInView(true); return; }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        if (once) observer.disconnect();
      } else if (!once) setInView(false);
    }, { threshold });

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, once]);

  return [ref, inView];
}
