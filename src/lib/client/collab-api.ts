import { ApiError } from "@/lib/client/api";
import type { FieldErrors } from "@/lib/validation/common";
import { parseStoredOrderNumbers, rememberOrderNumber, forgetOrderNumber } from "@/lib/collab";

type ErrBody = { error?: string; fieldErrors?: FieldErrors };

async function parse<T>(res: Response): Promise<T> {
  let data: ErrBody & Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    // respons non-JSON
  }
  if (!res.ok) throw new ApiError(data.error ?? `Permintaan gagal (HTTP ${res.status}).`, res.status, data.fieldErrors);
  return data as T;
}

const NETWORK = "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.";

export async function collabGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(NETWORK, 0);
  }
  return parse<T>(res);
}

/** Kirim multipart (pesan/berkas). Content-Type diatur browser (boundary). */
export async function collabPostForm<T>(url: string, form: FormData, headers?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, cache: "no-store", headers });
  } catch {
    throw new ApiError(NETWORK, 0);
  }
  return parse<T>(res);
}

// ---------------------------------------------------------------- "Request saya" (nomor order di browser ini)

const KEY = "dtic.myRequests.v1";

export function loadMyRequests(): string[] {
  try {
    return parseStoredOrderNumbers(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // penyimpanan diblokir: daftar tidak tersimpan, fitur lain tetap jalan
  }
}

export function rememberMyRequest(orderNumber: string): string[] {
  const next = rememberOrderNumber(loadMyRequests(), orderNumber);
  save(next);
  return next;
}

export function forgetMyRequest(orderNumber: string): string[] {
  const next = forgetOrderNumber(loadMyRequests(), orderNumber);
  save(next);
  return next;
}
