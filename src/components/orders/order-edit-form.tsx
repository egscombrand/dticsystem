"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PicCombobox } from "@/components/assignments/pic-combobox";
import { RichTextEditor, type RichTextChange } from "@/components/rich-text/rich-text-editor";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ApiError, internalRequest } from "@/lib/client/api";
import { toDateTimeLocalValue } from "@/lib/dates";
import { parseRichDoc, plainTextToRichDoc } from "@/lib/rich-text";
import type { BrandOption, MemberOption, OrderDetail, OrderTypeOption, PriorityOption } from "@/lib/types";
import type { FieldErrors } from "@/lib/validation/common";
import { formatWhatsappDisplay } from "@/lib/whatsapp";
import { AssigneeList } from "@/components/assignments/assignee-list";

const FIELDS = [
  "requesterName", "requesterWhatsapp", "company", "department", "brandId", "designTypeId", "designTypeOther", "designSize", "title",
  "driveUrl", "briefYear", "briefReference", "designRequirements", "deadline", "priority",
] as const;

export function OrderEditForm({
  order,
  brands,
  orderTypes,
  priorities,
  members,
  canAssign,
}: {
  order: OrderDetail;
  brands: BrandOption[];
  orderTypes: OrderTypeOption[];
  priorities: PriorityOption[];
  members: MemberOption[];
  /** false = PIC hanya ditampilkan (Manager memantau, tidak menetapkan). */
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Data lama tanpa relasi jenis → arahkan ke jenis "tulis sendiri" dengan teks yang ada.
  const fallbackType = orderTypes.find((t) => t.requiresDetail && t.isActive)?.id ?? "";
  const [designTypeId, setDesignTypeId] = useState(order.designOrderTypeId ?? fallbackType);
  const selectedType = orderTypes.find((t) => t.id === designTypeId);
  const [initialBrief] = useState(() => {
    const parsed = order.briefRich ? parseRichDoc(order.briefRich) : null;
    return parsed?.ok ? parsed.doc : plainTextToRichDoc(order.brief);
  });
  const [brief, setBrief] = useState<RichTextChange | null>(null);
  const initialAssigneeIds = order.assignees.map((a) => a.id);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initialAssigneeIds);
  const [assigneeReason, setAssigneeReason] = useState("");
  // Perubahan PIC lewat form ini wajib alasan (tercatat di audit). Tanpa perubahan, alasan tidak diminta.
  const picChanged = assigneeIds.length !== initialAssigneeIds.length || assigneeIds.some((id) => !initialAssigneeIds.includes(id));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(FIELDS.map((k) => [k, String(fd.get(k) ?? "")]));
    body.briefDoc = brief?.json ?? initialBrief;
    if (canAssign) {
      body.assigneeIds = assigneeIds;
      if (picChanged) body.assigneeReason = assigneeReason.trim();
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await internalRequest(`/api/internal/orders/${order.id}`, "PATCH", body);
      router.push(`/dtic/orders/${order.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan perubahan.");
      setPending(false);
    }
  }

  const e = errors;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {formError && <Alert kind="error" title="Perubahan belum tersimpan">{formError}</Alert>}

      <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-[15px] font-semibold text-ink">Pemohon</legend>
        <Field label="Nama" htmlFor="requesterName" required error={e.requesterName}>
          <Input id="requesterName" name="requesterName" defaultValue={order.requesterName} required maxLength={120} invalid={!!e.requesterName} />
        </Field>
        <Field label="Departemen/divisi" htmlFor="department" required error={e.department}>
          <Input id="department" name="department" defaultValue={order.department} required maxLength={120} invalid={!!e.department} />
        </Field>
        <Field
          label="Nomor WhatsApp"
          htmlFor="requesterWhatsapp"
          error={e.requesterWhatsapp}
          hint="Kosongkan bila tidak diubah. Pengajuan lama mungkin belum memiliki nomor."
        >
          <Input
            id="requesterWhatsapp"
            name="requesterWhatsapp"
            type="tel"
            inputMode="tel"
            defaultValue={order.requesterWhatsapp ? formatWhatsappDisplay(order.requesterWhatsapp) : ""}
            maxLength={20}
            placeholder="Contoh: 081234567890"
            invalid={!!e.requesterWhatsapp}
          />
        </Field>
        <Field label="Brand pemohon" htmlFor="brandId" required error={e.brandId}>
          <Select id="brandId" name="brandId" defaultValue={order.brandId} invalid={!!e.brandId}>
            {brands.map((b) => (
              <option key={b.id} value={b.id} disabled={!b.isActive && b.id !== order.brandId}>
                {b.name}
                {!b.isActive ? " (nonaktif)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Keterangan perusahaan" htmlFor="company" error={e.company} hint="Catatan internal, mis. nama unit/anak perusahaan">
          <Input id="company" name="company" defaultValue={order.company ?? ""} maxLength={120} invalid={!!e.company} />
        </Field>
      </fieldset>

      <fieldset disabled={pending} className="grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
        <legend className="sr-only">Detail desain</legend>
        <Field label="Judul desain" htmlFor="title" required error={e.title} className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={order.title} required maxLength={160} invalid={!!e.title} />
        </Field>
        <Field label="Jenis order desain" htmlFor="designTypeId" required error={e.designTypeId}>
          <Select id="designTypeId" name="designTypeId" value={designTypeId} onChange={(ev) => setDesignTypeId(ev.target.value)} invalid={!!e.designTypeId}>
            {!designTypeId && <option value="">Pilih jenis</option>}
            {orderTypes.map((t) => (
              <option key={t.id} value={t.id} disabled={!t.isActive && t.id !== order.designOrderTypeId}>
                {t.requiresDetail ? `${t.name} (tulis sendiri)` : t.name}
                {!t.isActive ? " (nonaktif)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {selectedType?.requiresDetail && (
          <Field label="Jenis desain (tulis sendiri)" htmlFor="designTypeOther" required error={e.designTypeOther}>
            <Input
              id="designTypeOther"
              name="designTypeOther"
              defaultValue={order.designOrderTypeId === designTypeId || !order.designOrderTypeId ? order.designType : ""}
              maxLength={60}
              invalid={!!e.designTypeOther}
            />
          </Field>
        )}
        <Field label="Ukuran desain" htmlFor="designSize" required error={e.designSize}>
          <Input id="designSize" name="designSize" defaultValue={order.designSize} required maxLength={120} invalid={!!e.designSize} />
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="brief" className="text-[13px] font-medium text-ink">
            Deskripsi desain<span className="ml-0.5 text-bad" aria-hidden="true">*</span>
          </label>
          <RichTextEditor
            id="brief"
            initialContent={initialBrief}
            placeholder="Deskripsi desain yang diperlukan"
            disabled={pending}
            invalid={!!e.briefDoc}
            describedBy={e.briefDoc ? "brief-error" : undefined}
            onChange={setBrief}
          />
          {e.briefDoc && <p id="brief-error" className="text-[12.5px] text-bad">{e.briefDoc}</p>}
        </div>
        <Field label="URL Google Drive" htmlFor="driveUrl" error={e.driveUrl} className="sm:col-span-2">
          <Input id="driveUrl" name="driveUrl" type="url" defaultValue={order.driveUrl ?? ""} maxLength={2000} placeholder="https://drive.google.com/…" invalid={!!e.driveUrl} />
        </Field>
        <Field label="Kebutuhan desain (internal)" htmlFor="designRequirements" error={e.designRequirements} className="sm:col-span-2">
          <Textarea id="designRequirements" name="designRequirements" defaultValue={order.designRequirements ?? ""} maxLength={3000} invalid={!!e.designRequirements} />
        </Field>
        <Field label="Referensi" htmlFor="briefReference" error={e.briefReference}>
          <Textarea id="briefReference" name="briefReference" defaultValue={order.briefReference ?? ""} maxLength={2000} className="min-h-20" invalid={!!e.briefReference} />
        </Field>
        <Field label="Tahun" htmlFor="briefYear" error={e.briefYear}>
          <Input id="briefYear" name="briefYear" inputMode="numeric" defaultValue={order.briefYear ?? ""} maxLength={4} invalid={!!e.briefYear} />
        </Field>
        <Field label="Deadline (WIB)" htmlFor="deadline" required error={e.deadline}>
          <Input id="deadline" name="deadline" type="datetime-local" defaultValue={toDateTimeLocalValue(order.deadlineAt)} required invalid={!!e.deadline} />
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          {canAssign ? (
            <>
              <label htmlFor="assigneeIds" className="text-[13px] font-medium text-ink">
                Member DTIC yang Ditugaskan (PIC) <span className="font-normal text-ink-3">(opsional)</span>
              </label>
              <PicCombobox
                id="assigneeIds"
                members={members}
                value={assigneeIds}
                onChange={setAssigneeIds}
                disabled={pending}
                invalid={!!e.assigneeIds}
                describedBy="assigneeIds-hint"
              />
              <p id="assigneeIds-hint" className={e.assigneeIds ? "text-[12.5px] text-bad" : "text-[12.5px] text-ink-3"}>
                {e.assigneeIds ?? (assigneeIds.length ? "Bisa lebih dari satu PIC. Tersimpan saat menekan Simpan perubahan." : "Belum ada PIC.")}
              </p>
              {picChanged && (
                <Field label="Alasan perubahan PIC" htmlFor="assigneeReason" required error={e.assigneeReason} hint="Minimal 5 karakter. Tersimpan di riwayat perubahan PIC.">
                  <Textarea id="assigneeReason" name="assigneeReason" value={assigneeReason} onChange={(ev) => setAssigneeReason(ev.target.value)} maxLength={300} disabled={pending} invalid={!!e.assigneeReason} />
                </Field>
              )}
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium text-ink">Member DTIC yang Ditugaskan (PIC)</p>
              <AssigneeList assignees={order.assignees} />
              <p className="text-[12.5px] text-ink-3">Penugasan PIC diubah oleh Manager atau Super Admin dari panel PIC di detail order.</p>
            </>
          )}
        </div>
        <Field label="Prioritas" htmlFor="priority" required error={e.priority}>
          <Select id="priority" name="priority" defaultValue={order.priority} invalid={!!e.priority}>
            {priorities.map((p) => (
              <option key={p.code} value={p.code} disabled={!p.isActive && p.code !== order.priority}>
                {p.name}
                {!p.isActive ? " (nonaktif)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
        <LinkButton href={`/dtic/orders/${order.id}`} variant="ghost">Batal</LinkButton>
        <Button type="submit" loading={pending}>{pending ? "Menyimpan…" : "Simpan perubahan"}</Button>
      </div>
    </form>
  );
}
