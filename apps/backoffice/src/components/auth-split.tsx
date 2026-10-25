import { Logo } from "@uni/shared/ui/logo";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

/** Split auth screen: form on one side, brand aurora panel on the other (desktop). */
export function AuthSplit({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <Logo className="size-10" />
            <div className="leading-tight">
              <p className="font-bold">پنل مدیریت</p>
              <p className="text-xs text-muted-foreground">سامانه خدمات دانشگاهی</p>
            </div>
          </div>
          <h1 className="text-2xl font-black">{title}</h1>
          <p className="mt-1.5 mb-8 text-sm text-muted-foreground">{subtitle}</p>
          {children}
        </div>
      </div>
      <aside aria-hidden className="hero-band relative isolate hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 -z-10">
          <span className="aurora aurora-1 -top-20 -end-10 size-[30rem]" />
          <span className="aurora aurora-2 bottom-[-15%] start-[10%] size-[26rem]" />
          <span className="aurora aurora-3 top-[30%] start-[-10%] size-80" />
          <div className="grid-lines absolute inset-0" />
        </div>
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm text-white/85 backdrop-blur">
          <ShieldCheck className="size-4 text-gold-bright" />
          دسترسی امن و ردیابی‌شده
        </p>
        <div>
          <h2 className="text-4xl leading-tight font-black">
            همه فرایندهای دانشگاه،
            <br />
            <span className="text-gold-gradient">در یک پنل.</span>
          </h2>
          <p className="mt-4 max-w-md leading-8 text-white/70">عضویت‌ها، ساختار سازمانی، نقش‌ها و ممیزی را از یک جا مدیریت کنید؛ هر دانشگاه با قواعد خودش.</p>
        </div>
        <ul className="grid grid-cols-3 gap-3 text-sm">
          {["جداسازی کامل داده", "ممیزی غیرقابل‌تغییر", "ورود دومرحله‌ای"].map((f) => (
            <li key={f} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-white/80 backdrop-blur">{f}</li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
