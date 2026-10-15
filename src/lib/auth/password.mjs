/**
 * Hash & verifikasi password memakai scrypt (node:crypto), tanpa dependensi tambahan.
 * Format tersimpan: scrypt$N$r$p$<saltBase64>$<hashBase64>. Tidak ada import alias agar
 * modul ini juga bisa dijalankan skrip bootstrap (node --experimental-strip-types).
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, passwordPolicyError } from "./policy.mjs";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** @param {string} password @param {Buffer} salt @param {number} n @param {number} r @param {number} p @returns {Promise<Buffer>} */
function deriveKey(password, salt, n, r, p) {
  const options = { N: n, r, p, maxmem: 64 * 1024 * 1024 };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** @param {string} password @returns {Promise<string>} */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** @param {string} password @param {string} stored @returns {Promise<boolean>} */
export async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await deriveKey(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash dummy untuk menyamakan waktu respons saat email tidak terdaftar (mencegah enumerasi). */
/** @type {Promise<string> | null} */
let dummyHash = null;
/** @returns {Promise<string>} */
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64"));
  return dummyHash;
}
