import React from "react";
import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

// The product's one button. Every tier, size and state lives here so that Next, Submit, Re-do,
// Delete and Cancel are recognisably the same family rather than five independent decisions.
//
// Before this there were 136 hand-written <button> elements across 25 files sharing five loosely
// related classes, eight of them patched with inline styles, Unicode arrows standing in for
// icons, and no loading state anywhere — "Evaluating..." was retyped at each call site with its
// own idea of whether to disable the button.

/**
 * Tiers, in order of how much attention each is allowed to claim:
 *
 *   primary      the one action a screen is for          Submit, Start Mock Test, Sign In
 *   secondary    important, not the point of the screen  View Results, Retry, Re-do
 *   tertiary     low priority, still a real button       Cancel, Back, Show Answer
 *   ghost        quietest; reveals itself on hover       Skip, Clear, inline toggles
 *   success      a completed/affirmative action          Mark Complete
 *   danger       destructive ONLY                        Delete User, Delete Question
 *   link         sits in a sentence, not on a surface    View all
 *
 * Deliberately NOT a tier: "Re-do", "Reset" and "Previous" are secondary or tertiary. Red is
 * reserved for actions that destroy something a person cannot get back.
 */
const VARIANTS = new Set(["primary", "secondary", "tertiary", "ghost", "success", "danger", "link"]);
const SIZES = new Set(["sm", "md", "lg"]);

// Icon scale per button size — kept proportional so a small button never carries a large glyph.
const ICON_SIZES = { sm: 14, md: 16, lg: 18 };

/** The class list is shared by <button> and link-buttons so the two can never drift apart. */
function buttonClasses({ variant, size, loading, success, fullWidth, iconOnly, className }) {
  return [
    "btn",
    `btn--${VARIANTS.has(variant) ? variant : "secondary"}`,
    `btn--${SIZES.has(size) ? size : "md"}`,
    loading && "is-loading",
    success && !loading && "is-success",
    fullWidth && "btn--full",
    iconOnly && "btn--icon-only",
    className
  ].filter(Boolean).join(" ");
}

/** Sizes an icon to the button unless the caller sized it deliberately, and hides it from AT. */
function sizedIcon(icon, size) {
  if (!icon) return null;
  return React.cloneElement(icon, { size: icon.props.size ?? ICON_SIZES[SIZES.has(size) ? size : "md"], "aria-hidden": true });
}

export const Button = React.forwardRef(function Button({
  variant = "secondary",
  size = "md",
  icon = null,
  iconPosition = "left",
  loading = false,
  loadingLabel,
  success = false,
  successLabel,
  fullWidth = false,
  disabled = false,
  type = "button",
  className = "",
  children,
  ...rest
}, ref) {
  const tier = VARIANTS.has(variant) ? variant : "secondary";
  const scale = SIZES.has(size) ? size : "md";

  // A button mid-request must not be pressable again — double submission is the single most
  // common way a student ends up with two attempts for one answer.
  const isDisabled = disabled || loading;

  const label = loading ? (loadingLabel ?? children) : success ? (successLabel ?? children) : children;
  const leading = loading
    ? <Loader2 size={ICON_SIZES[scale]} className="btn__spinner" aria-hidden="true"/>
    : iconPosition === "left" ? sizedIcon(icon, scale) : null;
  const trailing = !loading && iconPosition === "right" ? sizedIcon(icon, scale) : null;

  const classes = buttonClasses({
    variant: tier, size: scale, loading, success, fullWidth, iconOnly: !children, className
  });

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={isDisabled}
      // Announced without needing the label to change: a screen reader hears that the button is
      // busy even where the visible text stays the same.
      aria-busy={loading || undefined}
      {...rest}
    >
      {leading}
      {children && <span className="btn__label">{label}</span>}
      {trailing}
    </button>
  );
});

/**
 * An icon-only button. A separate component rather than a prop, because it has one requirement
 * the others do not: `label` is mandatory. An unexplained icon is not a control, and the label
 * becomes both the accessible name and the tooltip.
 */
export function IconButton({ label, icon, size = "md", variant = "ghost", className = "", ...rest }) {
  if (!label) {
    throw new Error("IconButton requires a `label` — an icon with no accessible name is not a button.");
  }
  return (
    <Button
      variant={variant}
      size={size}
      icon={icon}
      aria-label={label}
      title={label}
      className={`btn--icon ${className}`.trim()}
      {...rest}
    />
  );
}

/**
 * Previous / Next. Forward carries slightly more weight than back, because it is almost always
 * the action someone wants — but Previous stays a real, visible button when disabled rather than
 * vanishing, so the control never shifts position between questions.
 */
export function NavButton({ direction, children, ...rest }) {
  const forward = direction === "next";
  return (
    <Button
      variant={forward ? "secondary" : "tertiary"}
      icon={forward ? <ChevronRight/> : <ChevronLeft/>}
      iconPosition={forward ? "right" : "left"}
      className={`btn--nav is-${direction}`}
      {...rest}
    >
      {children}
    </Button>
  );
}

/**
 * A link that looks and behaves like a button: "Back to Dashboard", "View all attempts",
 * "Download samples". Before this, link-buttons borrowed the raw `.primary`/`.secondary` classes,
 * which is why they sat a few pixels off their real-button neighbours in the same action row.
 *
 * `to` routes internally; `href` renders a plain anchor for a download or an external target.
 * There is deliberately no `loading` or `disabled` — navigation is not an operation that can be
 * in flight, and a disabled link is not a control any browser knows how to express.
 */
export function ButtonLink({
  to, href, variant = "secondary", size = "md", icon = null, iconPosition = "left",
  fullWidth = false, className = "", children, ...rest
}) {
  const classes = buttonClasses({ variant, size, fullWidth, iconOnly: !children, className });
  const content = <>
    {iconPosition === "left" && sizedIcon(icon, size)}
    {children && <span className="btn__label">{children}</span>}
    {iconPosition === "right" && sizedIcon(icon, size)}
  </>;

  if (href) return <a className={classes} href={href} {...rest}>{content}</a>;
  // The className is passed as a function so react-router does not append its own "active" class:
  // a button does not change appearance because it happens to point at the current route, and
  // `.active` is already spoken for by the sidebar.
  return <NavLink className={() => classes} to={to} {...rest}>{content}</NavLink>;
}

export default Button;
