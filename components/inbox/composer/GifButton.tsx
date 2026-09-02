"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GifPicker } from "./GifPicker";
import type { GiphyGifItem } from "@/app/api/v1/gifs/route";

interface Props {
  disabled?: boolean;
  onPick: (gif: GiphyGifItem) => void;
}

export function GifButton({ disabled, onPick }: Props) {
  const [open, setOpen] = useState(false);

  const handlePick = (gif: GiphyGifItem) => {
    setOpen(false);
    onPick(gif);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0 font-black text-xs tracking-tighter"
          aria-label="GIFs"
          title="Enviar GIF (GIPHY)"
          disabled={disabled}
        >
          <span className="rounded border border-current px-1 py-0.5 text-[10px] font-extrabold leading-none">
            GIF
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-auto border-none p-0 shadow-xl bg-transparent"
      >
        {open && <GifPicker onPick={handlePick} />}
      </PopoverContent>
    </Popover>
  );
}
