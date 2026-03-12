"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CategoryNavProps {
  counts?: Record<string, number>;
}

export default function CategoryNav({ counts = {} }: CategoryNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
        Categories
      </div>
      {CATEGORIES.map((cat) => {
        const isActive = pathname === `/${cat.slug}`;
        const count = counts[cat.slug];

        return (
          <Link
            key={cat.slug}
            href={`/${cat.slug}`}
            className={cn(
              "flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors group",
              isActive
                ? cn(cat.bgColor, cat.textColor, "font-medium")
                : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-base">{cat.icon}</span>
              <span>{cat.label}</span>
            </div>
            {count !== undefined && (
              <span
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded-full",
                  isActive
                    ? cn(cat.textColor, cat.bgColor, "border", cat.borderColor)
                    : "bg-slate-700 text-slate-400"
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
