"use client";

import { Pencil, Plus, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { ApiError, internalRequest } from "@/lib/client/api";
import type { EntityDef, FieldDef, MasterEntity, MasterRow } from "@/lib/master-data";
import { isStatusTone } from "@/lib/status";
import type { DepartmentOption } from "@/lib/types";
import type { FieldErrors } from "@/lib/validation/common";
import { slugify } from "@/lib/validation/brand";

type Values = MasterRow["values"];

export function Toggle({ checked, onChange, disabled, id, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id: string; label: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-[#d0d5dd]")}
    >
      <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
    </button>
  );
}

export function emptyValues(def: EntityDef): Values {
  const v: Values = {};
  for (const f of def.fields) v[f.key] = f.type === "boolean" ? f.key === "isActive" : f.type === "number" ? 0 : "";
  return v;
}

/** Bentuk payload sesuai skema server (field createOnly tidak dikirim saat edit). */
export function toPayload(def: EntityDef, values: Values, mode: "create" | "edit") {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (mode === "edit" && f.type === "text" && f.createOnly) continue;
    const v = values[f.key];
    if (f.type === "boolean") out[f.key] = Boolean(v);
    else if (f.type === "number") out[f.key] = v === "" || v === null ? undefined : Number(v);
    else out[f.key] = v ?? "";
  }
  return out;
}

export function RowForm({
  def,
  entity,
  initial,
  rowId,
  departments,
  teams = [],
  onDone,
  onCancel,
}: {
  def: EntityDef;
  entity: MasterEntity;
  initial: Values;
  rowId?: string;
  departments: DepartmentOption[];
  /** Tim (bentuk sama dengan divisi: id, nama, aktif) untuk field "teams". */
  teams?: DepartmentOption[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>(initial);
  const [slugTouched, setSlugTouched] = useState(Boolean(rowId));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mode = rowId ? "edit" : "create";
  const prefix = `${entity}-${rowId ?? "new"}`;

  function set(key: string, value: string | number | boolean) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      for (const f of def.fields) if (f.type === "text" && f.slugFrom === key && !slugTouched) next[f.key] = slugify(String(value));
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const url = rowId ? `/api/internal/settings/${entity}/${encodeURIComponent(rowId)}` : `/api/internal/settings/${entity}`;
      await internalRequest(url, rowId ? "PATCH" : "POST", toPayload(def, values, mode));
      onDone(rowId ? "Perubahan tersimpan." : `${def.singular[0].toUpperCase()}${def.singular.slice(1)} ditambahkan.`);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setPending(false);
    }
  }

  const renderField = (f: FieldDef) => {
    const id = `${prefix}-${f.key}`;
    const err = errors[f.key];
    if (f.type === "boolean")
      return (
        <div key={f.key} className="flex items-start gap-3 sm:col-span-2">
          <Toggle id={id} label={f.label} checked={Boolean(values[f.key])} onChange={(v) => set(f.key, v)} disabled={pending} />
          <div>
            <label htmlFor={id} className="text-[13px] font-medium text-ink">{f.label}</label>
            {(err || f.hint) && <p className={cn("text-[12.5px]", err ? "text-bad" : "text-ink-3")}>{err ?? f.hint}</p>}
          </div>
        </div>
      );
    if (f.type === "select") {
      const options =
        f.options === "departments" || f.options === "teams"
          ? (f.options === "teams" ? teams : departments)
              .filter((d) => d.isActive || d.id === values[f.key])
              .map((d) => ({ value: d.id, label: d.isActive ? d.name : `${d.name} (nonaktif)` }))
          : f.options;
      return (
        <Field key={f.key} label={f.label} htmlFor={id} required={f.required} error={err} hint={f.hint}>
          <Select id={id} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} disabled={pending} invalid={!!err}>
            <option value="" disabled>Pilih…</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      );
    }
    if (f.type === "number")
      return (
        <Field key={f.key} label={f.label} htmlFor={id} required={false} error={err} hint={f.hint}>
          <Input id={id} type="number" min={0} max={9999} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} disabled={pending} invalid={!!err} />
        </Field>
      );
    const locked = f.createOnly && mode === "edit";
    return (
      <Field key={f.key} label={f.label} htmlFor={id} required={f.required} error={err} hint={locked ? "Tidak dapat diubah setelah dibuat." : f.hint}>
        <Input
          id={id}
          value={String(values[f.key] ?? "")}
          maxLength={f.max}
          disabled={pending || locked}
          invalid={!!err}
          className={f.mono ? "font-mono" : undefined}
          onChange={(e) => {
            if (def.fields.some((x) => x.type === "text" && x.slugFrom && x.key === f.key)) setSlugTouched(true);
            set(f.key, e.target.value);
          }}
        />
      </Field>
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-subtle/60 p-4">
      {formError && <Alert kind="error">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">{def.fields.map(renderField)}</div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>{rowId ? "Simpan" : "Tambah"}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Batal</Button>
      </div>
    </form>
  );
}

export function MasterDataManager({
  entity,
  def,
  rows,
  departments = [],
  teams = [],
  readOnly = false,
}: {
  entity: MasterEntity;
  def: EntityDef;
  rows: MasterRow[];
  departments?: DepartmentOption[];
  teams?: DepartmentOption[];
  /** Manager: hanya melihat daftar (tanpa tambah/ubah/aktifkan). */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null); // id baris, "new", atau null
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  function done(text: string) {
    setEditing(null);
    setMsg({ kind: "success", text });
    router.refresh();
  }

  async function toggleActive(row: MasterRow) {
    setToggling(row.id);
    setMsg(null);
    try {
      const values = { ...row.values, isActive: !row.values.isActive };
      await internalRequest(`/api/internal/settings/${entity}/${encodeURIComponent(row.id)}`, "PATCH", toPayload(def, values, "edit"));
      setMsg({ kind: "success", text: `${String(row.values[def.primary])} ${values.isActive ? "diaktifkan" : "dinonaktifkan"}.` });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Gagal mengubah status." });
    } finally {
      setToggling(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Daftar ${def.title}`}
        description={def.description}
        action={
          !readOnly && editing !== "new" && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setEditing("new"); setMsg(null); }}>
              Tambah {def.singular}
            </Button>
          )
        }
      />
      <div aria-live="polite" className="px-5 empty:hidden">{msg && <Alert kind={msg.kind} className="mt-4">{msg.text}</Alert>}</div>
      {editing === "new" && (
        <div className="px-5 pt-4">
          <RowForm def={def} entity={entity} initial={emptyValues(def)} departments={departments} teams={teams} onDone={done} onCancel={() => setEditing(null)} />
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={Tags} title={`Belum ada ${def.singular}`} description="Tambahkan data pertama, atau jalankan migration untuk mengisi data awal." />
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((row) => {
            const active = Boolean(row.values.isActive);
            const tone = row.values.tone;
            return (
              <li key={row.id} className="px-5 py-4">
                {editing === row.id ? (
                  <RowForm def={def} entity={entity} initial={row.values} rowId={row.id} departments={departments} teams={teams} onDone={done} onCancel={() => setEditing(null)} />
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {typeof tone === "string" && isStatusTone(tone) ? (
                          <Badge tone={tone}>{String(row.values[def.primary])}</Badge>
                        ) : (
                          <p className="truncate text-sm font-semibold text-ink">{String(row.values[def.primary])}</p>
                        )}
                        {active ? <Badge tone="success" dot>Aktif</Badge> : <Badge tone="muted" dot>Nonaktif</Badge>}
                      </div>
                      {row.subtitle && <p className="mt-0.5 truncate text-xs text-ink-3">{row.subtitle}</p>}
                    </div>
                    <div className="flex items-center gap-4">
                      {!readOnly && (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] text-ink-2">Aktif</span>
                            <Toggle
                              id={`toggle-${row.id}`}
                              label={`${active ? "Nonaktifkan" : "Aktifkan"} ${String(row.values[def.primary])}`}
                              checked={active}
                              onChange={() => void toggleActive(row)}
                              disabled={toggling !== null}
                            />
                          </div>
                          <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => { setEditing(row.id); setMsg(null); }}>
                            Edit
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
