export function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : "—"; }
export function fmtDateTime(d) { return d ? new Date(d).toLocaleString() : "—"; }
