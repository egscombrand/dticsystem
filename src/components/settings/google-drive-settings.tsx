"use client";

import { BookOpen, FlaskConical, FolderSync, Link2, Link2Off, Power, PowerOff, ScrollText, Zap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { TableScroll } from "@/components/ui/table-scroll";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { DRIVE_ADMIN_STATUS_LABEL, DRIVE_ADMIN_STATUS_TONE, type DriveAdminStatus } from "@/lib/drive";

type FailedSync = { orderId: string; orderNumber: string; fileName: string; syncError: string | null; updatedAt: string };

type MemberSyncSummary = { processed: number; created: number; existing: number; failed: number; failedMembers: { memberId: string; memberName: string; error: string }[] };

export type GoogleDriveSettingsProps = {
  status: DriveAdminStatus;
  configOk: boolean;
  configProblem: string | null;
  rootFolderId: string | null;
  usesSharedDrive: boolean;
  authMethod: string | null;
  enabled: boolean;
  enabledAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  tableReady: boolean;
  failedSyncCount: number | null;
  failedSyncs: FailedSync[];
  /** Status SINKRONISASI FOLDER ANGGOTA — konsep terpisah dari status koneksi (lastTest*) dan status upload hasil (failedSync*). */
  lastMemberSyncAt: string | null;
  lastMemberSyncOk: boolean | null;
  lastMemberSyncSummary: MemberSyncSummary | null;
  /** OAuth (akun pemilik folder) — diutamakan untuk UPLOAD isi file karena service account tidak punya kuota penyimpanan sendiri. */
  oauthConfigured: boolean;
  oauthConnected: boolean;
  oauthAccountEmail: string | null;
  oauthConnectedAt: string | null;
};

type Msg = { kind: "success" | "error"; text: string } | null;

type SimulationPlanResponse = {
  dryRun: true;
  testRunId: string;
  picFoldersDetected: number;
  ambiguousDriveFolders: { id: string; name: string }[];
  plan: { memberName: string; path: string; filesToCreate: string[] }[];
};
type SimulationRunResponse = {
  dryRun: false;
  testRunId: string;
  picFoldersProcessed: number;
  ambiguousDriveFolders: { id: string; name: string }[];
  items: { memberId: string; memberName: string; foldersCreated: number; foldersExisting: number; filesCreated: number; filesExisting: number; error?: string }[];
};

/**
 * Dashboard Super Admin untuk integrasi Drive A. Kredensial TIDAK PERNAH dikirim ke komponen ini — hanya
 * status (boolean/teks ringkas tanpa nilai rahasia) yang dirender server di page.tsx.
 */
export function GoogleDriveSettings(props: GoogleDriveSettingsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<"test" | "enable" | "disable" | "sync-members" | "sim-preview" | "sim-apply" | "oauth-disconnect" | null>(null);
  const [msg, setMsg] = useState<Msg>(() => {
    const oauth = searchParams.get("oauth");
    if (!oauth) return null;
    const message = searchParams.get("oauthMessage");
    return { kind: oauth === "connected" ? "success" : "error", text: oauth === "connected" ? "Berhasil terhubung ke Google Drive (OAuth)." : message ?? "Gagal menghubungkan OAuth Google Drive." };
  });

  useEffect(() => {
    if (searchParams.get("oauth")) router.replace("/dtic/settings/integrations/google-drive");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [memberSyncOpen, setMemberSyncOpen] = useState(false);
  const [simPlan, setSimPlan] = useState<SimulationPlanResponse | null>(null);
  const [simResult, setSimResult] = useState<SimulationRunResponse | null>(null);
  const [confirmSimApply, setConfirmSimApply] = useState(false);

  async function run(kind: "test" | "enable" | "disable") {
    setBusy(kind);
    setMsg(null);
    try {
      const path = kind === "test" ? "/api/internal/integrations/drive/test" : kind === "enable" ? "/api/internal/integrations/drive/enable" : "/api/internal/integrations/drive/disable";
      const r = await internalRequest<{ ok: boolean; message: string }>(path, "POST");
      setMsg({ kind: r.ok ? "success" : "error", text: r.message });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
      setConfirmDisable(false);
    }
  }

  async function runMemberSync() {
    setBusy("sync-members");
    setMsg(null);
    try {
      const r = await internalRequest<{ ok: boolean; summary: MemberSyncSummary }>("/api/internal/integrations/drive/sync-members", "POST");
      const s = r.summary;
      setMsg({
        kind: r.ok ? "success" : "error",
        text: `Sinkronisasi folder anggota selesai: ${s.processed} anggota diproses, ${s.created} folder baru dibuat, ${s.existing} folder sudah ada (dipakai ulang), ${s.failed} gagal.`,
      });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
    }
  }

  async function runSimPreview() {
    setBusy("sim-preview");
    setMsg(null);
    setSimResult(null);
    try {
      const r = await internalRequest<SimulationPlanResponse>("/api/internal/integrations/drive/simulate-test-data", "POST", { apply: false });
      setSimPlan(r);
      setMsg({ kind: "success", text: `Pratinjau dibuat: ${r.picFoldersDetected} folder PIC terdeteksi${r.ambiguousDriveFolders.length ? `, ${r.ambiguousDriveFolders.length} folder ambigu dilewati` : ""}. Belum ada perubahan di Drive.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
    }
  }

  async function runSimApply() {
    setBusy("sim-apply");
    setMsg(null);
    try {
      const r = await internalRequest<SimulationRunResponse>("/api/internal/integrations/drive/simulate-test-data", "POST", { apply: true });
      setSimResult(r);
      const failed = r.items.filter((i) => i.error).length;
      setMsg({ kind: failed === 0 ? "success" : "error", text: `Simulasi dijalankan: ${r.picFoldersProcessed} PIC diproses, ${failed} gagal. test_run_id: ${r.testRunId}` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
      setConfirmSimApply(false);
    }
  }

  async function disconnectOAuth() {
    setBusy("oauth-disconnect");
    setMsg(null);
    try {
      const r = await internalRequest<{ ok: boolean; message: string }>("/api/internal/integrations/drive/oauth/disconnect", "POST");
      setMsg({ kind: "success", text: r.message });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Permintaan gagal. Coba lagi." });
    } finally {
      setBusy(null);
    }
  }

  const canTest = props.configOk;
  const canEnable = props.configOk && props.tableReady && props.lastTestOk === true && !props.enabled;
  const canSyncMembers = props.enabled;

  return (
    <div className="flex flex-col gap-5">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card>
        <CardHeader
          title="Koneksi OAuth (akun pemilik folder)"
          description='Diutamakan untuk mengunggah ISI file — service account tidak memiliki kuota penyimpanan sendiri dan akan gagal (HTTP 403) di luar Shared Drive. Folder tetap bisa dibuat/dibaca lewat service account tanpa ini.'
          action={<Badge tone={props.oauthConnected ? "success" : "muted"} dot>{props.oauthConnected ? "Terhubung" : "Belum terhubung"}</Badge>}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs text-ink-3">Akun terhubung</p>
            <p className="mt-1 text-sm text-ink">{props.oauthAccountEmail ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Terhubung sejak</p>
            <p className="mt-1 text-sm text-ink">{props.oauthConnectedAt ? formatDateTime(props.oauthConnectedAt) : "—"}</p>
          </div>
        </div>
        {!props.oauthConfigured && (
          <p className="border-t border-line px-5 py-3 text-sm text-warn">
            GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY belum diisi di environment server — tombol di bawah tidak dapat dipakai sampai terisi.
          </p>
        )}
        <div className="flex flex-wrap gap-3 border-t border-line px-5 py-4">
          {props.oauthConnected ? (
            <Button variant="danger" onClick={disconnectOAuth} loading={busy === "oauth-disconnect"} icon={<Link2Off className="size-4" aria-hidden="true" />}>
              Putuskan Koneksi
            </Button>
          ) : props.oauthConfigured ? (
            <a href="/api/internal/integrations/drive/oauth/connect" className={buttonClass("primary", "md")}>
              <Link2 className="size-4" aria-hidden="true" />
              Hubungkan dengan Google
            </a>
          ) : (
            <Button disabled icon={<Link2 className="size-4" aria-hidden="true" />}>
              Hubungkan dengan Google
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Status integrasi"
          description="Google Drive A hanya menjadi aktif setelah Uji Koneksi berhasil DAN Super Admin menekan Aktifkan."
          action={<Badge tone={DRIVE_ADMIN_STATUS_TONE[props.status]} dot>{DRIVE_ADMIN_STATUS_LABEL[props.status]}</Badge>}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-ink-3">Folder tujuan (Drive A)</p>
            <p className="mt-1 text-sm text-ink">{props.rootFolderId ?? "Belum diisi"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Shared Drive</p>
            <p className="mt-1 text-sm text-ink">{props.configOk ? (props.usesSharedDrive ? "Dipakai" : "Tidak dipakai (My Drive service account)") : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Pengujian terakhir</p>
            <p className="mt-1 text-sm text-ink">{props.lastTestAt ? `${formatDateTime(props.lastTestAt)} · ${props.lastTestOk ? "Berhasil" : "Gagal"}` : "Belum pernah diuji"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">File gagal disinkronkan</p>
            <p className="mt-1 text-sm text-ink">{props.failedSyncCount === null ? "Tidak dapat dihitung (migration belum diterapkan)" : `${props.failedSyncCount} file`}</p>
          </div>
        </div>
        {props.enabled && props.enabledAt && <p className="border-t border-line px-5 py-3 text-xs text-ink-3">Diaktifkan sejak {formatDateTime(props.enabledAt)}</p>}
        {props.lastTestMessage && (
          <p className={`border-t border-line px-5 py-3 text-sm ${props.lastTestOk ? "text-ink-2" : "text-bad"}`}>{props.lastTestMessage}</p>
        )}
        {!props.tableReady && (
          <p className="border-t border-line px-5 py-3 text-sm text-warn">
            Tabel pengaturan integrasi (drive_integration_settings) belum diterapkan di database. Uji koneksi tetap bisa dijalankan, tetapi hasilnya tidak dapat disimpan dan integrasi tidak dapat diaktifkan sampai migration diterapkan.
          </p>
        )}

        <div className="flex flex-wrap gap-3 border-t border-line px-5 py-4">
          <Button variant="secondary" onClick={() => run("test")} loading={busy === "test"} disabled={!canTest} icon={<Zap className="size-4" aria-hidden="true" />}>
            Uji Koneksi
          </Button>
          {props.enabled ? (
            <Button variant="danger" onClick={() => setConfirmDisable(true)} loading={busy === "disable"} icon={<PowerOff className="size-4" aria-hidden="true" />}>
              Nonaktifkan Integrasi
            </Button>
          ) : (
            <Button onClick={() => run("enable")} loading={busy === "enable"} disabled={!canEnable} icon={<Power className="size-4" aria-hidden="true" />}>
              Aktifkan Integrasi
            </Button>
          )}
          <Button variant="ghost" onClick={() => setGuideOpen(true)} icon={<BookOpen className="size-4" aria-hidden="true" />}>
            Lihat Panduan Setup
          </Button>
          <Button variant="ghost" onClick={() => setLogOpen(true)} icon={<ScrollText className="size-4" aria-hidden="true" />}>
            Lihat Log Sinkronisasi
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Folder anggota DTIC"
          description="Satu folder per anggota AKTIF, langsung di bawah folder akar Drive A (tanpa folder perantara). Status ini TERPISAH dari status koneksi di atas — Uji Koneksi berhasil tidak berarti folder anggota sudah dibuat."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <div>
            <p className="text-xs text-ink-3">Sinkronisasi terakhir</p>
            <p className="mt-1 text-sm text-ink">
              {props.lastMemberSyncAt ? `${formatDateTime(props.lastMemberSyncAt)} · ${props.lastMemberSyncOk ? "Berhasil" : "Ada kegagalan"}` : "Belum pernah dijalankan"}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Hasil terakhir</p>
            <p className="mt-1 text-sm text-ink">
              {props.lastMemberSyncSummary
                ? `${props.lastMemberSyncSummary.processed} diproses · ${props.lastMemberSyncSummary.created} dibuat · ${props.lastMemberSyncSummary.existing} sudah ada · ${props.lastMemberSyncSummary.failed} gagal`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Syarat</p>
            <p className="mt-1 text-sm text-ink">{props.enabled ? "Integrasi aktif" : "Aktifkan integrasi terlebih dahulu"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          <Button onClick={runMemberSync} loading={busy === "sync-members"} disabled={!canSyncMembers} icon={<FolderSync className="size-4" aria-hidden="true" />}>
            Sinkronkan Folder Anggota
          </Button>
          {props.lastMemberSyncSummary && props.lastMemberSyncSummary.failed > 0 && (
            <Button variant="ghost" onClick={() => setMemberSyncOpen(true)}>
              Lihat {props.lastMemberSyncSummary.failed} kegagalan
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Data simulasi (UAT)"
          description='Buat struktur folder & file dummy bertanda "TESTING" di dalam folder PIC yang sudah ada, untuk pengujian manual. Tidak pernah menyentuh data produksi. Selalu tinjau pratinjau sebelum menjalankan.'
        />
        <div className="flex flex-wrap items-center gap-3 p-5">
          <Button variant="secondary" onClick={runSimPreview} loading={busy === "sim-preview"} disabled={!props.enabled} icon={<FlaskConical className="size-4" aria-hidden="true" />}>
            Pratinjau Simulasi
          </Button>
          <Button onClick={() => setConfirmSimApply(true)} loading={busy === "sim-apply"} disabled={!simPlan || simPlan.plan.length === 0}>
            Jalankan Simulasi Sungguhan
          </Button>
        </div>
        {simPlan && (
          <div className="border-t border-line px-5 py-4 text-sm text-ink-2">
            <p className="mb-2 font-medium text-ink">Rencana ({simPlan.picFoldersDetected} folder PIC terdeteksi):</p>
            <ul className="list-disc space-y-1 pl-5">
              {simPlan.plan.map((p) => (
                <li key={p.memberName}>
                  <span className="font-medium text-ink">{p.memberName}</span> → <code className="text-xs">{p.path}</code>
                </li>
              ))}
            </ul>
            {simPlan.ambiguousDriveFolders.length > 0 && (
              <p className="mt-2 text-warn">
                Dilewati (tidak cocok anggota aktif manapun): {simPlan.ambiguousDriveFolders.map((f) => f.name).join(", ")}
              </p>
            )}
          </div>
        )}
        {simResult && (
          <div className="border-t border-line px-5 py-4 text-sm text-ink-2">
            <p className="mb-2 font-medium text-ink">Hasil nyata (test_run_id: {simResult.testRunId}):</p>
            <ul className="list-disc space-y-1 pl-5">
              {simResult.items.map((i) => (
                <li key={i.memberId}>
                  <span className="font-medium text-ink">{i.memberName}</span>: {i.error ? <span className="text-bad">gagal — {i.error}</span> : `${i.foldersCreated} folder baru, ${i.foldersExisting} folder dipakai ulang, ${i.filesCreated} file baru, ${i.filesExisting} file dipakai ulang`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Konfigurasi" description="Kredensial dan folder diatur lewat environment variable server, bukan di sini." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs text-ink-3">Metode autentikasi</p>
            <p className="mt-1 text-sm text-ink">{props.authMethod ?? "Belum dikonfigurasi"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-3">Status konfigurasi</p>
            <p className="mt-1 text-sm text-ink">{props.configOk ? "Lengkap" : props.configProblem ?? "Belum diisi"}</p>
          </div>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
          Dashboard ini tidak dapat mengubah atau menyimpan kredensial Google. Private key/token tidak pernah dikirim ke peramban atau dicatat ke log.
        </p>
      </Card>

      <Modal open={confirmDisable} onClose={() => setConfirmDisable(false)} title="Nonaktifkan integrasi Google Drive?" footer={
        <>
          <Button variant="secondary" onClick={() => setConfirmDisable(false)}>Batal</Button>
          <Button variant="danger" onClick={() => run("disable")} loading={busy === "disable"}>Nonaktifkan</Button>
        </>
      }>
        <p className="text-sm text-ink-2">
          Upload hasil PIC berikutnya akan kembali memakai penyimpanan lokal/Supabase, bukan Google Drive. File yang sudah tersimpan di Drive
          TIDAK dipindahkan atau dihapus, dan tetap bisa dilihat/diunduh seperti biasa. Status order, QC, dan pengiriman ke pemohon tidak berubah.
        </p>
      </Modal>

      <Modal open={confirmSimApply} onClose={() => setConfirmSimApply(false)} title="Jalankan simulasi sungguhan?" footer={
        <>
          <Button variant="secondary" onClick={() => setConfirmSimApply(false)}>Batal</Button>
          <Button onClick={runSimApply} loading={busy === "sim-apply"}>Jalankan</Button>
        </>
      }>
        <p className="text-sm text-ink-2">
          Ini akan benar-benar membuat folder &amp; file dummy bertanda &ldquo;TESTING&rdquo; di Google Drive sungguhan, di dalam folder PIC yang sudah ditinjau pada pratinjau di atas.
          Tidak ada data produksi (request/order) yang diubah, dan menjalankan ulang tidak akan menggandakan folder/file yang sama.
        </p>
      </Modal>

      <Modal open={guideOpen} onClose={() => setGuideOpen(false)} title="Panduan setup Google Drive A">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
          <li>Buat Service Account di Google Cloud Console, aktifkan Google Drive API untuk project tersebut.</li>
          <li>Buat folder di Google Drive untuk &ldquo;Drive A&rdquo;, lalu bagikan folder itu ke alamat email service account sebagai <b>Editor</b>.</li>
          <li>Salin ID folder (bagian akhir URL folder) ke <code>GOOGLE_DRIVE_ROOT_FOLDER_ID</code> di environment server.</li>
          <li>
            Isi kredensial service account: satu variabel <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (isi file JSON kunci apa adanya), atau dua
            variabel terpisah <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> dan <code>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code>.
          </li>
          <li>(Opsional) Bila folder berada di Shared Drive, isi juga <code>GOOGLE_DRIVE_SHARED_DRIVE_ID</code>.</li>
          <li>Jalankan ulang server, lalu kembali ke halaman ini: tekan <b>Uji Koneksi</b>. Setelah berhasil, tekan <b>Aktifkan Integrasi</b>.</li>
        </ol>
      </Modal>

      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Log sinkronisasi gagal" size="wide" description="20 kegagalan terbaru. Pesan galat sudah disaring, tidak memuat kredensial.">
        {props.failedSyncs.length === 0 ? (
          <p className="text-sm text-ink-3">Tidak ada file yang gagal disinkronkan.</p>
        ) : (
          <TableScroll minWidthPx={520}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Order</th>
                  <th scope="col" className="px-3 py-2 font-medium">File</th>
                  <th scope="col" className="px-3 py-2 font-medium">Waktu</th>
                  <th scope="col" className="px-3 py-2 font-medium">Galat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {props.failedSyncs.map((f, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-3 py-2 font-medium text-ink">{f.orderNumber}</td>
                    <td className="px-3 py-2 text-ink-2">{f.fileName}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-3">{formatDateTime(f.updatedAt)}</td>
                    <td className="px-3 py-2 text-ink-2">{f.syncError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Modal>
      <Modal open={memberSyncOpen} onClose={() => setMemberSyncOpen(false)} title="Kegagalan sinkronisasi folder anggota" description="Anggota yang gagal diproses pada sinkronisasi terakhir. Jalankan ulang untuk mencoba kembali.">
        {!props.lastMemberSyncSummary || props.lastMemberSyncSummary.failedMembers.length === 0 ? (
          <p className="text-sm text-ink-3">Tidak ada kegagalan.</p>
        ) : (
          <TableScroll minWidthPx={420}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Anggota</th>
                  <th scope="col" className="px-3 py-2 font-medium">Galat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {props.lastMemberSyncSummary.failedMembers.map((f) => (
                  <tr key={f.memberId} className="align-top">
                    <td className="px-3 py-2 font-medium text-ink">{f.memberName}</td>
                    <td className="px-3 py-2 text-ink-2">{f.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Modal>
    </div>
  );
}
