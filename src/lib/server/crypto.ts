import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM murni (node:crypto) untuk menyimpan rahasia yang HARUS bisa dibaca kembali oleh server
 * (mis. refresh token OAuth Google Drive) — berbeda dari password/session yang cukup di-hash satu arah.
 * Kunci WAJIB dari GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY (32 byte, base64), bukan di-derive dari data lain.
 */
function encryptionKey(): Buffer {
  const raw = process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY belum diisi di environment server.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY harus 32 byte (base64) — gunakan: openssl rand -base64 32.");
  return key;
}

/** Format tersimpan: base64(iv[12] + authTag[16] + ciphertext). */
export function encryptSecret(plainText: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const key = encryptionKey();
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}
