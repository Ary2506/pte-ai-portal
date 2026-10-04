import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// A horizontally scrolling tab strip with edge arrows instead of a scrollbar.
//
// The scrollbar it replaces was always visible, sat under the tabs on every screen width, and
// gave no hint that there was more to the right until you noticed it. The arrows appear only on
// the side that actually has more content, so an overflowing strip announces itself and a strip
// that fits looks like an ordinary row of tabs.
//
// Scrolling itself is untouched: the strip is still a real scroll container, so a trackpad,
// touch swipe, shift+wheel or keyboard focus all work exactly as before. The arrows are an
// addition, never the only way across.

/** How much of the visible width one arrow press moves. Less than a full page keeps context. */
const PAGE_FRACTION = 0.8;

export default function ScrollTabs({ children, className = "", ...rest }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A one-pixel tolerance: fractional scroll positions mean scrollLeft rarely lands exactly on
    // the maximum, which would otherwise leave the right arrow enabled at the end of the strip.
    const maxScroll = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < maxScroll - 1 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    measure();

    el.addEventListener("scroll", measure, { passive: true });
    // Re-measure when the strip or its contents change size — a window resize, the sidebar
    // collapsing, or tabs being added for a different section.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    for (const child of el.children) observer?.observe(child);
    window.addEventListener("resize", measure);

    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, children]);

  function page(direction) {
    const el = ref.current;
    if (!el) return;
    const by = Math.max(120, el.clientWidth * PAGE_FRACTION) * direction;
    // scrollBy with smooth behaviour; jsdom has no layout, so this is a no-op there rather than
    // a crash, and the tests drive scrollLeft directly instead.
    if (typeof el.scrollBy === "function") el.scrollBy({ left: by, behavior: "smooth" });
    else el.scrollLeft += by;
  }

  return (
    <div className={`scroll-tabs ${className}`.trim()}>
      <button
        type="button"
        className="scroll-tabs__arrow is-left"
        onClick={() => page(-1)}
        // Hidden rather than disabled when there is nothing that way: a control that can never
        // do anything is noise, and screen readers should not meet it at all.
        hidden={!edges.left}
        aria-label="Scroll tabs left"
        tabIndex={-1}
      >
        <ChevronLeft size={18} />
      </button>

      <div className="scroll-tabs__track" ref={ref} {...rest}>
        {children}
      </div>

      <button
        type="button"
        className="scroll-tabs__arrow is-right"
        onClick={() => page(1)}
        hidden={!edges.right}
        aria-label="Scroll tabs right"
        tabIndex={-1}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
