import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { themeInitScript } from "@uni/shared/theme-script";

const vazirmatn = Vazirmatn({ variable: "--font-vazirmatn", subsets: ["arabic", "latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "پنل مدیریت", template: "%s · پنل مدیریت" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" data-theme="light" suppressHydrationWarning className={`${vazirmatn.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
          پرش به محتوای اصلی
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
