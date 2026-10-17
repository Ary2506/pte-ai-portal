import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    globals: false,
    // Vitest allows 5s per test by default. A test that opens one of the React.lazy routes
    // (Admin, Mock, Progress, History, StudyPlan, Profile) waits for a dynamic import before it
    // can assert anything, and several such waits in one test can exceed that while the whole
    // suite competes for CPU — failing only in a full run, never in isolation. Matches the
    // server's own 15s for consistency; a test that finishes quickly is unaffected.
    testTimeout: 15000
  }
});
