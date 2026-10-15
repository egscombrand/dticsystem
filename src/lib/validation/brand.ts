import { MASTER_SCHEMAS } from "@/lib/master-data";
import type { z } from "zod";

/** Skema brand = skema data master brand (satu sumber validasi). */
export const brandUpdateSchema = MASTER_SCHEMAS.brands;

export type BrandUpdateInput = z.output<typeof brandUpdateSchema>;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
