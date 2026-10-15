"use client";

import { RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ApiError, internalRequest } from "@/lib/client/api";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/auth/permissions";
import type { MenuRow } from "@/lib/menu";

export type MenuAdminItem = MenuRow & { capableRoles: Role[] };
type Msg = { kind: "success" | "error"; text: string } | null;

function MenuRowEditor({ item, all, onSaved, onError }: { item: MenuAdminItem; all: MenuAdminItem[]; onSaved: () => void; onError: (text: string) => void }) {
  const [label, setLabel] = useState(item.label);
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder));
  const [isVisible, setIsVisible] = useState(item.isVisible);
  const [roles, setRoles] = useState<Role[]>(item.allowedRoles);
  const [busy, setBusy] = useState(false);
  const parent = item.parentKey ? all.find((i) => i.key === item.parentKey) : null;

  function toggleRole(role: Role) {
    setRoles(roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role]);
  }

  async function save() {
    const patch: Record<string, unknown> = {};
    if (label.trim() !== item.label) patch.label = label.trim();
    if (Number(sortOrder) !== item.sortOrder) patch.sortOrder = Number(sortOrder);
    if (isVisible !== item.isVisible) patch.isVisible = isVisible;
    if (roles.slice().sort().join() !== item.allowedRoles.slice().sort().join()) patch.allowedRoles = roles;
    if (Object.keys(patch).length === 0) return;
    setBusy(true);
    try {
      await internalRequest(`/api/internal/menu/${item.key}`, "PATCH", patch);
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Gagal menyimpan menu.");
    } finally {
      setBusy(false);
    }
  }

  const canHide = !item.isCore;
  return (
    <li className={cn("grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.4fr)_90px_120px_minmax(0,1.6fr)_auto] lg:items-center", parent && "bg-subtle/50")}>
      <div className={cn("min-w-0", parent && "pl-5")}>
        <label className="block text-xs font-medium text-ink-3 lg:sr-only" htmlFor={`label-${item.key}`}>Label</label>
        <input
          id={`label-${item.key}`}
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
        />
        <p className="mt-1 truncate text-xs text-ink-3">
          {item.href}
          {parent && <span> · submenu {parent.label}</span>}
          {item.isCore && <span className="ml-2"><Badge tone="info">Inti</Badge></span>}
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-3 lg:sr-only" htmlFor={`order-${item.key}`}>Urutan</label>
        <input
          id={`order-${item.key}`}
          type="number"
          min={0}
          max={9999}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
        />
      </div>

      <label className={cn("inline-flex items-center gap-2 text-sm", !canHide && "text-ink-3")}>
        <input
          type="checkbox"
          checked={isVisible}
          disabled={!canHide}
          onChange={(e) => setIsVisible(e.target.checked)}
          className="size-4 accent-[var(--color-accent,#0f766e)]"
        />
        Tampilkan
        {!canHide && <span className="text-xs">(selalu)</span>}
      </label>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
        <legend className="sr-only">Role yang dapat melihat {item.label}</legend>
        {ROLES.map((role) => {
          const capable = item.capableRoles.includes(role);
          const locked = !capable || (item.isCore && role === "super_admin");
          return (
            <label key={role} className={cn("inline-flex items-center gap-1.5 text-[13px]", locked ? "text-ink-3" : "text-ink-2")}>
              <input
                type="checkbox"
                checked={roles.includes(role)}
                disabled={locked}
                onChange={() => toggleRole(role)}
                className="size-4 accent-[var(--color-accent,#0f766e)]"
              />
              {ROLE_LABEL[role]}
              {!capable && <span className="text-xs">(tidak berizin)</span>}
            </label>
          );
        })}
      </fieldset>

      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={save} loading={busy} icon={<Save className="size-3.5" aria-hidden="true" />}>
          Simpan
        </Button>
      </div>
    </li>
  );
}

export function MenuManager({ items }: { items: MenuAdminItem[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [resetting, setResetting] = useState(false);
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  const top = sorted.filter((i) => !i.parentKey);
  const rows = top.flatMap((t) => [t, ...sorted.filter((c) => c.parentKey === t.key)]);

  async function reset() {
    if (!window.confirm("Kembalikan seluruh menu ke pengaturan awal? Perubahan label, urutan, dan role akan hilang.")) return;
    setResetting(true);
    try {
      await internalRequest("/api/internal/menu/reset", "POST");
      setMsg({ kind: "success", text: "Menu dikembalikan ke pengaturan awal." });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof ApiError ? err.message : "Gagal mengembalikan menu." });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card>
        <CardHeader
          title="Menu sidebar"
          description="Atur label, urutan, visibilitas, dan role yang dapat melihat setiap menu. Role hanya bisa dipilih bila memang memiliki izin untuk halaman tersebut."
          action={
            <Button variant="secondary" size="sm" onClick={reset} loading={resetting} icon={<RotateCcw className="size-3.5" aria-hidden="true" />}>
              Kembalikan awal
            </Button>
          }
        />
        <ul className="divide-y divide-line">
          {rows.map((item) => (
            <MenuRowEditor
              key={`${item.key}-${item.label}-${item.sortOrder}-${item.isVisible}-${item.allowedRoles.join()}`}
              item={item}
              all={items}
              onSaved={() => {
                setMsg({ kind: "success", text: `Menu "${item.label}" disimpan.` });
                router.refresh();
              }}
              onError={(text) => setMsg({ kind: "error", text })}
            />
          ))}
        </ul>
      </Card>
      <p className="text-xs text-ink-3">
        Pengaturan ini hanya mengatur tampilan menu. Akses halaman tetap diperiksa di server untuk setiap permintaan, jadi menu yang disembunyikan atau diberi role tambahan tidak memberi akses baru.
      </p>
    </div>
  );
}
