"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme";

const LINKS = [
  { href: "#universities", label: "دانشگاه‌ها" },
  { href: "#how", label: "مراحل ثبت‌نام" },
  { href: "#services", label: "خدمات" },
];

/** Transparent over the dark hero, turns into a frosted bar once the page scrolls. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const solid = scrolled || open;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,color] duration-300 ${
        solid ? "border-b border-border/70 bg-background/85 text-foreground backdrop-blur-xl" : "border-b border-transparent text-white"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-bold">
          <Logo />
          <span>سامانه خدمات دانشگاهی</span>
        </Link>
        <nav aria-label="بخش‌های صفحه" className="ms-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={`rounded-full px-3.5 py-2 text-sm transition-colors ${solid ? "text-muted-foreground hover:text-foreground" : "text-white/75 hover:text-white"}`}>
              {l.label}
            </a>
          ))}
          <ThemeToggle className={`ms-1 ${solid ? "hover:bg-muted" : "hover:bg-white/10"}`} />
          <a
            href="#universities"
            className={`ms-2 inline-flex h-10 items-center rounded-full px-5 text-sm font-semibold transition-colors ${
              solid ? "bg-primary text-on-primary hover:bg-primary-hover" : "bg-white text-[#0b1f52] hover:bg-white/90"
            }`}
          >
            ثبت‌نام یا ورود
          </a>
        </nav>
        <div className="ms-auto flex items-center gap-1 md:hidden">
          <ThemeToggle className={solid ? "hover:bg-muted" : "hover:bg-white/10"} />
          <button
            type="button"
            className={`flex size-11 cursor-pointer items-center justify-center rounded-full ${solid ? "hover:bg-muted" : "hover:bg-white/10"}`}
            aria-label={open ? "بستن منو" : "باز کردن منو"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="بخش‌های صفحه" className="border-t border-border px-4 pb-4 md:hidden">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-md px-2 py-3 text-base">
              {l.label}
            </a>
          ))}
          <a href="#universities" onClick={() => setOpen(false)} className="mt-2 flex h-11 items-center justify-center rounded-full bg-primary font-semibold text-on-primary">
            ثبت‌نام یا ورود
          </a>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-6">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo className="size-8" />
            <p className="font-bold">سامانه خدمات دانشگاهی</p>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">بستر یکپارچه فرایندهای آموزشی و پژوهشی؛ هر دانشگاه با قواعد خودش، همه در یک سامانه امن.</p>
        </div>
        <div>
          <p className="text-sm font-semibold">دسترسی سریع</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="hover:text-foreground">{l.label}</a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">امنیت و حریم خصوصی</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>داده هر دانشگاه کاملاً جدا</li>
            <li>مدارک رمزنگاری‌شده و ردیابی‌شده</li>
            <li>ثبت غیرقابل‌تغییر اقدامات حساس</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
