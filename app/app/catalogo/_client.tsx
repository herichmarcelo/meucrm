"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowsClockwise,
  DotsThree,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Tag,
  Trash,
  UploadSimple,
} from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty/EmptyState";
import { ProductFormDialog } from "@/components/catalogo/ProductFormDialog";
import { ImportProductsDialog } from "@/components/catalogo/ImportProductsDialog";
import type { CatalogProductRow } from "@/lib/schemas/produtos";

interface Props {
  canManage: boolean;
}

function formatarPreco(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function CatalogListClient({ canManage }: Props) {
  const [products, setProducts] = useState<CatalogProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState<"todos" | "ativos" | "inativos">("todos");

  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProductRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [productToDelete, setProductToDelete] = useState<CatalogProductRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let active = true;

    async function carregar() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("busca", search);
        if (filtroAtivo === "ativos") params.set("ativo", "true");
        if (filtroAtivo === "inativos") params.set("ativo", "false");

        const res = await fetch(`/api/v1/products?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error?.message || "Erro ao carregar catálogo.");
        }
        if (active) setProducts(json.data ?? []);
      } catch (err) {
        if (active) {
          toast.error(err instanceof Error ? err.message : "Erro ao carregar catálogo.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void carregar();

    return () => {
      active = false;
    };
  }, [search, filtroAtivo, refreshTrigger]);

  const recarregar = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  async function handleToggleAtivo(product: CatalogProductRow) {
    if (!canManage) return;
    const novoStatus = !product.ativo;

    // Atualização otimista
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, ativo: novoStatus } : p)),
    );

    try {
      const res = await fetch(`/api/v1/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: novoStatus }),
      });

      if (!res.ok) {
        throw new Error("Falha ao atualizar status.");
      }
      toast.success(
        novoStatus
          ? `Produto "${product.nome}" ativado.`
          : `Produto "${product.nome}" desativado.`,
      );
    } catch {
      // Reverte em caso de erro
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, ativo: product.ativo } : p)),
      );
      toast.error("Não foi possível alterar o status do produto.");
    }
  }

  async function handleDeleteConfirm() {
    if (!productToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/products/${productToDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error?.message || "Erro ao excluir produto.");
      }
      toast.success(`Produto "${productToDelete.nome}" excluído.`);
      setProductToDelete(null);
      recarregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir produto.");
    } finally {
      setDeleting(false);
    }
  }

  const produtosFiltrados = useMemo(() => {
    return products;
  }, [products]);

  return (
    <div className="space-y-4 p-6">
      {/* Cabeçalho */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Catálogo de Produtos</h1>
          <p className="text-sm text-muted-foreground">
            Itens, serviços e tabelas de preço consultados pelas ferramentas do Agente de IA.
          </p>
        </div>

        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              className="gap-1.5"
            >
              <UploadSimple size={16} weight="bold" />
              <span>Importar Planilha</span>
            </Button>
            <Button
              onClick={() => {
                setEditingProduct(null);
                setFormOpen(true);
              }}
              className="gap-1.5"
            >
              <Plus size={16} weight="bold" />
              <span>Novo Produto</span>
            </Button>
          </div>
        )}
      </header>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-2">
        <div className="relative w-full sm:w-80">
          <MagnifyingGlass
            size={16}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Buscar por código, nome, marca..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full pl-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setFiltroAtivo("todos")}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                filtroAtivo === "todos"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setFiltroAtivo("ativos")}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                filtroAtivo === "ativos"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Ativos
            </button>
            <button
              type="button"
              onClick={() => setFiltroAtivo("inativos")}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                filtroAtivo === "inativos"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Inativos
            </button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => recarregar()}
            title="Atualizar lista"
            className="h-9 w-9"
          >
            <ArrowsClockwise size={16} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* Lista / Tabela */}
      <Card className="overflow-hidden border border-border">
        {loading && products.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : produtosFiltrados.length === 0 ? (
          <EmptyState
            icon={Tag}
            headline={
              search || filtroAtivo !== "todos"
                ? "Nenhum produto encontrado"
                : "Seu catálogo está vazio"
            }
            subcopy={
              search || filtroAtivo !== "todos"
                ? "Tente ajustar os filtros ou o termo de busca."
                : "Cadastre seu primeiro produto ou importe uma planilha CSV para o agente consultar."
            }
            primary={
              canManage && !search && filtroAtivo === "todos"
                ? {
                    label: "Cadastrar Produto",
                    onClick: () => {
                      setEditingProduct(null);
                      setFormOpen(true);
                    },
                  }
                : undefined
            }
            secondary={
              canManage && !search && filtroAtivo === "todos"
                ? {
                    label: "Importar Planilha",
                    onClick: () => setImportOpen(true),
                  }
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Código / SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-36">Marca / Categoria</TableHead>
                  <TableHead className="w-32 text-right">Preço</TableHead>
                  <TableHead className="w-32 text-center">Estoque</TableHead>
                  <TableHead className="w-24 text-center">Status</TableHead>
                  {canManage && <TableHead className="w-16 text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtosFiltrados.map((prod) => (
                  <TableRow key={prod.id} className={!prod.ativo ? "opacity-60" : ""}>
                    {/* Código / SKU */}
                    <TableCell className="font-mono text-xs font-semibold">
                      {prod.codigo}
                    </TableCell>

                    {/* Produto / Nome & Imagem */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {prod.imagem_url ? (
                          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded border border-border bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={prod.imagem_url}
                              alt={prod.nome}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          </div>
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-muted/60 text-muted-foreground">
                            <Tag size={16} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate max-w-xs sm:max-w-md">
                            {prod.nome}
                          </p>
                          {prod.descricao && (
                            <p className="text-xs text-muted-foreground truncate max-w-xs sm:max-w-md">
                              {prod.descricao}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    {/* Marca & Categoria */}
                    <TableCell>
                      <div className="flex flex-col gap-1 text-xs">
                        {prod.marca && (
                          <span className="font-medium text-foreground/90">{prod.marca}</span>
                        )}
                        {prod.categoria && (
                          <Badge variant="outline" className="w-fit text-[10px] px-1.5 py-0">
                            {prod.categoria}
                          </Badge>
                        )}
                        {!prod.marca && !prod.categoria && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Preço de Venda e Custo */}
                    <TableCell className="text-right">
                      <p className="font-semibold text-sm">
                        {formatarPreco(prod.preco_cents)}
                      </p>
                      {prod.custo_cents !== null && prod.custo_cents !== undefined && (
                        <p className="text-[11px] text-muted-foreground">
                          Custo: {formatarPreco(prod.custo_cents)}
                        </p>
                      )}
                    </TableCell>

                    {/* Estoque */}
                    <TableCell className="text-center">
                      {prod.controla_estoque ? (
                        <Badge
                          variant={prod.quantidade > 0 ? "secondary" : "destructive"}
                          className="font-mono text-xs"
                        >
                          {prod.quantidade} un
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Sem limite
                        </Badge>
                      )}
                    </TableCell>

                    {/* Status Ativo / Inativo */}
                    <TableCell className="text-center">
                      {canManage ? (
                        <div className="flex justify-center">
                          <Switch
                            checked={prod.ativo}
                            onCheckedChange={() => handleToggleAtivo(prod)}
                            title={prod.ativo ? "Clique para desativar" : "Clique para ativar"}
                          />
                        </div>
                      ) : (
                        <Badge variant={prod.ativo ? "default" : "secondary"}>
                          {prod.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      )}
                    </TableCell>

                    {/* Ações */}
                    {canManage && (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <DotsThree size={18} weight="bold" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingProduct(prod);
                                setFormOpen(true);
                              }}
                              className="gap-2 cursor-pointer"
                            >
                              <PencilSimple size={15} />
                              <span>Editar</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleToggleAtivo(prod)}
                              className="gap-2 cursor-pointer"
                            >
                              <Switch className="scale-75 pointer-events-none" checked={prod.ativo} />
                              <span>{prod.ativo ? "Desativar" : "Ativar"}</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setProductToDelete(prod)}
                              className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                            >
                              <Trash size={15} />
                              <span>Excluir</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Diálogo de Cadastro / Edição */}
      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        productToEdit={editingProduct}
        onSuccess={recarregar}
      />

      {/* Diálogo de Importação de Planilha */}
      <ImportProductsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={recarregar}
      />

      {/* Confirmação de Exclusão */}
      <AlertDialog
        open={Boolean(productToDelete)}
        onOpenChange={(open) => !open && setProductToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto do catálogo?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o produto{" "}
              <strong>&ldquo;{productToDelete?.nome}&rdquo;</strong> (Código:{" "}
              <code>{productToDelete?.codigo}</code>)? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirm();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo…" : "Excluir Produto"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
