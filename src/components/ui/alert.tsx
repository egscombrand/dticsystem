import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

const styles = {
  error: { box: "border-[#f6cfca] bg-bad-soft text-[#7a1a12]", icon: AlertCircle, iconCls: "text-bad" },
  success: { box: "border-[#c7ebd4] bg-ok-soft text-[#14532d]", icon: CheckCircle2, iconCls: "text-ok" },
  warning: { box: "border-[#fbe2b8] bg-warn-soft text-[#7a4a06]", icon: AlertTriangle, iconCls: "text-warn" },
  info: { box: "border-line bg-subtle text-ink-2", icon: Info, iconCls: "text-ink-3" },
};

export function Alert({ kind = "info", title, children, className }: { kind?: keyof typeof styles; title?: string; children?: ReactNode; className?: string }) {
  const s = styles[kind];
  const Icon = s.icon;
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", s.box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", s.iconCls)} aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}
