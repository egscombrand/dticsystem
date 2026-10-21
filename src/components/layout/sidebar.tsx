"use client";

import {
  CalendarDays,
  ChevronDown,
  Database,
  FilePlus2,
  Globe,
  History,
  KanbanSquare,
  Layers,
  ListChecks,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Logo } from "@/components/layout/logo";
import { ROLE_LABEL, type Role } from "@/lib/auth/permissions";
import { internalRequest } from "@/lib/client/api";
import type { MenuIcon, MenuNode } from "@/lib/menu";

const ICONS: Record<MenuIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  list: ListChecks,
  kanban: KanbanSquare,
  calendar: CalendarDays,
  "file-plus": FilePlus2,
  users: Users,
  settings: Settings2,
  shield: ShieldCheck,
  history: History,
  sliders: SlidersHorizontal,
  globe: Globe,
  database: Database,
  layers: Layers,
};

const PREF_KEY = "dtic.sidebar.collapsed";
const PREF_EVENT = "dtic:sidebar-pref";

/** Preferensi collapse per perangkat. Snapshot server = default dari database (tanpa mismatch hidrasi). */
function subscribePref(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREF_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREF_EVENT, onChange);
  };
}

const noopSubscribe = () => () => {};

function readPref(fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    // penyimpanan diblokir: pakai default
  }
  return fallback;
}

function writePref(value: boolean) {
  try {
    window.localStorage.setItem(PREF_KEY, value ? "1" : "0");
  } catch {
    // diabaikan: preferensi hanya kenyamanan
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}

type Flat = { key: string; href: string };
function flatten(nodes: MenuNode[]): Flat[] {
  return nodes.flatMap((n) => [{ key: n.key, href: n.href }, ...flatten(n.children)]);
}

/** Hanya satu item yang aktif: yang href-nya paling spesifik (terpanjang) dan cocok dengan path. */
function activeKey(nodes: MenuNode[], pathname: string): string | null {
  let best: Flat | null = null;
  for (const item of flatten(nodes)) {
    const match = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

function containsKey(node: MenuNode, key: string | null): boolean {
  return node.children.some((c) => c.key === key || containsKey(c, key));
}

function NavTree({
  nodes,
  currentKey,
  collapsed,
  onNavigate,
  openGroups,
  setOpenGroups,
}: {
  nodes: MenuNode[];
  currentKey: string | null;
  collapsed: boolean;
  onNavigate?: () => void;
  openGroups: Record<string, boolean>;
  setOpenGroups: (next: Record<string, boolean>) => void;
}) {
  const navRef = useRef<HTMLElement>(null);

  // Navigasi panah atas/bawah/Home/End antar tautan & tombol di dalam menu.
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = Array.from(navRef.current?.querySelectorAll<HTMLElement>("[data-nav-item]") ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (idx === -1 && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
    items[next]?.focus();
  }

  const renderNode = (node: MenuNode, depth: number): ReactNode => {
    const Icon = ICONS[node.icon];
    const hasChildren = node.children.length > 0;
    const isOpen = openGroups[node.key] ?? containsKey(node, currentKey);
    const active = node.key === currentKey;
    const rowClass = cn(
      "group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      collapsed && "justify-center px-0",
      active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-subtle hover:text-ink",
      depth > 0 && "py-1.5 text-[13px]",
    );
    const tooltipId = `tip-${node.key}`;
    return (
      <li key={node.key}>
        <div className="flex items-center gap-1">
          <Link
            href={node.href}
            onClick={onNavigate}
            data-nav-item
            aria-current={active ? "page" : undefined}
            aria-describedby={collapsed ? tooltipId : undefined}
            className={cn(rowClass, "min-w-0 flex-1 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none")}
          >
            {depth === 0 && <Icon className={cn("size-[18px] shrink-0", active ? "text-accent" : "text-ink-3")} aria-hidden="true" />}
            <span className={cn("truncate", collapsed && "sr-only")}>{node.label}</span>
            {collapsed && depth === 0 && (
              <span
                id={tooltipId}
                role="tooltip"
                aria-hidden="true"
                className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-pop transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {node.label}
              </span>
            )}
          </Link>
          {hasChildren && !collapsed && (
            <button
              type="button"
              data-nav-item
              onClick={() => setOpenGroups({ ...openGroups, [node.key]: !isOpen })}
              aria-expanded={isOpen}
              aria-controls={`sub-${node.key}`}
              aria-label={`${isOpen ? "Tutup" : "Buka"} submenu ${node.label}`}
              className="rounded-md p-2 text-ink-3 hover:bg-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            >
              <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
            </button>
          )}
        </div>
        {hasChildren && !collapsed && isOpen && (
          <ul id={`sub-${node.key}`} className="mt-0.5 ml-[22px] flex flex-col gap-0.5 border-l border-line pl-2">
            {node.children.map((c) => renderNode(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav ref={navRef} aria-label="Navigasi utama" onKeyDown={onKeyDown}>
      <ul className="flex flex-col gap-0.5">{nodes.map((n) => renderNode(n, 0))}</ul>
    </nav>
  );
}

function AccountBlock({ name, role, collapsed }: { name: string; role: Role; collapsed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await internalRequest("/api/dtic/auth/logout", "POST");
      router.replace("/dtic/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal keluar. Coba lagi.");
      setBusy(false);
    }
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        aria-label={busy ? "Sedang keluar" : `Keluar dari ${name}`}
        title="Keluar"
        className="mx-auto flex size-10 items-center justify-center rounded-lg text-bad hover:bg-bad-soft disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <LogOut className="size-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-subtle px-3 py-2.5 text-xs leading-relaxed text-ink-3">
      <p className="truncate font-medium text-ink-2">{name}</p>
      <p>{ROLE_LABEL[role]}</p>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-bad hover:bg-bad-soft disabled:opacity-50"
      >
        <LogOut className="size-3.5" aria-hidden="true" />
        {busy ? "Keluar…" : "Keluar"}
      </button>
      {error && <p role="alert" className="mt-1 text-bad">{error}</p>}
    </div>
  );
}

export type AppFrameProps = {
  role: Role;
  name: string;
  menu: MenuNode[];
  systemName: string;
  tagline: string;
  defaultCollapsed: boolean;
  children: ReactNode;
};

/**
 * Kerangka panel: sidebar desktop (bisa diciutkan) + drawer mobile + area konten.
 * Menu sudah difilter server per role; komponen ini hanya menampilkan.
 */
export function AppFrame({ role, name, menu, systemName, tagline, defaultCollapsed, children }: AppFrameProps) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribePref, () => readPref(defaultCollapsed), () => defaultCollapsed);
  // Transisi lebar hanya aktif setelah hidrasi: preferensi tersimpan tidak beranimasi saat halaman dimuat.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [lastPath, setLastPath] = useState(pathname);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const currentKey = activeKey(menu, pathname);

  // Drawer mobile selalu tertutup setelah pindah halaman (cara resmi: menyesuaikan state saat render).
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    const trigger = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, [drawerOpen]);

  function toggleCollapsed() {
    writePref(!collapsed);
  }

  const tree = (
    <NavTree
      nodes={menu}
      currentKey={currentKey}
      collapsed={false}
      onNavigate={() => setDrawerOpen(false)}
      openGroups={openGroups}
      setOpenGroups={setOpenGroups}
    />
  );

  return (
    <div className="min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface lg:flex",
          mounted && "transition-[width] duration-200",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center gap-2 px-4", collapsed ? "justify-center" : "justify-between")}>
          <Logo name={systemName} subtitle={tagline} compact={collapsed} />
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Ciutkan sidebar"
              aria-expanded={true}
              aria-controls="sidebar-nav"
              className="rounded-lg p-1.5 text-ink-3 hover:bg-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {collapsed && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Perluas sidebar"
              aria-expanded={false}
              aria-controls="sidebar-nav"
              title="Perluas sidebar"
              className="rounded-lg p-2 text-ink-3 hover:bg-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
        <div id="sidebar-nav" className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
          <NavTree
            nodes={menu}
            currentKey={currentKey}
            collapsed={collapsed}
            openGroups={openGroups}
            setOpenGroups={setOpenGroups}
          />
        </div>
        <div className="p-3">
          <AccountBlock name={name} role={role} collapsed={collapsed} />
        </div>
      </aside>

      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Logo name={systemName} subtitle={tagline} />
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-lg p-2 text-ink-2 hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          aria-label="Buka menu"
          aria-expanded={drawerOpen}
          aria-controls="mobile-nav"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" id="mobile-nav" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-[rgb(15_23_42/0.3)]" aria-label="Tutup menu" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-pop">
            <div className="flex h-14 items-center justify-between px-4">
              <Logo name={systemName} subtitle={tagline} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-ink-3 hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
                aria-label="Tutup menu"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">{tree}</div>
            <div className="p-3">
              <AccountBlock name={name} role={role} collapsed={false} />
            </div>
          </div>
        </div>
      )}

      <main className={cn(mounted && "transition-[padding] duration-200", collapsed ? "lg:pl-[76px]" : "lg:pl-64")}>
        {/* Lebar maksimum ikut `collapsed` (state sidebar yang sudah ada, bukan state baru): sidebar
           tertutup membebaskan ruang, jadi konten (termasuk tabel lebar) boleh memakainya. Keduanya kelas
           Tailwind tetap (bukan nilai px dari JS), jadi tidak ada pengukuran — murni CSS mengikuti padding
           sidebar yang sudah bertransisi di atas. */}
        <div data-testid="panel-content" className={cn("mx-auto w-full px-4 py-6 transition-[max-width] duration-200 sm:px-6 sm:py-8 lg:px-10", collapsed ? "max-w-[1680px]" : "max-w-[1400px]")}>
          {children}
        </div>
      </main>
    </div>
  );
}
