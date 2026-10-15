import React from "react";
import { Button } from "./Button.jsx";

// React 18 unmounts the entire component tree when a render throws and nothing catches it. With no
// boundary anywhere in this app, a single unexpected value -- a question whose `options` came back
// null, a score that is undefined where a .toFixed() expects a number -- turned the whole site into
// a blank white page, with no way back except a manual reload.
//
// Two levels are used, for different reasons:
//
//   AppErrorBoundary    wraps everything. Last resort; offers a reload.
//   RouteErrorBoundary  wraps the routed page. The layout, navigation and sign-out survive, so a
//                       broken Analytics page leaves the rest of the product usable.
//
// A boundary only catches errors thrown while RENDERING. Errors inside event handlers and promise
// callbacks never reach it -- those still need their own try/catch, which is why this is a safety
// net rather than a substitute for handling failures where they happen.
class ErrorBoundaryBase extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept deliberately: without it the only evidence of a render crash is a blank screen.
    console.error("[ErrorBoundary] a render error was caught:", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Recover automatically when the route changes. Without this, a user who hit an error on one
    // page would keep seeing the fallback after navigating away, because the boundary's state
    // persists across re-renders.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return this.props.fallback(this.state.error, this.reset);
  }
}

function Shell({ title, children }) {
  return (
    <div style={{
      maxWidth: 560, margin: "0 auto", padding: "48px 20px",
      display: "grid", gap: 14, textAlign: "center"
    }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
      {children}
    </div>
  );
}

/** Wraps the whole application. Nothing is left to fall back to, so this offers a reload. */
export function AppErrorBoundary({ children }) {
  return (
    <ErrorBoundaryBase
      fallback={() => (
        <Shell title="Something went wrong">
          <p className="muted" style={{ margin: 0 }}>
            The page could not be displayed. Reloading usually fixes it; your saved work is not affected.
          </p>
          <div>
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
          </div>
        </Shell>
      )}
    >
      {children}
    </ErrorBoundaryBase>
  );
}

/**
 * Wraps the routed page only, so the surrounding layout keeps working.
 *
 * `resetKey` should be the current path: changing it clears the error, so navigating to a working
 * page recovers without a reload.
 */
export function RouteErrorBoundary({ resetKey, children }) {
  return (
    <ErrorBoundaryBase
      resetKey={resetKey}
      fallback={(error, reset) => (
        <Shell title="This page could not be loaded">
          <p className="muted" style={{ margin: 0 }}>
            Something in this section failed to display. The rest of the site is still available —
            use the menu to go elsewhere, or try again.
          </p>
          <div>
            <Button onClick={reset}>Try again</Button>
          </div>
        </Shell>
      )}
    >
      {children}
    </ErrorBoundaryBase>
  );
}

export default AppErrorBoundary;
