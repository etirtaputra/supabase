"use client";

import { CategorySlug, CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CategoryBadgeProps {
  category: CategorySlug;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function CategoryBadge({
  category,
  size = "md",
  className,
}: CategoryBadgeProps) {
  const info = CATEGORIES.find((c) => c.slug === category);
  if (!info) return null;

  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5",
    md: "text-xs px-2 py-1",
    lg: "text-sm px-3 py-1.5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium border",
        info.textColor,
        info.borderColor,
        info.bgColor,
        sizeClasses[size],
        className
      )}
    >
      <span>{info.icon}</span>
      <span>{info.label}</span>
    </span>
  );
}
