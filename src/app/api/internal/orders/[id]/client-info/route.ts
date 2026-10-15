import { z } from "zod";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, assertUuid, errorResponse, json, readJson } from "@/lib/server/http";
import { authorize } from "@/lib/server/auth";
import { updateClientInfo } from "@/lib/server/repositories/orders";
import { toFieldErrors } from "@/lib/validation/common";

/** Pesan & tautan hasil yang ditampilkan ke pemohon — diatur tim DTIC (internal). */
const schema = z
  .object({
    requesterMessage: z.string().trim().max(2000, "Pesan maksimal 2000 karakter.").transform((v) => v || null),
    resultUrl: z
      .string()
      .trim()
      .max(2000)
      .transform((v, ctx) => {
        if (!v) return null;
        let u: URL;
        try {
          u = new URL(v);
        } catch {
          ctx.addIssue({ code: "custom", message: "Tautan hasil tidak valid." });
          return z.NEVER;
        }
        if (u.protocol !== "https:" || u.username || u.password) {
          ctx.addIssue({ code: "custom", message: "Tautan hasil harus https tanpa kredensial." });
          return z.NEVER;
        }
        return u.toString();
      }),
  })
  .strict();

export async function PUT(request: Request, ctx: RouteContext<"/api/internal/orders/[id]/client-info">) {
  const auth = await authorize(request, "orders.update");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const { id } = await ctx.params;
    assertUuid(id, "Order");
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali isian.", 422, toFieldErrors(parsed.error));
    await updateClientInfo(id, parsed.data);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PUT client-info");
  }
}
