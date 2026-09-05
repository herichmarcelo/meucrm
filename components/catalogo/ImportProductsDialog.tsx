"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { DownloadSimple, UploadSimple } from "@/lib/ui/icons";
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
import { parseCsv } from "@/lib/catalogo/csv";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface LinhaErro {
  linha: number;
  motivo: string;
}

interface ImportSummary {
  total_linhas: number;
  criados: number;
  atualizados: number;
  erros: LinhaErro[];
}

export function ImportProductsDialog({ open, onOpenChange, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [importing, setImporting] = useState(false);
  const [resumo, setResumo] = useState<ImportSummary | null>(null);

  function reset() {
    setFile(null);
    setPreviewRows([]);
    setResumo(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFileChange(selectedFile: File | null) {
    setFile(selectedFile);
    setResumo(null);
    if (!selectedFile) {
      setPreviewRows([]);
      return;
    }

    try {
      const text = await selectedFile.text();
      const rows = parseCsv(text);
      setPreviewRows(rows.slice(0, 6)); // Cabeçalho + até 5 linhas
    } catch {
      setPreviewRows([]);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file || importing) return;

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/v1/products/import", {
        method: "POST",
        body: formData,
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error?.message || "Falha ao importar planilha.");
      }

      const summary: ImportSummary = json.data;
      setResumo(summary);

      if (summary.criados > 0 || summary.atualizados > 0) {
        toast.success(
          `${summary.criados} produto(s) criado(s), ${summary.atualizados} atualizado(s).`,
        );
        onSuccess();
      }
      if (summary.erros.length > 0) {
        toast.warning(`${summary.erros.length} linha(s) continham erros e foram puladas.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar planilha.");
    } finally {
      setImporting(false);
    }
  }

  function handleDownloadTemplate() {
    window.open("/api/v1/products/template", "_blank");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Catálogo de Produtos</DialogTitle>
          <DialogDescription>
            Envie um arquivo <code>.csv</code> com cabeçalho. Produtos com mesmo código/SKU
            serão atualizados automaticamente, sem duplicação.
          </DialogDescription>
        </DialogHeader>

        {!resumo ? (
          <form onSubmit={handleImport} className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Modelo de Planilha</p>
                <p className="text-xs text-muted-foreground">
                  Baixe o modelo com as colunas esperadas (código, nome, preço, etc).
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="gap-1.5"
              >
                <DownloadSimple size={15} />
                <span>Baixar Modelo</span>
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="csv-product-file">Arquivo CSV</Label>
              <Input
                id="csv-product-file"
                ref={inputRef}
                type="file"
                accept=".csv,text/csv,application/vnd.ms-excel"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="text-xs text-muted-foreground">
                  {file.name} · {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>

            {/* Preview das primeiras linhas */}
            {previewRows.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Prévia das primeiras linhas do arquivo:
                </p>
                <div className="max-h-48 overflow-x-auto rounded border border-border bg-surface/30 text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 font-medium">
                        {previewRows[0]?.map((col, idx) => (
                          <th key={idx} className="p-2 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(1).map((row, rIdx) => (
                        <tr key={rIdx} className="border-b border-border/50">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="p-2 whitespace-nowrap text-muted-foreground">
                              {cell || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={importing}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!file || importing} className="gap-2">
                <UploadSimple size={16} />
                <span>{importing ? "Processando…" : "Confirmar Importação"}</span>
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-muted-foreground">Total Lido</p>
                <p className="text-lg font-bold">{resumo.total_linhas}</p>
              </div>
              <div className="rounded-lg border border-border bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400">
                <p className="text-xs">Criados</p>
                <p className="text-lg font-bold">{resumo.criados}</p>
              </div>
              <div className="rounded-lg border border-border bg-blue-500/10 p-3 text-blue-600 dark:text-blue-400">
                <p className="text-xs">Atualizados</p>
                <p className="text-lg font-bold">{resumo.atualizados}</p>
              </div>
              <div className="rounded-lg border border-border bg-destructive/10 p-3 text-destructive">
                <p className="text-xs">Rejeitados</p>
                <p className="text-lg font-bold">{resumo.erros.length}</p>
              </div>
            </div>

            {resumo.erros.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-destructive font-medium">
                  Linhas que não puderam ser importadas:
                </Label>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
                  {resumo.erros.map((err, idx) => (
                    <p key={idx}>
                      <span className="font-semibold">Linha {err.linha}:</span> {err.motivo}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={reset}>
                Importar Outro Arquivo
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Concluir
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
