import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "@/app/login/login-form";
import { TechnicLogo } from "@/components/shared/technic-logo";

export const metadata = { title: "Sign in — Technic Technologies ERP" };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-br from-[#0b2417] via-[#123524] to-[#0b2417] px-4 py-12">
      {/* Subtle branded background glows */}
      <div className="pointer-events-none absolute -left-40 -top-40 size-96 rounded-full bg-red-600/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 size-96 rounded-full bg-green-500/10 blur-3xl" />

      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center justify-center rounded-2xl bg-white p-5 shadow-[0_0_60px_rgba(18,53,36,0.55)]">
            <TechnicLogo className="h-12" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Technic Technologies
            </h1>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
              Electronics ERP
            </p>
          </div>
        </div>

        <Suspense fallback={<Skeleton className="h-48 w-full rounded-2xl bg-white/10" />}>
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs text-white/50">
          Lost your code? Ask a Super Admin to look it up in Users.
        </p>
      </div>
    </div>
  );
}
