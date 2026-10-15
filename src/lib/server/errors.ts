import "server-only";
import type { FieldErrors } from "@/lib/validation/common";

/** Error yang aman ditampilkan ke pengguna (tanpa detail internal). */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Data tidak ditemukan.") {
    super(message, 404);
  }
}

/** Kode error Postgres, mis. 23505 (unique_violation). */
export function pgErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

export function pgConstraint(error: unknown): string | undefined {
  if (error && typeof error === "object" && "constraint_name" in error && typeof error.constraint_name === "string")
    return error.constraint_name;
  return undefined;
}
