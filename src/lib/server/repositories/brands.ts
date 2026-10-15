import "server-only";
import { sql } from "@/lib/server/db";
import type { Brand } from "@/lib/types";

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

function mapBrand(r: BrandRow): Brand {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listBrands(opts: { activeOnly?: boolean } = {}): Promise<Brand[]> {
  const db = sql();
  const rows = await db<BrandRow[]>`
    select id, name, slug, is_active, sort_order, created_at, updated_at
    from brands
    ${opts.activeOnly ? db`where is_active` : db``}
    order by sort_order, name`;
  return rows.map(mapBrand);
}

export async function getBrand(id: string): Promise<Brand | null> {
  const rows = await sql()<BrandRow[]>`
    select id, name, slug, is_active, sort_order, created_at, updated_at from brands where id = ${id}`;
  return rows[0] ? mapBrand(rows[0]) : null;
}
