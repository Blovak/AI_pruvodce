export const ADMIN_EMAIL = "patrik.blovsky@gmail.com";

export function isAdminEmail(email: string | null | undefined) {
  return String(email || "").trim().toLowerCase() === ADMIN_EMAIL;
}
