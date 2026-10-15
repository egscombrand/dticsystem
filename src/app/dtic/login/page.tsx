import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Masuk" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6">
        <div className="grid w-full items-center gap-10 lg:grid-cols-2">
          <section className="hidden lg:block">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-navy text-lg font-bold tracking-tight text-white shadow-card" aria-hidden="true">
              DC
            </div>
            <p className="mt-8 text-[12px] font-semibold tracking-[0.14em] text-teal uppercase">DTIC Connect</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-navy">One Portal for Creative &amp; IT Requests</h2>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-3">
              Kelola request kreatif dan IT dalam satu portal terintegrasi: dari penugasan PIC, progres pengerjaan, hingga penyelesaian.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-ink-2">
              <li className="flex items-center gap-3"><span className="size-1.5 rounded-full bg-cyan-500" aria-hidden="true" /> Akses sesuai peran: Super Admin, Manager, atau Staff</li>
              <li className="flex items-center gap-3"><span className="size-1.5 rounded-full bg-cyan-500" aria-hidden="true" /> Sesi aman dengan cookie httpOnly</li>
            </ul>
          </section>

          <section className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8" aria-labelledby="login-title">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="flex size-10 items-center justify-center rounded-xl bg-navy text-sm font-bold text-white" aria-hidden="true">DC</span>
              <div className="leading-tight">
                <p className="text-[15px] font-semibold text-navy">DTIC Connect</p>
                <p className="text-[11.5px] text-ink-3">One Portal for Creative &amp; IT Requests</p>
              </div>
            </div>
            <h1 id="login-title" className="text-2xl font-semibold tracking-tight text-navy">Masuk ke DTIC Connect</h1>
            <p className="mt-1.5 text-sm text-ink-3">Kelola request kreatif dan IT dalam satu portal terintegrasi.</p>
            <div className="mt-7">
              <LoginForm />
            </div>
            <p className="mt-6 text-center text-[12.5px] text-ink-3">
              Belum punya akun? Hubungi Super Admin DTIC. Akun tidak dibuat secara publik.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
