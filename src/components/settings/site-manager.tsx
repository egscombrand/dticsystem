"use client";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { ApiError, internalRequest } from "@/lib/client/api";
import type { SiteSettings } from "@/lib/server/repositories/site";

export function SiteManager({ initial }: { initial: SiteSettings }) {
  const router = useRouter();
  const [systemName, setSystemName] = useState(initial.systemName);
  const [tagline, setTagline] = useState(initial.tagline);
  const [collapsed, setCollapsed] = useState(initial.sidebarDefaultCollapsed);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await internalRequest("/api/internal/site", "PUT", { systemName: systemName.trim(), tagline: tagline.trim(), sidebarDefaultCollapsed: collapsed });
      setMsg({ kind: "success", text: "Pengaturan website disimpan." });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Gagal menyimpan pengaturan." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Identitas website" description="Nama dan tagline tampil di sidebar dan halaman login." />
        <form onSubmit={submit} className="flex flex-col gap-5 p-5">
          <Field label="Nama sistem" htmlFor="systemName" required hint="2–60 karakter.">
            <Input id="systemName" value={systemName} maxLength={60} required onChange={(e) => setSystemName(e.target.value)} />
          </Field>
          <Field label="Tagline" htmlFor="tagline" hint="Opsional, maksimal 120 karakter.">
            <Input id="tagline" value={tagline} maxLength={120} onChange={(e) => setTagline(e.target.value)} />
          </Field>
          <label className="inline-flex items-center gap-2.5 text-sm text-ink-2">
            <input type="checkbox" checked={collapsed} onChange={(e) => setCollapsed(e.target.checked)} className="size-4 accent-[var(--color-accent,#0f766e)]" />
            Sidebar dimulai dalam keadaan diciutkan (berlaku untuk pengunjung baru; setiap pengguna tetap bisa mengubahnya)
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={busy} icon={<Save className="size-4" aria-hidden="true" />}>
              Simpan
            </Button>
          </div>
        </form>
      </Card>
      <p className="text-xs text-ink-3">Logo belum didukung: unggahan file untuk logo belum tersedia, sehingga tidak ada kolom logo di sini.</p>
    </div>
  );
}
