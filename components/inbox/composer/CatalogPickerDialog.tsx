"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCatalogSearch } from "@/hooks/inbox/useCatalogSearch";
import { MagnifyingGlass, ShoppingBag } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { CatalogSearchItem } from "@/app/api/v1/catalog/search/route";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sending?: boolean;
  onPick: (product: CatalogSearchItem) => void;
}

export function CatalogPickerDialog({
  open,
  onOpenChange,
  sending,
  onPick,
}: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, open]);

  const { data: products = [], isLoading } = useCatalogSearch(debounced, {
    enabled: open,
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearch("");
      setDebounced("");
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Catálogo de produtos</DialogTitle>
          <DialogDescription>
            Busque um produto para enviar preço e detalhes na conversa.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, modelo, SKU…"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {isLoading && products.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Buscando produtos…
            </p>
          ) : products.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {debounced
                ? "Nenhum produto encontrado."
                : "Nenhum produto cadastrado no catálogo."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {products.map((p) => {
                const detalhes = [p.marca, p.categoria, p.codigo ? `#${p.codigo}` : null]
                  .filter(Boolean)
                  .join(" • ");

                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={sending}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                        "hover:bg-muted disabled:opacity-50",
                      )}
                      onClick={() => onPick(p)}
                    >
                      {p.imagem_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={p.imagem_url}
                          alt={p.nome}
                          className="h-10 w-10 shrink-0 rounded object-cover border border-border bg-muted"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-muted">
                          <ShoppingBag
                            size={20}
                            weight="duotone"
                            className="text-primary"
                            aria-hidden
                          />
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {p.nome}
                        </span>
                        {detalhes && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {detalhes}
                          </span>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <span className="block font-semibold text-sm text-foreground">
                          {p.preco_formatado}
                        </span>
                        {!p.disponivel && (
                          <span className="inline-block mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            Sem estoque
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
