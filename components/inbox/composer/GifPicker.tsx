"use client";

import { useEffect, useState, useTransition } from "react";
import { MagnifyingGlass, Sparkle, X } from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GiphyGifItem } from "@/app/api/v1/gifs/route";

const QUICK_TAGS = [
  { label: "Em Alta", query: "" },
  { label: "Haha", query: "haha" },
  { label: "Obrigado", query: "obrigado" },
  { label: "Parabéns", query: "parabens" },
  { label: "Joinha", query: "joinha" },
  { label: "Bora", query: "bora" },
  { label: "Coração", query: "coracao" },
  { label: "Dança", query: "danca" },
];

interface Props {
  onPick: (gif: GiphyGifItem) => void;
}

export function GifPicker({ onPick }: Props) {
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("Em Alta");
  const [gifs, setGifs] = useState<GiphyGifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const fetchGifs = async (searchQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = searchQuery.trim()
        ? `/api/v1/gifs?q=${encodeURIComponent(searchQuery.trim())}&limit=24`
        : `/api/v1/gifs?limit=24`;

      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error("Falha ao buscar GIFs");
      }
      const data = await res.json();
      if (Array.isArray(data.data)) {
        setGifs(data.data);
      } else {
        setGifs([]);
      }
    } catch {
      setError("Erro ao carregar GIFs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(() => {
        fetchGifs(query);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const handleTagClick = (tagLabel: string, tagQuery: string) => {
    setSelectedTag(tagLabel);
    setQuery(tagQuery);
  };

  return (
    <div className="flex h-[420px] w-[340px] flex-col rounded-lg border bg-popover text-popover-foreground shadow-2xl overflow-hidden">
      {/* Header com busca */}
      <div className="p-2.5 border-b space-y-2 bg-muted/40">
        <div className="relative flex items-center">
          <MagnifyingGlass
            size={16}
            className="absolute left-2.5 text-muted-foreground pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedTag("");
            }}
            placeholder="Buscar GIFs no GIPHY..."
            className="h-8 pl-8 pr-8 text-xs rounded-md bg-background"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelectedTag("Em Alta");
              }}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Chips de Categorias Rápidas */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          {QUICK_TAGS.map((tag) => (
            <button
              key={tag.label}
              type="button"
              onClick={() => handleTagClick(tag.label, tag.query)}
              className={cn(
                "whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors shrink-0",
                selectedTag === tag.label || (tag.query === "" && query === "")
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {tag.label === "Em Alta" && <Sparkle size={10} className="inline mr-1" />}
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de GIFs */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-muted-foreground/20">
        {loading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-md" />
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-4">
            <p className="text-xs text-muted-foreground mb-2">{error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchGifs(query)}
              className="text-xs h-7"
            >
              Tentar novamente
            </Button>
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-4">
            <p className="text-xs text-muted-foreground mb-1">
              Nenhum GIF encontrado para &quot;{query}&quot;.
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              Para busca ilimitada, adicione <code className="rounded bg-muted px-1">GIPHY_API_KEY</code> no <code className="rounded bg-muted px-1">.env.local</code>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onPick(gif)}
                title={gif.title}
                className="group relative h-28 w-full overflow-hidden rounded-md bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring hover:opacity-90 transition-transform active:scale-95"
              >
                <img
                  src={gif.preview_url}
                  alt={gif.title}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer "Powered by GIPHY" */}
      <div className="flex items-center justify-center gap-1.5 py-1.5 px-3 border-t bg-muted/30 text-[10px] text-muted-foreground font-semibold tracking-wider uppercase">
        <span>Powered by</span>
        <span className="font-black tracking-widest text-primary">GIPHY</span>
      </div>
    </div>
  );
}
