import { SearchX } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export default function OrderNotFound() {
  return (
    <Card className="mt-10">
      <EmptyState
        icon={SearchX}
        title="Pekerjaan tidak ditemukan"
        description="Pekerjaan mungkin sudah dihapus atau tautannya tidak valid."
        action={<LinkButton href="/dtic/orders" variant="secondary" size="sm">Kembali ke daftar order</LinkButton>}
      />
    </Card>
  );
}
