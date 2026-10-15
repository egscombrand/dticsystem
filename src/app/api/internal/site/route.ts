import { authorize } from "@/lib/server/auth";
import { assertSameOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { getSiteSettings, updateSiteSettings } from "@/lib/server/repositories/site";
import { toFieldErrors } from "@/lib/validation/common";
import { siteSettingsSchema } from "@/lib/validation/site";

export async function GET(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    return json({ site: await getSiteSettings() });
  } catch (error) {
    return errorResponse(error, "GET site");
  }
}

export async function PUT(request: Request) {
  const auth = await authorize(request, "site.manage");
  if (!auth.ok) return auth.response;
  try {
    assertSameOrigin(request, { requireCustomHeader: true });
    const parsed = siteSettingsSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("Periksa kembali pengaturan website.", 422, toFieldErrors(parsed.error));
    await updateSiteSettings(parsed.data, auth.session.userId);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "PUT site");
  }
}
