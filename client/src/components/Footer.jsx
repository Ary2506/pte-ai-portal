import React from "react";
import { NavLink } from "react-router-dom";

// The product's footer — one component, used by both the signed-in app and the landing page.
//
// The landing page used to carry a footer of its own (`ld-footer`), built from the landing
// stylesheet's own tokens. It was a second implementation of the same thing, which is how the two
// came to disagree: only one of them carried the copyright notice.
//
// The only thing that legitimately differs between the two surfaces is where the links point. A
// signed-out visitor cannot go to /history — that route bounces them to sign-in — so the landing
// page passes anchors to its own sections instead. Everything else, including the wordmark, the
// layout and the notice, is shared.

/** Where the footer links go for someone who is signed in. */
export const APP_FOOTER_LINKS = [
  { label: "Practice", to: "/practice" },
  { label: "Mock Tests", to: "/mock" },
  { label: "My Results", to: "/history" },
  { label: "Progress", to: "/progress" },
  { label: "Study Plan", to: "/plan" }
];

export default function Footer({ links = APP_FOOTER_LINKS, brandHref }) {
  // Derived from the clock rather than written into the markup, so the notice cannot go stale.
  const year = new Date().getFullYear();
  const Brand = brandHref ? "a" : "div";

  return (
    <footer className="app-footer">
      <Brand className="app-footer__brand" {...(brandHref ? { href: brandHref } : {})}>
        <span className="brand-mark" aria-hidden="true">P</span>
        <span className="brand-text">PTE CORE <em>AI</em></span>
      </Brand>
      <nav className="app-footer__links" aria-label="Footer">
        {links.map(link => (link.href
          ? <a key={link.label} href={link.href}>{link.label}</a>
          : <NavLink key={link.label} to={link.to}>{link.label}</NavLink>))}
      </nav>
      <p className="app-footer__legal">
        Copyright © {year} PTE CORE AI. All Rights Reserved.
      </p>
    </footer>
  );
}
