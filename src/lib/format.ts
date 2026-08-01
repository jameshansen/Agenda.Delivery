export function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
