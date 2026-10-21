"use client";

import { History, Link2, Send, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { TableScroll } from "@/components/ui/table-scroll";
import { ApiError, internalAction, internalRequest } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { EVENT_LABEL, TELEGRAM_EVENT_TYPES, type TelegramEventType } from "@/lib/telegram-routing";
import type { BrandChannel, BrandHistoryRow, EventFlags } from "@/lib/server/repositories/telegram-brands";

/** Target API grup global (semua brand). */
const API = "/api/internal/telegram-brands/default";

type Msg = { kind: "success" | "error"; text: string } | null;
type VerifyResult = { ok: boolean; status: string; message: string };

const LABEL: Record<string, string> = {
  unverified: "Belum diverifikasi",
  verifying: "Sedang memverifikasi…",
  verified: "Terverifikasi",
  bot_no_access: "Bot belum memiliki akses",
  unsupported_link: "Link tidak didukung",
  target_mismatch: "Gagal diverifikasi",
  not_group: "Gagal diverifikasi",
  failed: "Gagal diverifikasi",
  replace_required: "Perlu konfirmasi penggantian",
};
const TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  unverified: "neutral",
  verifying: "accent",
  verified: "success",
  bot_no_access: "warning",
  unsupported_link: "danger",
  target_mismatch: "danger",
  not_group: "danger",
  failed: "danger",
  replace_required: "warning",
};
const OUTBOX_LABEL: Record<string, string> = {
  pending: "Menunggu",
  processing: "Dikirim",
  retrying: "Menunggu Retry",
  sent: "Terkirim",
  failed: "Gagal",
  skipped: "Dilewati",
  awaiting_destination: "Menunggu Tujuan",
};

function allEvents(): EventFlags {
  return Object.fromEntries(TELEGRAM_EVENT_TYPES.map((e) => [e, true])) as EventFlags;
}

async function postVerify(link: string, replace: boolean): Promise<VerifyResult> {
  try {
    const res = await fetch(`${API}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DTIC-Request": "1" },
      body: JSON.stringify({ link, replace }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; message?: string; error?: string };
    return { ok: res.ok && data.ok === true, status: data.status ?? (res.ok ? "verified" : "failed"), message: data.message ?? data.error ?? `Verifikasi gagal (HTTP ${res.status}).` };
  } catch {
    return { ok: false, status: "failed", message: "Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi." };
  }
}

/** Satu grup Telegram untuk SEMUA brand. Hanya Super Admin; server memeriksa ulang setiap permintaan. */
export function TelegramGlobalGroup({ group, configured }: { group: BrandChannel | null; configured: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [link, setLink] = useState(group?.sourceLink ?? "");
  const [verify, setVerify] = useState<{ busy: boolean; result: VerifyResult | null }>({ busy: false, result: null });
  const [events, setEvents] = useState<EventFlags>(group?.events ?? allEvents());
  const [busy, setBusy] = useState<"save" | "activate" | "test" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [history, setHistory] = useState<BrandHistoryRow[] | null>(null);
  const verified = group?.verificationStatus === "verified";

  async function runVerify(replace: boolean) {
    setVerify({ busy: true, result: null });
    setMsg(null);
    const result = await postVerify(link, replace);
    setVerify({ busy: false, result });
    if (result.ok) setMsg({ kind: "success", text: result.message });
    router.refresh();
  }

  async function save(nextActive: boolean) {
    setBusy(nextActive !== (group?.isActive ?? false) ? "activate" : "save");
    setMsg(null);
    try {
      const r = await internalRequest<{ ok: boolean; recovered?: number }>(API, "PUT", { isActive: nextActive, events });
      const recovered = r.recovered ? ` ${r.recovered} notifikasi yang menunggu tujuan sedang dikirim.` : "";
      setMsg({ kind: "success", text: (nextActive ? "Integrasi Telegram aktif." : "Pengaturan tersimpan.") + recovered });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    const r = await internalAction(`${API}/test`, "POST");
    setMsg({ kind: r.ok ? "success" : "error", text: r.message });
    setBusy(null);
    router.refresh();
  }

  async function disconnect() {
    setBusy("disconnect");
    setMsg(null);
    try {
      const r = await internalRequest<{ ok: boolean; requeued: number }>(API, "DELETE");
      setMsg({ kind: "success", text: `Grup diputuskan.${r.requeued ? ` ${r.requeued} notifikasi yang belum terkirim menunggu grup baru.` : ""}` });
      setLink("");
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
      setConfirmDisconnect(false);
    }
  }

  async function toggleHistory() {
    if (history) return setHistory(null);
    try {
      const res = await fetch(`${API}/history`, { cache: "no-store" });
      const data = (await res.json()) as { rows?: BrandHistoryRow[] };
      setHistory(data.rows ?? []);
    } catch {
      setHistory([]);
    }
  }

  const shown = verify.busy ? "verifying" : verify.result && !verify.result.ok ? verify.result.status : (group?.verificationStatus ?? "unverified");
  const needsReplace = verify.result?.status === "replace_required";

  return (
    <Card>
      <CardHeader
        title="Grup Telegram global"
        description="Semua pengajuan dari seluruh brand dikirim ke satu grup ini. Nama brand dicantumkan di isi pesan."
        action={<Badge tone={group?.isActive && verified ? "success" : "muted"} dot>{group?.isActive && verified ? "Aktif" : "Nonaktif"}</Badge>}
      />
      <div className="flex flex-col gap-5 p-5">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {!configured && <Alert kind="error">TELEGRAM_BOT_TOKEN belum diisi di server. Verifikasi dan pengiriman tidak dapat berjalan.</Alert>}

        <div className="rounded-xl border border-line bg-subtle p-4 text-sm">
          <p className="text-xs text-ink-3">Tujuan notifikasi</p>
          <p className="mt-1 font-semibold text-ink">
            Semua Brand → {group ? `${group.chatTitle ?? "Grup tanpa nama"}${group.topicId ? ` · topik #${group.topicId}` : ""}` : "belum ada grup terhubung"}
          </p>
          {group && <p className="mt-0.5 font-mono text-xs text-ink-3">{group.chatMasked}</p>}
        </div>

        <div>
          <label htmlFor="tg-global-link" className="text-sm font-semibold text-ink">Link grup Telegram</label>
          <input
            id="tg-global-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://t.me/c/2436417110/52942"
            className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="tg-global-help"
          />
          <p id="tg-global-help" className="mt-1 text-xs text-ink-3">
            Tempel link grup atau link pesan. Untuk grup bertopik (mis. Request Desain), klik kanan topik → Copy Link agar pesan masuk ke topik itu. Link undangan (t.me/+…) tidak bisa diverifikasi.
          </p>
        </div>

        <div className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">Status bot & grup</p>
            <Badge tone={TONE[shown] ?? "neutral"} dot>{LABEL[shown] ?? shown}</Badge>
          </div>
          {verify.result && <p className="mt-2 text-sm text-ink-2">{verify.result.message}</p>}
          {group && (
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-ink-3">Diverifikasi</dt><dd className="text-ink-2">{group.verifiedAt ? formatDateTime(group.verifiedAt) : "—"}</dd></div>
              <div>
                <dt className="text-xs text-ink-3">Pesan uji terakhir</dt>
                <dd className="text-ink-2">{group.lastTestedAt ? `${formatDateTime(group.lastTestedAt)} · ${group.lastTestResult === "ok" ? "Berhasil" : "Gagal"}` : "Belum pernah"}</dd>
              </div>
              {group.lastTestResult === "failed" && group.lastTestMessage && <p className="text-xs text-bad sm:col-span-2">{group.lastTestMessage}</p>}
            </dl>
          )}
        </div>

        {needsReplace && (
          <Alert kind="error">
            <p>Grup global sudah terhubung ke grup lain. Mengganti grup akan menonaktifkan integrasi sampai diaktifkan lagi.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => runVerify(true)} loading={verify.busy}>Ganti grup</Button>
              <Button variant="secondary" onClick={() => setVerify({ busy: false, result: null })}>Pertahankan grup sebelumnya</Button>
            </div>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => runVerify(false)} loading={verify.busy} disabled={!link.trim() || verify.busy || busy !== null} icon={<Link2 className="size-4" aria-hidden="true" />}>
            Verifikasi
          </Button>
          <Button variant="secondary" onClick={test} loading={busy === "test"} disabled={!verified || !configured || busy !== null} icon={<Send className="size-4" aria-hidden="true" />}>
            Kirim Pesan Uji
          </Button>
          {group?.isActive ? (
            <Button variant="danger" onClick={() => save(false)} loading={busy === "activate"} disabled={busy !== null}>Nonaktifkan</Button>
          ) : (
            <Button onClick={() => save(true)} loading={busy === "activate"} disabled={!verified || busy !== null} icon={<ShieldCheck className="size-4" aria-hidden="true" />}>
              Aktifkan
            </Button>
          )}
        </div>
        {!verified && <p className="text-xs text-ink-3">Kirim Pesan Uji dan Aktifkan tersedia setelah grup terverifikasi.</p>}

        <fieldset>
          <legend className="text-sm font-semibold text-ink">Jenis notifikasi</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {TELEGRAM_EVENT_TYPES.map((e: TelegramEventType) => (
              <label key={e} className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={events[e]} onChange={(ev) => setEvents({ ...events, [e]: ev.target.checked })} className="size-4 accent-accent" />
                {EVENT_LABEL[e]}
              </label>
            ))}
          </div>
          <Button className="mt-3" variant="secondary" onClick={() => save(group?.isActive ?? false)} loading={busy === "save"} disabled={!verified || busy !== null}>
            Simpan Pengaturan
          </Button>
        </fieldset>

        <div>
          <Button variant="ghost" onClick={toggleHistory} icon={<History className="size-4" aria-hidden="true" />}>{history ? "Sembunyikan riwayat" : "Lihat riwayat pengiriman"}</Button>
          {history && (
            history.length === 0 ? <p className="mt-2 text-sm text-ink-3">Belum ada pengiriman ke grup ini.</p> : (
              <div className="mt-2 max-h-80 overflow-y-auto">
                <TableScroll minWidthPx={560}>
                <table className="w-full text-left text-xs">
                  <thead className="text-ink-3"><tr><th className="py-2 pr-3">Order</th><th className="py-2 pr-3">Event</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Terkirim</th><th className="py-2">Keterangan</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {history.map((h) => (
                      <tr key={h.id} className="align-top">
                        <td className="py-2 pr-3 font-mono text-ink">{h.orderNumber}</td>
                        <td className="py-2 pr-3 text-ink-2">{h.eventLabel}</td>
                        <td className="py-2 pr-3 text-ink-2">{OUTBOX_LABEL[h.status] ?? h.status}</td>
                        <td className="py-2 pr-3 text-ink-2">{h.sentAt ? formatDateTime(h.sentAt) : "—"}</td>
                        <td className="py-2 text-ink-3">{h.lastError ?? "—"}{h.errorCode !== null && <span className="ml-1 font-mono">[kode {h.errorCode}]</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </TableScroll>
              </div>
            )
          )}
        </div>

        {group && (
          <div className="rounded-xl border border-line p-4">
            <p className="text-sm font-semibold text-ink">Putuskan grup</p>
            <p className="mt-1 text-xs text-ink-3">Riwayat tetap tersimpan. Notifikasi pengajuan yang belum terkirim menunggu sampai grup baru dihubungkan dan diaktifkan.</p>
            {confirmDisconnect ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" onClick={disconnect} loading={busy === "disconnect"} disabled={busy !== null}>Ya, putuskan grup</Button>
                <Button variant="secondary" onClick={() => setConfirmDisconnect(false)} disabled={busy !== null}>Batal</Button>
              </div>
            ) : (
              <Button className="mt-3" variant="secondary" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>Putuskan Grup</Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
