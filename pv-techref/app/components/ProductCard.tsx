"use client";

import Link from "next/link";
import { CategorySlug, CATEGORIES } from "@/lib/types";
import { formatIDR, cn } from "@/lib/utils";
import CategoryBadge from "./CategoryBadge";

interface ProductCardProps {
  id: string;
  model: string;
  category: CategorySlug;
  keySummary: string;
  selling_price_idr: number | null;
  onClick?: () => void;
  variant?: "card" | "list";
}

export default function ProductCard({
  model,
  category,
  keySummary,
  selling_price_idr,
  onClick,
  variant = "card",
}: ProductCardProps) {
  const info = CATEGORIES.find((c) => c.slug === category);

  if (variant === "list") {
    return (
      <Link
        href={`/${category}/${encodeURIComponent(model)}`}
        onClick={onClick}
        className={cn(
          "flex items-center gap-3 px-4 py-3 hover:bg-slate-800/70 transition-colors cursor-pointer border-b border-slate-800/50 last:border-0",
        )}
      >
        <span className="text-xl">{info?.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-slate-100 text-sm">
              {model}
            </span>
            <CategoryBadge category={category} size="sm" />
          </div>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{keySummary}</p>
        </div>
        <div className="text-right shrink-0">
          {selling_price_idr !== null ? (
            <span className="text-xs font-mono text-emerald-400">
              {formatIDR(selling_price_idr)}
            </span>
          ) : (
            <span className="text-xs text-slate-500">Contact sales</span>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/${category}/${encodeURIComponent(model)}`}
      onClick={onClick}
      className={cn(
        "block p-4 rounded-xl border bg-slate-900/50 hover:bg-slate-800/70 transition-all cursor-pointer group",
        info?.borderColor,
        "border-opacity-30 hover:border-opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <CategoryBadge category={category} size="sm" />
        <span className="text-xl">{info?.icon}</span>
      </div>
      <h3 className="font-mono font-bold text-slate-100 text-base group-hover:text-white">
        {model}
      </h3>
      <p className="text-xs text-slate-400 mt-1 line-clamp-2">{keySummary}</p>
      <div className="mt-3 pt-3 border-t border-slate-800">
        {selling_price_idr !== null ? (
          <span className="text-sm font-mono font-semibold text-emerald-400">
            {formatIDR(selling_price_idr)}
          </span>
        ) : (
          <span className="text-sm text-slate-500 italic">— Contact sales</span>
        )}
      </div>
    </Link>
  );
}
