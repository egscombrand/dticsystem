import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/permissions";

/**
 * Gerbang cepat di tepi (tanpa database):
 *  - Halaman publik: beranda pengajuan `/`, pencarian `/riwayat`, login `/dtic/login`, layar display
 *    `/dtic/display` (layar TV kantor/ruang tunggu — lihat src/app/dtic/display/page.tsx).
 *  - API publik: `/api/public/*` dan endpoint login/logout.
 *  - Lainnya: wajib cookie sesi. Validasi sesi SEBENARNYA dilakukan di server
 *    (PanelShell & authorize()), jadi cookie palsu tetap ditolak di sana.
 */
const PUBLIC_PAGES = new Set(["/", "/ajukan", "/riwayat", "/bantuan", "/bantuan/riwayat", "/dtic/login", "/dtic/unauthorized", "/dtic/display"]);
const PUBLIC_API_PREFIXES = ["/api/public/", "/api/dtic/auth/"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PAGES.has(pathname) || PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sesi login tidak ditemukan. Silakan masuk kembali." }, { status: 401 });
  }
  const login = new URL("/dtic/login", request.url);
  return NextResponse.redirect(login);
}

export const config = {
  // /api/public dikecualikan: body upload tidak dibuffer oleh proxy (batas proxyClientMaxBodySize).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/public/).*)"],
};
