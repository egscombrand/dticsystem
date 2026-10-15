import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { ENTITY_DEFS, type MasterEntity } from "@/lib/master-data";

export function SettingsTabs({ active, entities }: { active: MasterEntity; entities: readonly MasterEntity[] }) {
  return (
    <nav aria-label="Bagian pengaturan" className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
        {entities.map((e) => (
          <li key={e}>
            <Link
              href={`/dtic/settings/${e}`}
              aria-current={e === active ? "page" : undefined}
              className={cn(
                "block rounded-lg px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors",
                e === active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-subtle hover:text-ink",
              )}
            >
              {ENTITY_DEFS[e].title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
