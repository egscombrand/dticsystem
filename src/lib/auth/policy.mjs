/**
 * Kebijakan kata sandi. Tanpa dependensi Node sehingga aman dipakai di browser maupun server.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

/** @param {string} password @returns {string | null} */
export function passwordPolicyError(password) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Kata sandi maksimal ${MAX_PASSWORD_LENGTH} karakter.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Kata sandi harus memuat huruf dan angka.";
  return null;
}
