import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BrandListSkeleton } from "@/components/ui/skeletons";
import { TableScroll } from "@/components/ui/table-scroll";
import { can } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/dates";
import { requireSession } from "@/lib/server/auth";
import { listAuditLog } from "@/lib/server/repositories/audit";

export const metadata: Metadata = { title: "Audit Aktivitas" };

const ACTION_LABEL: Record<string, string> = {
  login: "Masuk",
  logout: "Keluar",
  login_failed: "Gagal masuk",
  account_locked: "Akun dikunci sementara",
  bootstrap_super_admin: "Super Admin awal dibuat",
  user_created: "Akun dibuat",
  user_updated: "Akun diubah",
  password_reset: "Kata sandi direset",
  menu_updated: "Menu diubah",
  menu_reset: "Menu dikembalikan",
  site_updated: "Pengaturan website diubah",
};

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit Aktivitas"
        description="Riwayat masuk, perubahan akun, dan perubahan pengaturan. Hanya Super Admin. Kata sandi dan token tidak pernah dicatat."
        breadcrumbs={[{ label: "Dashboard", href: "/dtic/dashboard" }, { label: "Audit Aktivitas" }]}
      />
      <Suspense fallback={<BrandListSkeleton />}>
        <AuditContent />
      </Suspense>
    </>
  );
}

async function AuditContent() {
  await connection();
  const session = await requireSession();
  if (!can(session.role, "audit.view")) redirect("/dtic/unauthorized");
  const rows = await listAuditLog(100);
  return (
    <Card>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-ink-3">Belum ada aktivitas tercatat.</p>
      ) : (
        <TableScroll minWidthPx={640}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Waktu</th>
                <th scope="col" className="px-4 py-3 font-medium">Aktivitas</th>
                <th scope="col" className="px-4 py-3 font-medium">Oleh</th>
                <th scope="col" className="px-4 py-3 font-medium">Akun terkait</th>
                <th scope="col" className="px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-ink-3">{formatDateTime(r.createdAt)}</td>
                  <td className="px-4 py-3 text-ink">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="px-4 py-3 text-ink-2">{r.actorName ?? "Sistem"}</td>
                  <td className="px-4 py-3 text-ink-2">{r.targetEmail ?? "—"}</td>
                  <td className="px-4 py-3">
                    {Object.keys(r.detail).length > 0 ? (
                      <code className="block max-w-md break-all text-xs text-ink-3">{JSON.stringify(r.detail)}</code>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}
