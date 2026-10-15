"use client";

import { AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, internalRequest } from "@/lib/client/api";

type Errors = { email?: string; password?: string; form?: string };

export function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const email = (emailRef.current?.value ?? "").trim().toLowerCase();
    const password = passwordRef.current?.value ?? "";
    const next: Errors = {};
    if (!email) next.email = "Email wajib diisi.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = "Format email tidak valid.";
    if (!password) next.password = "Kata sandi wajib diisi.";
    if (next.email || next.password) {
      setErrors(next);
      (next.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setPending(true);
    setErrors({});
    try {
      await internalRequest("/api/dtic/auth/login", "POST", { email, password });
      router.replace("/dtic/dashboard");
      router.refresh();
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.fieldErrors) {
        setErrors({ email: err.fieldErrors.email, password: err.fieldErrors.password, form: err.message });
      } else {
        setErrors({ form: err instanceof Error ? err.message : "Gagal masuk. Coba lagi." });
      }
      if (passwordRef.current) passwordRef.current.value = "";
      passwordRef.current?.focus();
    }
  }

  const field = "h-11 w-full rounded-lg border bg-surface px-3.5 text-[15px] text-ink placeholder:text-[#9aa1ad] transition-colors focus:outline-none focus:ring-3 focus:ring-cyan-400/25 disabled:bg-subtle disabled:opacity-70";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-describedby={errors.form ? "login-error" : undefined}>
      {errors.form && (
        <div id="login-error" role="alert" className="flex items-start gap-2.5 rounded-lg border border-[#f6cfca] bg-bad-soft px-3.5 py-3 text-sm text-[#7a1a12]">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden="true" />
          <span>{errors.form}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-[13px] font-medium text-ink">Email</label>
        <input
          id="login-email"
          ref={emailRef}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          spellCheck={false}
          placeholder="nama@dtic.example"
          disabled={pending}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "login-email-error" : undefined}
          className={cn(field, errors.email ? "border-bad" : "border-line-strong hover:border-[#bfc5cd]")}
        />
        {errors.email && <p id="login-email-error" className="text-[12.5px] text-bad">{errors.email}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="login-password" className="text-[13px] font-medium text-ink">Kata sandi</label>
        </div>
        <div className="relative">
          <input
            id="login-password"
            ref={passwordRef}
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="current-password"
            disabled={pending}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "login-password-error" : undefined}
            className={cn(field, "pr-12", errors.password ? "border-bad" : "border-line-strong hover:border-[#bfc5cd]")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            disabled={pending}
            aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-500 disabled:opacity-50"
          >
            {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
        {errors.password && <p id="login-password-error" className="text-[12.5px] text-bad">{errors.password}</p>}
      </div>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgb(16_24_40/0.12)] transition-colors hover:bg-[#1c3558] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <Spinner className="size-4" />
            Memeriksa akun…
          </>
        ) : (
          <>
            Masuk
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </button>
      <p className="sr-only" aria-live="polite">{pending ? "Sedang memproses masuk." : ""}</p>
    </form>
  );
}
