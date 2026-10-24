/** Platform mark: an open book whose pages form a rising path. */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M8 21.5V11c2.8-.9 5.4-.5 8 1.3 2.6-1.8 5.2-2.2 8-1.3v10.5c-2.8-.9-5.4-.5-8 1.3-2.6-1.8-5.2-2.2-8-1.3Z" className="fill-none stroke-on-primary" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 12.3v10.5" className="stroke-on-primary" strokeWidth="1.8" />
    </svg>
  );
}
