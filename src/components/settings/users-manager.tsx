"use client";

import { Eye, EyeOff, KeyRound, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Input, Select } from "@/components/ui/form";
import { ApiError, internalRequest } from "@/lib/client/api";
import { formatDateTime } from "@/lib/dates";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy.mjs";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/auth/permissions";
import type { FieldErrors } from "@/lib/validation/common";

type UserItem = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  memberId: string | null;
  memberName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
};
type MemberItem = { id: string; name: string; division: string; isActive: boolean };
type Msg = { kind: "success" | "error"; text: string } | null;

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.";
}

function CreateUserForm({ members, onDone }: { members: MemberItem[]; onDone: (text: string) => void }) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    const body = {
      fullName: String(fd.get("fullName") ?? ""),
      email: String(fd.get("email") ?? ""),
      role: String(fd.get("role") ?? "staff"),
      memberId: String(fd.get("memberId") ?? "") || null,
      password: String(fd.get("password") ?? ""),
    };
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await internalRequest("/api/internal/users", "POST", body);
      (e.target as HTMLFormElement).reset();
      onDone("Akun dibuat. Berikan kata sandi awal kepada pengguna dengan cara aman.");
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      {formError && <Alert kind="error" className="sm:col-span-2">{formError}</Alert>}
      <Field label="Nama lengkap" htmlFor="u-name" required error={errors.fullName}>
        <Input id="u-name" name="fullName" maxLength={120} required disabled={pending} invalid={!!errors.fullName} />
      </Field>
      <Field label="Email" htmlFor="u-email" required error={errors.email} hint="Akan dipakai untuk masuk">
        <Input id="u-email" name="email" type="email" autoComplete="off" maxLength={160} required disabled={pending} invalid={!!errors.email} />
      </Field>
      <Field label="Role" htmlFor="u-role" required error={errors.role}>
        <Select id="u-role" name="role" defaultValue="staff" disabled={pending} invalid={!!errors.role}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
      </Field>
      <Field label="Anggota DTIC (opsional)" htmlFor="u-member" error={errors.memberId} hint="Untuk Staff: menentukan order yang bisa dilihatnya">
        <Select id="u-member" name="memberId" defaultValue="" disabled={pending} invalid={!!errors.memberId}>
          <option value="">Tidak terhubung</option>
          {members.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.id}>{m.name} — {m.division}</option>)}
        </Select>
      </Field>
      <Field label="Kata sandi awal" htmlFor="u-password" required error={errors.password} hint={`Minimal ${MIN_PASSWORD_LENGTH} karakter, memuat huruf dan angka`} className="sm:col-span-2">
        <div className="relative">
          <Input id="u-password" name="password" type={show ? "text" : "password"} autoComplete="new-password" required disabled={pending} invalid={!!errors.password} className="pr-11" />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Sembunyikan" : "Tampilkan"} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-3 hover:text-ink">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending} icon={<UserPlus className="size-4" />}>Buat akun</Button>
      </div>
    </form>
  );
}

function UserRow({ user, isSelf, onMsg, onChanged }: { user: UserItem; isSelf: boolean; onMsg: (m: Msg) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  async function patch(changes: Record<string, unknown>, okText: string) {
    setBusy(true);
    onMsg(null);
    try {
      await internalRequest(`/api/internal/users/${user.id}`, "PATCH", changes);
      onMsg({ kind: "success", text: okText });
      onChanged();
    } catch (err) {
      onMsg({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    onMsg(null);
    try {
      await internalRequest(`/api/internal/users/${user.id}/password`, "POST", { password: newPassword });
      setNewPassword("");
      setResetOpen(false);
      onMsg({ kind: "success", text: `Kata sandi ${user.fullName} direset. Sesi lamanya dicabut.` });
      onChanged();
    } catch (err) {
      onMsg({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">{user.fullName}{isSelf && <span className="ml-1.5 text-xs font-normal text-ink-3">(Anda)</span>}</p>
            <Badge tone={user.role === "super_admin" ? "accent" : user.role === "manager" ? "info" : "neutral"}>{ROLE_LABEL[user.role]}</Badge>
            {user.isActive ? <Badge tone="success" dot>Aktif</Badge> : <Badge tone="muted" dot>Nonaktif</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-3">
            {user.email} · {user.memberName ? `terhubung ke ${user.memberName}` : "tidak terhubung ke anggota"} · login terakhir {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "belum pernah"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`role-${user.id}`} className="sr-only">Role {user.fullName}</label>
          <Select
            id={`role-${user.id}`}
            value={user.role}
            disabled={busy || isSelf}
            onChange={(e) => void patch({ role: e.target.value }, `Role ${user.fullName} diubah. Berlaku pada permintaan berikutnya.`)}
            className="h-9 w-40 text-[13px]"
          >
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
          <Button size="sm" variant="secondary" disabled={busy || isSelf} onClick={() => void patch({ isActive: !user.isActive }, `${user.fullName} ${user.isActive ? "dinonaktifkan" : "diaktifkan"}.`)}>
            {user.isActive ? "Nonaktifkan" : "Aktifkan"}
          </Button>
          <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} disabled={busy} onClick={() => setResetOpen((v) => !v)}>Reset kata sandi</Button>
        </div>
      </div>
      {resetOpen && (
        <form className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-subtle p-3" onSubmit={(e) => { e.preventDefault(); void reset(); }}>
          <Field label="Kata sandi baru" htmlFor={`pw-${user.id}`} className="min-w-64">
            <Input id={`pw-${user.id}`} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={busy} />
          </Field>
          <Button type="submit" size="sm" loading={busy} disabled={newPassword.length < MIN_PASSWORD_LENGTH}>Simpan</Button>
        </form>
      )}
    </li>
  );
}

export function UsersManager({ currentUserId, users, members }: { currentUserId: string; users: UserItem[]; members: MemberItem[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [showCreate, setShowCreate] = useState(false);
  const refresh = () => router.refresh();

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div aria-live="polite" className="empty:hidden">{msg && <Alert kind={msg.kind}>{msg.text}</Alert>}</div>

      <Card>
        <CardHeader
          title={`Daftar akun (${users.length})`}
          description="Role menentukan menu dan data yang bisa diakses. Perubahan berlaku pada permintaan berikutnya."
          action={
            <Button size="sm" variant={showCreate ? "ghost" : "primary"} onClick={() => setShowCreate((v) => !v)} icon={<UserPlus className="size-4" />}>
              {showCreate ? "Tutup" : "Tambah akun"}
            </Button>
          }
        />
        {showCreate && (
          <div className="border-b border-line p-5">
            <CreateUserForm members={members} onDone={(text) => { setMsg({ kind: "success", text }); setShowCreate(false); refresh(); }} />
          </div>
        )}
        <ul className={cn("divide-y divide-line")}>
          {users.map((u) => (
            <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} onMsg={setMsg} onChanged={refresh} />
          ))}
        </ul>
      </Card>
      <p className="text-xs text-ink-3">
        Akun tidak dibuat secara publik. Super Admin terakhir yang aktif tidak dapat diturunkan atau dinonaktifkan. Anda tidak dapat mengubah role atau menonaktifkan akun sendiri.
      </p>
    </div>
  );
}
