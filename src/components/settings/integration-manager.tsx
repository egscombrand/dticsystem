"use client";

import { RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import type { IntegrationStatus } from "@/lib/server/services/telegram";

const TONE = { not_configured: "warning", untested: "neutral", active: "success", problem: "danger" } as const;
type Msg = { kind: "success" | "error"; text: string } | null;

/** Status pengiriman nyata dari outbox. "Akan dicoba lagi" hanya untuk status RETRYING (jadwal tersimpan). */
const STATUS_LABEL = {
  pending: "Menunggu pengiriman",
  processing: "Sedang dikirim",
  retrying: "Menunggu Retry",
  sent: "Terkirim",
  failed: "Gagal",
  skipped: "Dilewati",
  awaiting_destination: "Menunggu Tujuan",
} as const;

export function IntegrationManager({ status }: { status: IntegrationStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"test" | "retry" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const { outbox } = status;
  const tokenInvalid = status.diagnosis.token === "invalid_format" || status.diagnosis.token === "invalid_api_base";
  const [tokenCheck, setTokenCheck] = useState<{ state: string; message: string } | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkToken() {
    setChecking(true);
    setTokenCheck(null);
    try {
      setTokenCheck(await internalRequest<{ state: string; message: string }>("/api/internal/integrations/telegram/check", "POST"));
    } catch (err) {
      setTokenCheck({ state: "unavailable", message: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setChecking(false);
    }
  }

  async function run(kind: "test" | "retry") {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "test") {
        const r = await internalRequest<{ ok: boolean; message: string }>("/api/internal/integrations/telegram/test", "POST");
        setMsg({ kind: r.ok ? "success" : "error", text: r.message });
      } else {
        const r = await internalRequest<{ attempted: number }>("/api/internal/integrations/telegram/retry", "POST");
        setMsg({ kind: "success", text: r.attempted ? `${r.attempted} notifikasi diproses ulang. Lihat riwayat di bawah.` : "Tidak ada notifikasi tertunda." });
      }
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card>
        <CardHeader
          title="Status integrasi"
          description="Telegram hanya dipakai sebagai kanal notifikasi. Data utama tetap di database."
          action={<Badge tone={TONE[status.state]} dot>{status.stateLabel}</Badge>}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <div>
            <p className="text-xs text-ink-3">TELEGRAM_BOT_TOKEN</p>
            <p className="mt-1 text-sm text-ink">{status.diagnosis.token === "ok" ? "Terisi, format valid (nilai disembunyikan)" : status.diagnosis.token === "missing" ? "Belum diisi" : "Terisi, tetapi tidak valid"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Tujuan notifikasi</p>
            <p className="mt-1 text-sm text-ink">
              Semua brand → grup global ({status.diagnosis.globalGroup === "active" ? "aktif" : status.diagnosis.globalGroup === "inactive" ? "terhubung, belum aktif" : "belum dihubungkan"})
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Worker antrean</p>
            <p className="mt-1 text-sm text-ink">
              {status.worker.enabled
                ? `Berjalan${status.worker.lastTickAt ? ` · tick terakhir ${formatDateTime(status.worker.lastTickAt)}` : ""}`
                : "Tidak berjalan di proses ini (TELEGRAM_WORKER=off atau server belum memulai worker)"}
            </p>
            {status.worker.lastError && <p className="mt-0.5 text-xs text-bad">Tick terakhir gagal: {status.worker.lastError}</p>}
          </div>
          <div>
            <p className="text-xs text-ink-3">Antrean</p>
            <p className="mt-1 text-sm text-ink">
              {outbox.sent} terkirim · {outbox.pending} menunggu · {outbox.awaiting} menunggu tujuan · {outbox.failed} gagal
            </p>
          </div>
        </div>
        {tokenCheck && (
          <p className={`border-t border-line px-5 py-3 text-sm ${tokenCheck.state === "valid" ? "text-accent" : "text-bad"}`}>{tokenCheck.message}</p>
        )}
        {tokenInvalid && (
          <p className="border-t border-line px-5 py-3 text-sm text-warn">
            Token atau chat ID terisi, tetapi formatnya tidak valid. Periksa nilai di environment server.
          </p>
        )}
        {outbox.lastSentAt && <p className="border-t border-line px-5 py-3 text-xs text-ink-3">Pengiriman terakhir berhasil: {formatDateTime(outbox.lastSentAt)}</p>}
        {status.state === "problem" && outbox.lastError && (
          <p className="border-t border-line px-5 py-3 text-sm text-bad">Pengiriman terakhir gagal: {outbox.lastError}</p>
        )}
        <div className="flex flex-wrap gap-3 border-t border-line px-5 py-4">
          <Button variant="secondary" onClick={checkToken} loading={checking} icon={<ShieldCheck className="size-4" aria-hidden="true" />}>
            Periksa token
          </Button>
          <Button onClick={() => run("test")} loading={busy === "test"} disabled={status.state === "not_configured"} icon={<Send className="size-4" aria-hidden="true" />}>
            Kirim notifikasi uji
          </Button>
          <Button
            variant="secondary"
            onClick={() => run("retry")}
            loading={busy === "retry"}
            disabled={status.state === "not_configured" || outbox.pending + outbox.failed + outbox.awaiting === 0}
            icon={<RefreshCw className="size-4" aria-hidden="true" />}
          >
            Kirim ulang yang tertunda
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Cara mengaktifkan" description="Konfigurasi dilakukan di environment server, bukan di browser." />
        <ol className="list-decimal space-y-2 p-5 pl-10 text-sm text-ink-2">
          <li>Buat bot melalui <b>@BotFather</b> di Telegram (kirim <code>/newbot</code>), lalu simpan token yang diberikan.</li>
          <li>Tambahkan bot ke grup tujuan (mis. grup Request Desain). Bila grup berupa kanal, jadikan bot sebagai admin.</li>
          <li>Isi <code>TELEGRAM_BOT_TOKEN</code> dan <code>DTIC_APP_URL</code> (opsional, untuk tautan detail) di environment server, lalu jalankan ulang server.</li>
          <li>Di kartu <b>Grup Telegram global</b> di atas, tempel link grup (atau link topik), klik <b>Verifikasi</b>, <b>Kirim Pesan Uji</b>, lalu <b>Aktifkan</b>. Chat ID tidak perlu diisi manual.</li>
        </ol>
      </Card>

      <Card>
        <CardHeader title="Riwayat pengiriman" description="Pesan galat sudah disaring; token tidak pernah ditampilkan." />
        {outbox.recent.length === 0 ? (
          <p className="p-5 text-sm text-ink-3">Belum ada pengajuan yang masuk ke antrean Telegram.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Order</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Percobaan</th>
                  <th scope="col" className="px-4 py-3 font-medium">Terakhir diperbarui</th>
                  <th scope="col" className="px-4 py-3 font-medium">Galat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {outbox.recent.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3 font-medium text-ink">{r.orderNumber}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{STATUS_LABEL[r.status]}</span>
                      {r.status === "retrying" && <span className="block text-xs text-ink-3">Dicoba ulang {formatDateTime(r.nextAttemptAt)}</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-2">{r.attempts} dari {r.maxAttempts}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-3">{formatDateTime(r.updatedAt)}</td>
                    <td className="px-4 py-3 text-ink-2">{r.lastError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
