"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import type { MemberOption } from "@/lib/types";

/**
 * Dropdown PIC yang bisa dicari (multi-pilih). Opsi = member aktif dari database,
 * ditampilkan "Nama — Divisi". Member nonaktif yang SUDAH ditugaskan tetap terlihat
 * sebagai chip (riwayat) tetapi tidak bisa dipilih untuk penugasan baru.
 */
export function PicCombobox({
  id,
  members,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  members: MemberOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Posisi popup: ke atas bila ruang di bawah tidak cukup; tinggi menyesuaikan ruang tersedia.
  const [placement, setPlacement] = useState<{ up: boolean; maxHeight: number }>({ up: false, maxHeight: 288 });

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const selected = value.map((v) => byId.get(v)).filter((m): m is MemberOption => Boolean(m));
  const q = query.trim().toLowerCase();
  const options = members.filter(
    (m) => m.isActive && (!q || m.name.toLowerCase().includes(q) || m.division.toLowerCase().includes(q)),
  );

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 240 && above > below;
      setPlacement({ up, maxHeight: Math.max(160, Math.min(288, up ? above : below)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle(memberId: string) {
    onChange(value.includes(memberId) ? value.filter((v) => v !== memberId) : [...value, memberId]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && options[active]) {
        e.preventDefault();
        toggle(options[active].id);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  const activeId = open && options[active] ? `${listId}-${options[active].id}` : undefined;

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15",
          invalid ? "border-bad" : "border-line-strong hover:border-[#bfc5cd]",
          disabled && "cursor-not-allowed bg-subtle opacity-70",
        )}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {selected.map((m) => (
          <span key={m.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft py-0.5 pr-1 pl-2 text-xs text-accent">
            <span className="truncate font-medium">{m.name}</span>
            {!m.isActive && <span className="text-ink-3">(nonaktif)</span>}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                toggle(m.id);
              }}
              className="rounded p-0.5 hover:bg-accent/15"
              aria-label={`Hapus ${m.name} dari PIC`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <div className="flex min-w-36 flex-1 items-center gap-1.5">
          <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            autoComplete="off"
            disabled={disabled}
            value={query}
            placeholder={selected.length ? "Tambah member…" : "Cari nama atau divisi…"}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            // Fokus ditandai ring pada wadah; outline global :focus-visible dimatikan khusus input ini.
            style={{ outline: "none" }}
            className="h-7 w-full min-w-0 bg-transparent text-sm text-ink placeholder:text-[#9aa1ad] disabled:cursor-not-allowed"
          />
          <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
        </div>
      </div>

      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Member DTIC"
          style={{ maxHeight: placement.maxHeight }}
          className={cn(
            "absolute z-30 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-pop",
            placement.up ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-ink-3">
              {members.some((m) => m.isActive) ? "Tidak ada member yang cocok." : "Belum ada member aktif. Tambahkan di Pengaturan → Member DTIC."}
            </li>
          ) : (
            options.map((m, i) => {
              const checked = value.includes(m.id);
              return (
                <li
                  key={m.id}
                  id={`${listId}-${m.id}`}
                  role="option"
                  aria-selected={checked}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(m.id)}
                  className={cn("flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm", i === active ? "bg-subtle" : undefined)}
                >
                  <span
                    className={cn("flex size-4 shrink-0 items-center justify-center rounded border", checked ? "border-accent bg-accent text-white" : "border-line-strong bg-surface")}
                    aria-hidden="true"
                  >
                    {checked && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink">{m.name}</span>
                    <span className="text-ink-3"> — {m.division}</span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
