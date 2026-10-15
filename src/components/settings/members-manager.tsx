"use client";

import { ChevronDown, Pencil, Plus, Search, Unlink, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import { ApiError, internalRequest } from "@/lib/client/api";
import { ROLE_LABEL, isRole } from "@/lib/auth/permissions";
import { ENTITY_DEFS, type MasterRow } from "@/lib/master-data";
import { TELEGRAM_STATUS_LABEL, type TelegramStatus } from "@/lib/member-telegram";
import type { DepartmentOption } from "@/lib/types";
import { Toggle, RowForm, emptyValues, toPayload } from "@/components/settings/master-data-manager";

type Msg = { kind: "success" | "error"; text: string } | null;
const TONE: Record<TelegramStatus, "neutral" | "info" | "success"> = { not_linked: "neutral", recorded: "info", verified: "success" };
const def = ENTITY_DEFS.members;
const FILTER_STATUSES: TelegramStatus[] = ["not_linked", "recorded"];

/** Nama Telegram/username untuk pencarian & tampilan (username tanpa @ di database). */
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Daftar anggota DTIC: tabel dengan kolom Telegram, pencarian nama/Telegram/username, filter status Telegram,
 * detail, tambah/edit, dan pelepasan identitas Telegram tanpa menghapus anggota. Data Telegram hanya dikirim
 * server untuk Super Admin (readOnly = Manager tidak menerima kolom Telegram).
 */
export function MembersManager({ rows, departments, readOnly }: { rows: MasterRow[]; departments: DepartmentOption[]; readOnly: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | TelegramStatus>("");
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^@+/, "");
    return rows.filter((r) => {
      const st = str(r.values.telegramStatus) as TelegramStatus;
      if (status && st !== status) return false;
      if (!needle) return true;
      return [r.values.fullName, r.values.telegramDisplayName, r.values.telegramUsername].some((v) => str(v).toLowerCase().includes(needle));
    });
  }, [rows, q, status]);

  function done(text: string) {
    setEditing(null);
    setMsg({ kind: "success", text });
    router.refresh();
  }

  async function release(row: MasterRow) {
    if (!window.confirm(`Lepaskan identitas Telegram ${str(row.values.fullName)}? Data anggota tetap tersimpan.`)) return;
    setBusy(row.id);
    setMsg(null);
    try {
      const values = { ...row.values, telegramDisplayName: null, telegramUsername: null, telegramUserId: null };
      await internalRequest(`/api/internal/settings/members/${encodeURIComponent(row.id)}`, "PATCH", toPayload(def, values, "edit"));
      setMsg({ kind: "success", text: `Identitas Telegram ${str(row.values.fullName)} dilepas.` });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Gagal melepas identitas Telegram." });
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(row: MasterRow) {
    setBusy(row.id);
    setMsg(null);
    try {
      const values = { ...row.values, isActive: !row.values.isActive };
      await internalRequest(`/api/internal/settings/members/${encodeURIComponent(row.id)}`, "PATCH", toPayload(def, values, "edit"));
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Gagal mengubah status." });
    } finally {
      setBusy(null);
    }
  }

  const showTelegram = !readOnly;
  const colSpan = showTelegram ? 7 : 4;

  return (
    <Card>
      <CardHeader
        title="Daftar Member DTIC"
        description={readOnly ? "Anggota tim DTIC dan divisinya (read-only)." : "Anggota tim DTIC, divisi, dan identitas Telegram. Identitas Telegram hanya dikelola Super Admin."}
        action={
          !readOnly && editing !== "new" && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setEditing("new"); setMsg(null); }}>
              Tambah anggota
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor="member-search" className="sr-only">Cari anggota</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input
            id="member-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama anggota, nama Telegram, atau username…"
            className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
          />
        </div>
        {showTelegram && (
          <div className="sm:w-56">
            <label htmlFor="member-status" className="sr-only">Status Telegram</label>
            <Select id="member-status" value={status} onChange={(e) => setStatus(e.target.value as "" | TelegramStatus)}>
              <option value="">Semua status Telegram</option>
              {/* "Terverifikasi" belum tersedia: belum ada mekanisme verifikasi, sehingga tidak ditawarkan sebagai filter. */}
              {FILTER_STATUSES.map((s) => <option key={s} value={s}>{TELEGRAM_STATUS_LABEL[s]}</option>)}
            </Select>
          </div>
        )}
      </div>

      <div aria-live="polite" className="px-5 empty:hidden">{msg && <Alert kind={msg.kind} className="mt-4">{msg.text}</Alert>}</div>
      {editing === "new" && (
        <div className="px-5 pt-4">
          <RowForm def={def} entity="members" initial={emptyValues(def)} departments={departments} onDone={done} onCancel={() => setEditing(null)} />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={Users} title="Belum ada member" description="Tambahkan anggota pertama, atau jalankan migration untuk mengisi data awal." />
      ) : filtered.length === 0 ? (
        <p className="p-6 text-sm text-ink-3">Tidak ada anggota yang cocok dengan pencarian atau filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Nama anggota</th>
                <th scope="col" className="px-4 py-3 font-medium">Role akun</th>
                {showTelegram && <th scope="col" className="px-4 py-3 font-medium">Nama Telegram</th>}
                {showTelegram && <th scope="col" className="px-4 py-3 font-medium">Username</th>}
                {showTelegram && <th scope="col" className="px-4 py-3 font-medium">Status Telegram</th>}
                <th scope="col" className="px-4 py-3 font-medium">Aktif</th>
                {!readOnly && <th scope="col" className="px-4 py-3 text-right font-medium">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((r) => {
                const st = (str(r.values.telegramStatus) || "not_linked") as TelegramStatus;
                const role = r.values.accountRole;
                const open = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="align-top">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-ink">{str(r.values.fullName)}</p>
                        <p className="text-xs text-ink-3">{r.subtitle}</p>
                      </td>
                      <td className="px-4 py-3.5 text-ink-2">
                        {typeof role === "string" && isRole(role) ? ROLE_LABEL[role] : <span className="text-ink-3">Belum punya akun</span>}
                      </td>
                      {showTelegram && <td className="px-4 py-3.5 text-ink">{str(r.values.telegramDisplayName) || <span className="text-ink-3">—</span>}</td>}
                      {showTelegram && (
                        <td className="px-4 py-3.5 font-mono text-[13px] text-ink-2">
                          {str(r.values.telegramUsername) ? `@${str(r.values.telegramUsername)}` : <span className="font-sans text-ink-3">—</span>}
                        </td>
                      )}
                      {showTelegram && (
                        <td className="px-4 py-3.5">
                          <Badge tone={TONE[st]} dot>{TELEGRAM_STATUS_LABEL[st]}</Badge>
                        </td>
                      )}
                      <td className="px-4 py-3.5">
                        {readOnly ? (
                          r.values.isActive ? <Badge tone="success" dot>Aktif</Badge> : <Badge tone="muted" dot>Nonaktif</Badge>
                        ) : (
                          <Toggle
                            id={`toggle-${r.id}`}
                            label={`${r.values.isActive ? "Nonaktifkan" : "Aktifkan"} ${str(r.values.fullName)}`}
                            checked={Boolean(r.values.isActive)}
                            onChange={() => void toggleActive(r)}
                            disabled={busy !== null}
                          />
                        )}
                      </td>
                      {!readOnly && (
                        <td className="px-4 py-3.5">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setExpanded(open ? null : r.id)} aria-expanded={open} aria-label={`Detail ${str(r.values.fullName)}`}>
                              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
                            </Button>
                            <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => { setEditing(r.id); setMsg(null); }}>
                              Edit
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {open && showTelegram && (
                      <tr className="bg-subtle/60">
                        <td colSpan={colSpan} className="px-5 py-4">
                          {editing === r.id ? null : (
                            <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
                              <div><dt className="text-ink-3">Telegram User ID</dt><dd className="font-mono text-ink">{str(r.values.telegramUserId) || "Belum diketahui"}</dd></div>
                              <div><dt className="text-ink-3">Nama Telegram</dt><dd className="text-ink">{str(r.values.telegramDisplayName) || "—"}</dd></div>
                              <div><dt className="text-ink-3">Username</dt><dd className="text-ink">{str(r.values.telegramUsername) ? `@${str(r.values.telegramUsername)}` : "—"}</dd></div>
                              <div className="sm:col-span-3">
                                <Button
                                  size="sm"
                                  variant="danger"
                                  icon={<Unlink className="size-3.5" />}
                                  disabled={busy !== null || st === "not_linked"}
                                  onClick={() => void release(r)}
                                >
                                  Lepas identitas Telegram
                                </Button>
                                <span className="ml-3 text-xs text-ink-3">Anggota tetap tersimpan; hanya data Telegram yang dihapus.</span>
                              </div>
                            </dl>
                          )}
                        </td>
                      </tr>
                    )}
                    {editing === r.id && (
                      <tr>
                        <td colSpan={colSpan} className="px-5 py-4">
                          <RowForm def={def} entity="members" initial={r.values} rowId={r.id} departments={departments} onDone={done} onCancel={() => setEditing(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
