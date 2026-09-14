"use client";

import React from "react";
import { PALETA_CORES_TAGS, TAG_COR_NEUTRA, type TagColorDef } from "@/lib/tags/paleta";
import { cn } from "@/lib/utils";

interface TagColorSelectorProps {
  selectedColor: string | null;
  onSelectColor: (colorId: string | null) => void;
  className?: string;
  disabled?: boolean;
}

export function TagColorSelector({
  selectedColor,
  onSelectColor,
  className,
  disabled,
}: TagColorSelectorProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5 py-1", className)}
      role="radiogroup"
      aria-label="Selecionar cor da tag"
    >
      {/* Opção Neutro */}
      <button
        type="button"
        role="radio"
        aria-checked={selectedColor === null || selectedColor === "neutro"}
        title="Neutro (padrão)"
        disabled={disabled}
        onClick={() => onSelectColor(null)}
        className={cn(
          "h-4 w-4 rounded-full border border-border transition-all focus:outline-none focus:ring-1 focus:ring-primary",
          TAG_COR_NEUTRA.dotClass,
          (selectedColor === null || selectedColor === "neutro")
            ? "ring-2 ring-primary ring-offset-1 scale-110"
            : "hover:scale-105 opacity-70 hover:opacity-100",
        )}
      />

      {/* Opções da Paleta Curada */}
      {PALETA_CORES_TAGS.map((item: TagColorDef) => {
        const isSelected = selectedColor === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            title={item.label}
            disabled={disabled}
            onClick={() => onSelectColor(item.id)}
            className={cn(
              "h-4 w-4 rounded-full transition-all focus:outline-none focus:ring-1 focus:ring-primary",
              item.dotClass,
              isSelected
                ? "ring-2 ring-primary ring-offset-1 scale-110"
                : "hover:scale-105 opacity-70 hover:opacity-100",
            )}
          />
        );
      })}
    </div>
  );
}
