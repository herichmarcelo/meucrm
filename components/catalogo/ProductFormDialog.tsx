"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ImageIcon } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { precoParaCentavos, type CatalogProductRow } from "@/lib/schemas/produtos";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEdit?: CatalogProductRow | null;
  onSuccess: () => void;
}

function formatarCentavosParaReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

interface InnerFormProps {
  productToEdit?: CatalogProductRow | null;
  onClose: () => void;
  onSuccess: () => void;
}

function ProductFormInner({ productToEdit, onClose, onSuccess }: InnerFormProps) {
  const isEditing = Boolean(productToEdit);

  const [codigo, setCodigo] = useState(productToEdit?.codigo ?? "");
  const [nome, setNome] = useState(productToEdit?.nome ?? "");
  const [descricao, setDescricao] = useState(productToEdit?.descricao ?? "");
  const [marca, setMarca] = useState(productToEdit?.marca ?? "");
  const [categoria, setCategoria] = useState(productToEdit?.categoria ?? "");
  const [precoInput, setPrecoInput] = useState(
    productToEdit ? (productToEdit.preco_cents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [custoInput, setCustoInput] = useState(
    productToEdit?.custo_cents !== null && productToEdit?.custo_cents !== undefined
      ? (productToEdit.custo_cents / 100).toFixed(2).replace(".", ",")
      : "",
  );
  const [controlaEstoque, setControlaEstoque] = useState(
    productToEdit?.controla_estoque ?? true,
  );
  const [quantidade, setQuantidade] = useState(
    productToEdit ? String(productToEdit.quantidade) : "0",
  );
  const [ativo, setAtivo] = useState(productToEdit?.ativo ?? true);
  const [imagemUrl, setImagemUrl] = useState(productToEdit?.imagem_url ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [codigoErro, setCodigoErro] = useState<string | null>(null);

  // Preview formatado em R$
  const precoCentavos = precoInput.trim() ? precoParaCentavos(precoInput) : null;
  const custoCentavos = custoInput.trim() ? precoParaCentavos(custoInput) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCodigoErro(null);

    if (!codigo.trim()) {
      setCodigoErro("Código (SKU) é obrigatório.");
      return;
    }
    if (!nome.trim() || nome.trim().length < 2) {
      toast.error("O nome do produto deve ter pelo menos 2 caracteres.");
      return;
    }
    if (precoCentavos === null || precoCentavos < 0) {
      toast.error("Informe um preço de venda válido (ex: 99,90 ou 1500).");
      return;
    }
    if (custoInput.trim() && (custoCentavos === null || custoCentavos < 0)) {
      toast.error("Informe um preço de custo válido ou deixe o campo vazio.");
      return;
    }

    const qtdNum = controlaEstoque ? parseInt(quantidade, 10) : 0;
    if (controlaEstoque && (isNaN(qtdNum) || qtdNum < 0)) {
      toast.error("Informe uma quantidade de estoque válida (não negativa).");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        codigo: codigo.trim(),
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        marca: marca.trim() || null,
        categoria: categoria.trim() || null,
        preco_cents: precoCentavos,
        custo_cents: custoCentavos,
        controla_estoque: controlaEstoque,
        quantidade: qtdNum,
        ativo,
        imagem_url: imagemUrl.trim() || null,
      };

      const url = isEditing
        ? `/api/v1/products/${productToEdit?.id}`
        : `/api/v1/products`;
      const method = isEditing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 409 || data.error?.code === "conflict") {
          setCodigoErro("Já existe um produto com este código nesta organização.");
          toast.error("Código (SKU) já cadastrado.");
          return;
        }
        throw new Error(data.error?.message || "Erro ao salvar produto.");
      }

      toast.success(
        isEditing
          ? "Produto atualizado com sucesso!"
          : "Produto cadastrado com sucesso!",
      );
      onClose();
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar produto.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Código / SKU */}
        <div className="space-y-1.5">
          <Label htmlFor="prod-codigo">
            Código / SKU <span className="text-destructive">*</span>
          </Label>
          <Input
            id="prod-codigo"
            placeholder="Ex: IP15-128-PRT"
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              if (codigoErro) setCodigoErro(null);
            }}
            className={codigoErro ? "border-destructive focus-visible:ring-destructive" : ""}
            required
          />
          {codigoErro && (
            <p className="text-xs font-medium text-destructive">{codigoErro}</p>
          )}
        </div>

        {/* Nome */}
        <div className="space-y-1.5">
          <Label htmlFor="prod-nome">
            Nome do Produto <span className="text-destructive">*</span>
          </Label>
          <Input
            id="prod-nome"
            placeholder="Ex: Apple iPhone 15 128GB Preto"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Marca */}
        <div className="space-y-1.5">
          <Label htmlFor="prod-marca">Marca / Fabricante</Label>
          <Input
            id="prod-marca"
            placeholder="Ex: Apple, Samsung, JBL"
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
          />
        </div>

        {/* Categoria */}
        <div className="space-y-1.5">
          <Label htmlFor="prod-categoria">Categoria / Departamento</Label>
          <Input
            id="prod-categoria"
            placeholder="Ex: Smartphones, Áudio, Serviços"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          />
        </div>
      </div>

      {/* Descrição */}
      <div className="space-y-1.5">
        <Label htmlFor="prod-desc">Descrição / Detalhes</Label>
        <Textarea
          id="prod-desc"
          placeholder="Detalhes, especificações técnicas ou informações complementares consultadas pelo agente..."
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={2}
        />
      </div>

      {/* Preços e Custo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="prod-preco">
              Preço de Venda <span className="text-destructive">*</span>
            </Label>
            {precoCentavos !== null && (
              <span className="text-xs font-semibold text-primary">
                {formatarCentavosParaReais(precoCentavos)}
              </span>
            )}
          </div>
          <Input
            id="prod-preco"
            placeholder="Ex: 5499,00 ou 5.499,00"
            value={precoInput}
            onChange={(e) => setPrecoInput(e.target.value)}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            Digite o valor em reais (ex: 120,50 ou R$ 1.500,00).
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="prod-custo">Preço de Custo (Opcional)</Label>
            {custoCentavos !== null && (
              <span className="text-xs font-semibold text-muted-foreground">
                {formatarCentavosParaReais(custoCentavos)}
              </span>
            )}
          </div>
          <Input
            id="prod-custo"
            placeholder="Ex: 4200,00"
            value={custoInput}
            onChange={(e) => setCustoInput(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Usado como piso para políticas de desconto do agente.
          </p>
        </div>
      </div>

      {/* Controle de Estoque e Quantidade */}
      <div className="rounded-lg border border-border bg-surface/50 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="prod-controla-estoque" className="font-medium">
              Controlar Estoque
            </Label>
            <p className="text-xs text-muted-foreground">
              Se desativado, o produto sempre estará disponível para o agente (ideal para serviços).
            </p>
          </div>
          <Switch
            id="prod-controla-estoque"
            checked={controlaEstoque}
            onCheckedChange={setControlaEstoque}
          />
        </div>

        {controlaEstoque && (
          <div className="space-y-1.5 pt-2 border-t border-border">
            <Label htmlFor="prod-quantidade">Quantidade em Estoque</Label>
            <Input
              id="prod-quantidade"
              type="number"
              min="0"
              step="1"
              placeholder="0"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className="w-48"
              required={controlaEstoque}
            />
          </div>
        )}
      </div>

      {/* URL da Imagem */}
      <div className="space-y-1.5">
        <Label htmlFor="prod-imagem">URL da Imagem (Opcional)</Label>
        <div className="flex gap-2">
          <Input
            id="prod-imagem"
            type="url"
            placeholder="https://exemplo.com/imagem.jpg"
            value={imagemUrl}
            onChange={(e) => setImagemUrl(e.target.value)}
            className="flex-1"
          />
          {imagemUrl ? (
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded border border-border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagemUrl}
                alt="Preview"
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-muted text-muted-foreground">
              <ImageIcon size={16} />
            </div>
          )}
        </div>
      </div>

      {/* Status Ativo */}
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="prod-ativo" className="font-medium">
            Produto Ativo
          </Label>
          <p className="text-xs text-muted-foreground">
            Produtos inativos não aparecem nas buscas e respostas do agente de IA.
          </p>
        </div>
        <Switch id="prod-ativo" checked={ativo} onCheckedChange={setAtivo} />
      </div>

      <DialogFooter className="pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? "Salvando…"
            : isEditing
            ? "Atualizar Produto"
            : "Cadastrar Produto"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProductFormDialog({
  open,
  onOpenChange,
  productToEdit,
  onSuccess,
}: Props) {
  const isEditing = Boolean(productToEdit);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar Produto" : "Novo Produto no Catálogo"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Altere os dados do produto. As alterações refletem imediatamente nas consultas do agente de IA."
              : "Cadastre um produto no catálogo da organização com preço seguro em centavos e controle de estoque."}
          </DialogDescription>
        </DialogHeader>

        {open && (
          <ProductFormInner
            key={productToEdit?.id ?? "novo"}
            productToEdit={productToEdit}
            onClose={() => onOpenChange(false)}
            onSuccess={onSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
