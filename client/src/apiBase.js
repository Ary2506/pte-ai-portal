// Where the API lives, resolved once for both api.js and mediaUrl.js.
//
// VITE_API_URL is inlined by Vite at BUILD time, not read at runtime. That makes an unset value
// uniquely nasty: the build succeeds, the site deploys, and every request quietly goes to
// http://localhost:5000 -- which on a user's machine is either nothing at all or, worse, some
// unrelated service of theirs. Nothing in the browser says the variable was missing.
//
// The real guard is in vite.config.js, which fails the BUILD when VITE_API_URL is missing. It
// cannot be enforced here: this module is evaluated in the browser, so a throw would only run
// after a bad build had already shipped, turning a deployment mistake into a blank page for every
// visitor. The warning below is a second line of defence for anyone running a build another way.
const configured = import.meta.env.VITE_API_URL;

if (import.meta.env.PROD && !configured) {
  console.error(
    "[config] VITE_API_URL was not set when this build was made, so API calls are going to " +
    "http://localhost:5000 and will fail. Set it in the build environment and rebuild."
  );
}

/** The API root, including the /api prefix. */
export const API_URL = configured || "http://localhost:5000/api";

/** The API's origin, without the /api prefix — question media is mounted above it. */
export const API_ORIGIN = API_URL.replace(/\/api\/?$/, "");
