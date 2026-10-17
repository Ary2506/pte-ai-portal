import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Testing Library waits 1000ms by default for findBy*/waitFor. That was enough while every route
// was in one bundle, but Admin, Mock, Progress, History, StudyPlan and Profile are now React.lazy
// chunks: their first render returns the Suspense fallback and the real page only appears once the
// dynamic import resolves. With the whole suite competing for CPU that import can take longer than
// a second, so tests that opened those pages failed intermittently -- always passing in isolation,
// which is the signature of a timing problem rather than a broken assertion.
//
// Five seconds only raises the ceiling; a query that resolves quickly still returns immediately,
// so this slows nothing down and weakens no assertion. It does not paper over a real failure
// either: a page that never renders still fails, just five seconds later.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
