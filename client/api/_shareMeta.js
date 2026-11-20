// Link-preview metadata for a shared answer (/shared-answer/:token).
//
// WhatsApp and similar apps build a preview from the page's <head> without running JavaScript, so
// the tags have to be in the HTML the server sends. shared-answer-page.js serves the normal app
// page with these tags in place of the site's generic ones. The leading underscore keeps this file
// from being deployed as an endpoint of its own.
//
// Only what the public report already shows is used — task, question title, score — never a
// name, an id or a storage key. A link that is invalid, expired or revoked gets generic tags that
// say nothing about any answer.

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const TASK_CODES = {
  "read-aloud": "RA", "repeat-sentence": "RS", "describe-image": "DI",
  "answer-short-question": "ASQ", "respond-to-situation": "RTS"
};

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The preview text for one shared report, or the generic text when there is no valid report. */
export function shareMeta(report, pageUrl) {
  if (!report) {
    return {
      title: "Shared answer · PTE CORE AI",
      description: "This shared answer is not available. Practise PTE Core with AI scoring on PTE CORE AI.",
      url: pageUrl
    };
  }
  const code = TASK_CODES[report.taskType];
  const subject = report.questionTitle || report.taskLabel;
  const score = Number.isFinite(report.score) && Number.isFinite(report.maxScore) ? ` · PTE CORE AI Score ${report.score}/${report.maxScore}` : " · PTE CORE AI";
  return {
    title: `${code ? `${code} · ` : ""}${subject}${score}`,
    description: `${report.taskLabel} answer shared from PTE CORE AI. Listen to the recording and see the AI score and feedback.`,
    url: pageUrl
  };
}

/** The <head> tags for that preview. No og:image: the site has no raster brand image yet. */
export function metaTags({ title, description, url }) {
  const t = escapeHtml(title), d = escapeHtml(description), u = escapeHtml(url);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta name="robots" content="noindex, nofollow, noarchive" />`,
    `<meta property="og:site_name" content="PTE CORE AI" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${u}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`
  ].join("\n  ");
}

/**
 * The app's index.html with its generic title, description and og/twitter tags replaced by
 * `tags`. Nothing else in the page changes, so the React app loads exactly as it always does.
 */
export function withShareMeta(indexHtml, tags) {
  const stripped = indexHtml
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+(?:name="(?:description|robots|twitter:[^"]*)"|property="og:[^"]*")[^>]*>\s*/gi, "");
  return stripped.replace(/<\/head>/i, `  ${tags}\n</head>`);
}
