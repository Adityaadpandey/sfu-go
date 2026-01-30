"use client";

import { cn } from "@/lib/utils";
import { ConnectionQuality } from "@/types";

interface QualityIndicatorProps {
  quality?: ConnectionQuality;
  className?: string;
}

export function QualityIndicator({ quality, className }: QualityIndicatorProps) {
  if (!quality) return null;

  const getLevelBars = (level: string) => {
    switch (level) {
      case "excellent": return 4;
      case "good": return 3;
      case "poor": return 2;
      case "critical": return 1;
      default: return 0;
    }
  };

  const getQualityColor = (level: string) => {
    switch (level) {
      case "excellent": return "bg-emerald-500";
      case "good": return "bg-yellow-500";
      case "poor": return "bg-orange-500";
      case "critical": return "bg-red-500";
      default: return "bg-zinc-600";
    }
  };

  const activeBars = getLevelBars(quality.level);
  const colorClass = getQualityColor(quality.level);

  return (
    <div className={cn("flex items-end gap-0.5 h-3.5", className)}>
      {[1, 2, 3, 4].map((bar) => (
        <div
          key={bar}
          className={cn(
            "w-0.5 rounded-sm transition-colors",
            bar <= activeBars ? colorClass : "bg-zinc-600"
          )}
          style={{ height: `${4 + bar * 2}px` }}
        />
      ))}
    </div>
  );
}