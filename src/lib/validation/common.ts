import type { ZodError } from "zod";

export type FieldErrors = Record<string, string>;

/** Ambil pesan pertama per field dari ZodError. */
export function toFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Ambil string dari FormData/objek; nilai non-string dianggap kosong. */
export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
