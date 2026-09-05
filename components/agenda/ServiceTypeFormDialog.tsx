"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export interface ServiceTypeRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceType: ServiceTypeRow | null;
  onSaved: () => void;
}

export function ServiceTypeFormDialog({ open, onOpenChange, serviceType, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [precoInput, setPrecoInput] = useState("0,00");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (serviceType) {
      setName(serviceType.name);
      setDescription(serviceType.description || "");
      setDurationMinutes(serviceType.duration_minutes || 30);
      setPrecoInput((serviceType.price_cents / 100).toFixed(2).replace(".", ","));
      setActive(serviceType.active);
    } else {
      setName("");
      setDescription("");
      setDurationMinutes(30);
      setPrecoInput("0,00");
      setActive(true);
    }
  }, [serviceType, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("O nome do serviço é obrigatório.");
      return;
    }

    const precoNumber = parseFloat(precoInput.replace(/\./g, "").replace(",", ".")) || 0;
    const priceCents = Math.round(precoNumber * 100);

    setSaving(true);
    try {
      const url = serviceType
        ? `/api/v1/service-types/${serviceType.id}`
        : `/api/v1/service-types`;

      const method = serviceType ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          duration_minutes: Number(durationMinutes) || 30,
          price_cents: priceCents,
          active,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Erro ao salvar tipo de atendimento.");
      }

      toast.success(serviceType ? "Serviço atualizado com sucesso!" : "Serviço criado com sucesso!");
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{serviceType ? "Editar Serviço / Atendimento" : "Novo Tipo de Atendimento"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="service-name">Nome do Serviço / Consulta *</Label>
            <Input
              id="service-name"
              placeholder="Ex: Consulta Odontológica, Avaliação, Corte de Cabelo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="duration">Duração (minutos)</Label>
              <Input
                id="duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price">Valor (R$)</Label>
              <Input
                id="price"
                placeholder="0,00"
                value={precoInput}
                onChange={(e) => setPrecoInput(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="service-desc">Descrição (visível para o atendente e a IA)</Label>
            <Textarea
              id="service-desc"
              rows={3}
              placeholder="Descreva detalhes ou instruções sobre este atendimento..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Serviço Ativo</Label>
              <p className="text-xs text-muted-foreground">Disponível para agendamento manual e pelo agente de IA.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : serviceType ? "Salvar Alterações" : "Criar Serviço"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
