// Calendar date (YYYY-MM-DD) in the browser's own timezone.
//
// Every store used to build this with toISOString().slice(0, 10). That is the
// UTC date, and India is UTC+5:30 — so "30 Oct 2026" parsed as local midnight
// became 2026-10-29T18:30Z and was saved as the 29th. Every machine, inward,
// outward, pending and PO row dated after midnight landed a day early in the
// database and in every report that reads it. Found 2026-10-30 when a machine
// card flipped from "Started 30 Oct 2026" to "Started 2026-10-29" on refetch.
export function localIsoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
