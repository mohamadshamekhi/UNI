import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/site-header";
import { Logo } from "@uni/shared/ui/logo";

export const metadata: Metadata = { title: "شرایط استفاده و حریم خصوصی" };

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "اطلاعاتی که جمع‌آوری می‌شود",
    items: [
      "نام، شماره موبایل، ایمیل (اختیاری)، شماره دانشجویی یا پرسنلی، دانشکده و اطلاعات تحصیلی.",
      "کد ملی فقط در صورت الزام دانشگاه و به‌صورت هش‌شده نگهداری می‌شود.",
      "تصویر کارت دانشجویی یا حکم کارگزینی برای بررسی عضویت.",
    ],
  },
  {
    title: "استفاده از اطلاعات",
    items: [
      "اطلاعات فقط برای بررسی عضویت و ارائه خدمات همان دانشگاه استفاده می‌شود.",
      "داده هر دانشگاه از دانشگاه‌های دیگر کاملاً جداست و بین آن‌ها به اشتراک گذاشته نمی‌شود.",
      "پیامک‌ها فقط برای کد تأیید و اطلاع‌رسانی وضعیت درخواست ارسال می‌شوند.",
    ],
  },
  {
    title: "امنیت و دسترسی",
    items: [
      "مدارک در فضای خصوصی و رمزنگاری‌شده نگهداری می‌شوند و فقط کارشناس مجاز دانشگاه آن‌ها را می‌بیند.",
      "هر مشاهده یا دانلود مدرک و هر اقدام حساس به‌صورت غیرقابل‌تغییر ثبت می‌شود.",
      "رمز عبور با الگوریتم امن هش می‌شود و هیچ‌کس، حتی مدیران سامانه، به آن دسترسی ندارد.",
    ],
  },
  {
    title: "مدت نگهداری و حقوق شما",
    items: [
      "مدت نگهداری مدارک طبق سیاست هر دانشگاه تعیین می‌شود و پس از آن به‌صورت امن حذف می‌شوند.",
      "می‌توانید از طریق واحد مربوطه در دانشگاه، اصلاح یا دریافت اطلاعات شخصی خود را درخواست کنید.",
      "با ثبت‌نام، صحت اطلاعات واردشده را تأیید می‌کنید؛ اطلاعات نادرست ممکن است به رد درخواست منجر شود.",
    ],
  },
];

export default function TermsPage() {
  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2.5 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold">
            <Logo />
            سامانه خدمات دانشگاهی
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-black">شرایط استفاده و حریم خصوصی</h1>
        <p className="mt-3 rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning">
          نسخه پیش‌نویس؛ متن نهایی پس از تأیید واحد حقوقی دانشگاه جایگزین می‌شود.
        </p>
        <div className="mt-10 flex flex-col gap-10">
          {SECTIONS.map((s) => (
            <section key={s.title} aria-labelledby={s.title}>
              <h2 id={s.title} className="text-xl font-bold">{s.title}</h2>
              <ul className="mt-4 list-disc space-y-2.5 ps-5 leading-8 text-muted-foreground">
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
