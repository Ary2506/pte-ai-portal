import { defineConfig, loadEnv } from "vite";

// Deliberately minimal. Before this file existed the build ran on Vite's defaults, and that is
// still what it does -- esbuild handles the JSX in .jsx files on its own, so no plugin is needed
// for a production build. The only thing added here is a build-time check.
//
// Why it has to live in the config rather than in application code: VITE_API_URL is inlined by
// Vite at BUILD time. A `throw` inside a module only runs when that module is evaluated, which is
// in the user's browser, long after a bad build has already shipped. Checking here fails the build
// instead, which is the only point at which the mistake is still cheap to fix.
function requireApiUrlForProductionBuilds() {
  return {
    name: "require-api-url-for-production-builds",
    config(_config, { command, mode }) {
      if (command !== "build") return;
      // Read through loadEnv so a value in .env / .env.production counts, exactly as it would for
      // the build itself -- not just one exported in the shell.
      const env = loadEnv(mode, process.cwd(), "VITE_");
      if (env.VITE_API_URL) return;
      throw new Error(
        "\n\nVITE_API_URL is not set, so this build would ship pointing at http://localhost:5000.\n" +
        "Vite inlines the value at build time, so it cannot be corrected after deployment: every\n" +
        "API call and every admin-uploaded image would fail in the browser with no server-side\n" +
        "trace. Set VITE_API_URL in the hosting provider's build environment and rebuild.\n"
      );
    }
  };
}

export default defineConfig({
  plugins: [requireApiUrlForProductionBuilds()]
});
