"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { toFaDigits } from "@uni/shared/format";

/** Fades content up once it scrolls into view; `delay` (ms) staggers siblings. */
export function Reveal({ children, delay = 0, as: Tag = "div", className = "" }: { children: ReactNode; delay?: number; as?: ElementType; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(t);
    }
    // an observer always reports once right after observe(); if it never does (unusual
    // embedded browsers, crawlers), show the content instead of leaving it invisible
    let reported = false;
    const io = new IntersectionObserver(
      ([e]) => {
        reported = true;
        if (e?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    const fallback = setTimeout(() => !reported && setVisible(true), 1200);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, []);
  return (
    <Tag ref={ref} data-visible={visible} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/** Counts up to `value` once visible (instant under reduced motion). */
export function CountUp({ value, duration = 1200 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      raf = requestAnimationFrame(() => setN(value));
      return () => cancelAnimationFrame(raf);
    }
    let reported = false;
    const animate = () => {
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const fallback = setTimeout(() => {
      if (!reported) setN(value);
    }, 1200);
    const io = new IntersectionObserver(([e]) => {
      reported = true;
      if (!e?.isIntersecting) return;
      io.disconnect();
      animate();
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);
  return (
    <span ref={ref} className="tabular">
      {toFaDigits(String(n))}
    </span>
  );
}
