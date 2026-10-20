/**
 * ADMIN_EMAILS is a comma-separated allow-list of account emails. Account
 * emails are verified (Google, or a one-time code), so matching one is
 * enough. Unset or empty means nobody is an admin.
 */
export function isAdminEmail(
  email: string | null | undefined,
  list = process.env.ADMIN_EMAILS ?? "",
): boolean {
  if (!email) return false;
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}
