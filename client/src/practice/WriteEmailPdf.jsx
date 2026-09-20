import React from "react";
import { Download, FileText } from "lucide-react";

// Write Email's content is the client's own PDF of 12 sample emails, used exactly as supplied —
// not re-typed into individual question records. This bypasses the generic DB-backed
// PracticeTask flow entirely (see Practice.jsx's section === "writing" && slug === "write-email"
// branch), the same way ReadAloudPractice bypasses it for its own fixed, client-curated content.
const PDF_URL = "/writing-resources/write-email-samples.pdf";

export default function WriteEmailPdf() {
  return (
    <section className="panel task-main pdf-resource-panel">
      <div className="task-meta">
        <span className="chip">write-email</span>
      </div>
      <h2>Write Email — Sample Emails</h2>
      <p className="instruction">
        Read through these 12 sample emails to see how a well-structured PTE
        email response looks in practice, then write your own from scratch.
      </p>
      {/* iframe (not <object>) renders reliably across Chrome/Edge/Firefox's built-in PDF
          viewers — <object type="application/pdf"> depends on a plugin some browsers/headless
          environments don't register, silently falling back to blank/fallback content instead. */}
      <iframe
        src={PDF_URL}
        className="pdf-viewer-frame"
        title="Write Email sample answers PDF"
      />
      <div className="pdf-resource-actions">
        <a className="primary" href={PDF_URL} download="write-email-samples.pdf">
          <Download size={16} /> Download PDF
        </a>
        <a className="secondary" href={PDF_URL} target="_blank" rel="noreferrer">
          <FileText size={16} /> Open in new tab
        </a>
      </div>
    </section>
  );
}

export { WriteEmailPdf };
