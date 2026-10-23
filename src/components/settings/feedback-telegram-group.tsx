"use client";

import { Link2, Send, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ApiError, internalAction, internalRequest } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import type { FeedbackChannel } from "@/lib/server/repositories/feedback-telegram";

const API = "/api/internal/feedback-telegram";

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

/**
 * Grup Telegram Tim IT untuk notifikasi tiket Bantuan & Masukan — terpisah dari grup notifikasi order.
 * Hanya Super Admin; server memeriksa ulang setiap permintaan (lihat /api/internal/feedback-telegram/*).
 */
export function FeedbackTelegramGroup({ group, configured }: { group: FeedbackChannel | null; configured: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [link, setLink] = useState(group?.sourceLink ?? "");
  const [verify, setVerify] = useState<{ busy: boolean; result: VerifyResult | null }>({ busy: false, result: null });
  const [busy, setBusy] = useState<"activate" | "test" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const verified = group?.verificationStatus === "verified";

  async function runVerify(replace: boolean) {
    setVerify({ busy: true, result: null });
    setMsg(null);
    const result = await postVerify(link, replace);
    setVerify({ busy: false, result });
    if (result.ok) setMsg({ kind: "success", text: result.message });
    router.refresh();
  }

  async function setActive(nextActive: boolean) {
    setBusy("activate");
    setMsg(null);
    try {
      await internalRequest<{ ok: boolean }>(API, "PUT", { isActive: nextActive });
      setMsg({ kind: "success", text: nextActive ? "Integrasi tiket Tim IT aktif." : "Integrasi tiket Tim IT dinonaktifkan." });
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
      await internalRequest<{ ok: boolean }>(API, "DELETE");
      setMsg({ kind: "success", text: "Grup diputuskan. Riwayat tiket tidak terpengaruh." });
      setLink("");
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
      setConfirmDisconnect(false);
    }
  }

  const shown = verify.busy ? "verifying" : verify.result && !verify.result.ok ? verify.result.status : (group?.verificationStatus ?? "unverified");
  const needsReplace = verify.result?.status === "replace_required";

  return (
    <Card>
      <CardHeader
        title="Grup Telegram Tim IT (Bantuan & Masukan)"
        description="Setiap tiket Bantuan & Masukan baru dikirim ke satu grup ini. Terpisah dari grup notifikasi order."
        action={<Badge tone={group?.isActive && verified ? "success" : "muted"} dot>{group?.isActive && verified ? "Aktif" : "Nonaktif"}</Badge>}
      />
      <div className="flex flex-col gap-5 p-5">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {!configured && <Alert kind="error">TELEGRAM_BOT_TOKEN belum diisi di server. Verifikasi dan pengiriman tidak dapat berjalan.</Alert>}

        <div className="rounded-xl border border-line bg-subtle p-4 text-sm">
          <p className="text-xs text-ink-3">Tujuan notifikasi</p>
          <p className="mt-1 font-semibold text-ink">
            Tiket baru → {group ? `${group.chatTitle ?? "Grup tanpa nama"}${group.topicId ? ` · topik #${group.topicId}` : ""}` : "belum ada grup terhubung"}
          </p>
          {group && <p className="mt-0.5 font-mono text-xs text-ink-3">{group.chatMasked}</p>}
        </div>

        <div>
          <label htmlFor="tg-feedback-link" className="text-sm font-semibold text-ink">Link grup Telegram</label>
          <input
            id="tg-feedback-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://t.me/c/2436417110/52942"
            className="mt-1.5 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="tg-feedback-help"
          />
          <p id="tg-feedback-help" className="mt-1 text-xs text-ink-3">
            Tempel link grup atau link pesan (bukan link undangan t.me/+…). Bot harus sudah ditambahkan secara manual ke grup sebelum verifikasi.
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
            <p>Grup Tim IT sudah terhubung ke grup lain. Mengganti grup akan menonaktifkan integrasi sampai diaktifkan lagi.</p>
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
            <Button variant="danger" onClick={() => setActive(false)} loading={busy === "activate"} disabled={busy !== null}>Nonaktifkan</Button>
          ) : (
            <Button onClick={() => setActive(true)} loading={busy === "activate"} disabled={!verified || busy !== null} icon={<ShieldCheck className="size-4" aria-hidden="true" />}>
              Aktifkan
            </Button>
          )}
        </div>
        {!verified && <p className="text-xs text-ink-3">Kirim Pesan Uji dan Aktifkan tersedia setelah grup terverifikasi.</p>}

        {group && (
          <div className="rounded-xl border border-line p-4">
            <p className="text-sm font-semibold text-ink">Putuskan grup</p>
            <p className="mt-1 text-xs text-ink-3">Riwayat tiket tetap tersimpan. Notifikasi tiket baru menunggu sampai grup baru dihubungkan dan diaktifkan.</p>
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
