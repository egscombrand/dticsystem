"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { STATUS_META, type OrderStatus } from "@/lib/status";
import type { SlaRule } from "@/lib/server/repositories/sla";

const SLA_STAGES: OrderStatus[] = ["submitted", "assigned", "in_progress", "pending_confirmation", "internal_revision", "awaiting_requester", "on_hold"];

async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", "X-DTIC-Request": "1", ...init?.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.fieldErrors ? Object.values(body.fieldErrors)[0] as string : body?.error ?? "Gagal menyimpan.");
  return body;
}

/** Pengelolaan SLA per tahapan — Admin (master.manage). SLA per (jenis pengajuan, tahapan); jenis kosong = default untuk jenis tanpa aturan khusus. */
export function SlaRulesManager({ initialRules, orderTypes }: { initialRules: SlaRule[]; orderTypes: { id: string; name: string }[] }) {
  const [rules, setRules] = useState(initialRules);
  const [form, setForm] = useState({ designOrderTypeId: "", status: "assigned" as OrderStatus, durationMinutes: "1440", isActive: true });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input = { designOrderTypeId: form.designOrderTypeId || null, status: form.status, durationMinutes: Number(form.durationMinutes), isActive: form.isActive };
      const { id } = await api("/api/internal/settings/sla-rules", { method: "POST", body: JSON.stringify(input) });
      const typeName = orderTypes.find((t) => t.id === input.designOrderTypeId)?.name ?? null;
      setRules((cur) => [...cur, { id, designOrderTypeId: input.designOrderTypeId, designOrderTypeName: typeName, status: input.status, durationMinutes: input.durationMinutes, isActive: input.isActive }]);
      setForm({ designOrderTypeId: "", status: "assigned", durationMinutes: "1440", isActive: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(rule: SlaRule) {
    setError(null);
    try {
      await api(`/api/internal/settings/sla-rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ designOrderTypeId: rule.designOrderTypeId, status: rule.status, durationMinutes: rule.durationMinutes, isActive: !rule.isActive }),
      });
      setRules((cur) => cur.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/api/internal/settings/sla-rules/${id}`, { method: "DELETE" });
      setRules((cur) => cur.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink">Tambah aturan SLA</h2>
        <p className="mt-1 text-[13px] text-ink-3">Batas waktu satu tahapan status, per jenis pengajuan. Kosongkan jenis pengajuan untuk aturan default (berlaku bila jenis tersebut tidak punya aturan khusus).</p>
        <form onSubmit={add} className="mt-4 grid gap-4 sm:grid-cols-4">
          <Field label="Jenis pengajuan" htmlFor="sla-type">
            <Select id="sla-type" value={form.designOrderTypeId} onChange={(e) => setForm((f) => ({ ...f, designOrderTypeId: e.target.value }))}>
              <option value="">(default — semua jenis lain)</option>
              {orderTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tahapan" htmlFor="sla-status">
            <Select id="sla-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as OrderStatus }))}>
              {SLA_STAGES.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Durasi (menit)" htmlFor="sla-minutes" hint="Mis. 1440 = 24 jam">
            <Input id="sla-minutes" type="number" min={1} value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} required />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={saving} icon={<Plus className="size-4" aria-hidden="true" />}>
              Tambah
            </Button>
          </div>
        </form>
        {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-subtle text-left text-xs font-semibold tracking-wide text-ink-3 uppercase">
            <tr>
              <th className="px-4 py-3">Jenis pengajuan</th>
              <th className="px-4 py-3">Tahapan</th>
              <th className="px-4 py-3">Durasi</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rules.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-3">Belum ada aturan SLA. Tanpa aturan, tahapan tidak punya deadline dan tidak pernah ditutup otomatis.</td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-ink">{r.designOrderTypeName ?? <span className="text-ink-3 italic">Default (semua jenis lain)</span>}</td>
                  <td className="px-4 py-3 text-ink">{STATUS_META[r.status].label}</td>
                  <td className="px-4 py-3 text-ink">{r.durationMinutes >= 1440 ? `${(r.durationMinutes / 1440).toFixed(r.durationMinutes % 1440 === 0 ? 0 : 1)} hari` : `${r.durationMinutes} menit`}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => toggleActive(r)} className="inline-flex">
                      <Badge tone={r.isActive ? "success" : "neutral"} dot>{r.isActive ? "Aktif" : "Nonaktif"}</Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => remove(r.id)} aria-label="Hapus aturan" className="rounded-md p-1.5 text-ink-3 hover:bg-bad-soft hover:text-bad">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
