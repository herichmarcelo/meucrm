"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { obterEstiloTag } from "@/lib/tags/paleta";

interface TagChipProps {
  tag: string;
  color?: string | null;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Chip visual de Tag colorido com suporte a light e dark mode.
 * Se a cor não for informada ou for nula, recai suavemente no visual neutro atual.
 */
export function TagChip({
  tag,
  color,
  onRemove,
  disabled,
  className,
  size = "sm",
}: TagChipProps) {
  const estilo = obterEstiloTag(color, tag);

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center font-medium transition-colors border",
        size === "sm" ? "h-4 px-1.5 text-[10px]" : "h-5 gap-1 px-1.5 text-[10px]",
        estilo.badgeClass,
        className,
      )}
    >
      <span className="truncate">{tag}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          disabled={disabled}
          aria-label={`Remover tag ${tag}`}
          className="ml-0.5 rounded-xs p-0.5 hover:bg-black/10 dark:hover:bg-white/10 hover:text-destructive focus:outline-none"
        >
          <X size={10} weight="bold" aria-hidden />
        </button>
      )}
    </Badge>
  );
}
