"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items, label }: { items: { href: string; label: string }[]; label: string }) {
  const path = usePathname();
  return (
    <nav className="mx-auto max-w-6xl overflow-x-auto px-2" aria-label={label}>
      <ul className="flex gap-1 whitespace-nowrap pb-1">
        {items.map((i) => {
          const active = path === i.href || path.startsWith(i.href + "/");
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                className={`inline-block rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100"}`}
                aria-current={active ? "page" : undefined}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
