"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ServiceTypeRow } from "./ServiceTypeFormDialog";

export interface AppointmentRow {
  id: string;
  organization_id: string;
  contact_id: string;
  lead_id: string | null;
  service_type_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: "pending" | "confirmed" | "attended" | "no_show" | "canceled";
  notes: string | null;
  created_by_kind: string;
  created_at: string;
  updated_at: string;
  contacts?: {
    id: string;
    display_name: string | null;
    phone_number: string | null;
    email: string | null;
  } | null;
  service_types?: {
    id: string;
    name: string;
    duration_minutes: number;
    price_cents: number;
  } | null;
}

interface ContactOption {
  id: string;
  display_name: string | null;
  phone_number: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentRow | null;
  defaultContactId?: string | null;
  onSaved: () => void;
}

export function AppointmentFormDialog({
  open,
  onOpenChange,
  appointment,
  defaultContactId,
  onSaved,
}: Props) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeRow[]>([]);
  const [contactId, setContactId] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState<string>("none");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [status, setStatus] = useState<"pending" | "confirmed" | "attended" | "no_show" | "canceled">("pending");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Carrega opções de serviços e contatos
  useEffect(() => {
    if (!open) return;

    fetch("/api/v1/service-types?active=true")
      .then((r) => r.json())
      .then((d) => setServiceTypes(d.data?.service_types || []))
      .catch(() => {});

    fetch("/api/v1/contacts?limit=50")
      .then((r) => r.json())
      .then((d) => setContacts(d.data?.contacts || []))
      .catch(() => {});
  }, [open]);

  // Preenche valores ao abrir
  useEffect(() => {
    if (appointment) {
      setContactId(appointment.contact_id);
      setServiceTypeId(appointment.service_type_id || "none");
      const d = new Date(appointment.scheduled_at);
      const isoDate = d.toISOString().split("T")[0] || "";
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      setScheduledDate(isoDate);
      setScheduledTime(`${hours}:${minutes}`);
      setDurationMinutes(appointment.duration_minutes || 30);
      setStatus(appointment.status);
      setNotes(appointment.notes || "");
    } else {
      setContactId(defaultContactId || "");
      setServiceTypeId("none");
      const amanhã = new Date();
      amanhã.setDate(amanhã.getDate() + 1);
      setScheduledDate(amanhã.toISOString().split("T")[0] || "");
      setScheduledTime("09:00");
      setDurationMinutes(30);
      setStatus("pending");
      setNotes("");
    }
  }, [appointment, defaultContactId, open]);

  // Quando troca o serviço, ajusta duração automaticamente se for novo
  function handleServiceChange(id: string) {
    setServiceTypeId(id);
    if (id !== "none") {
      const s = serviceTypes.find((item) => item.id === id);
      if (s?.duration_minutes) {
        setDurationMinutes(s.duration_minutes);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactId) {
      toast.error("Selecione o contato.");
      return;
    }
    if (!scheduledDate || !scheduledTime) {
      toast.error("Informe a data e o horário do agendamento.");
      return;
    }

    const scheduledIso = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();

    setSaving(true);
    try {
      const url = appointment
        ? `/api/v1/appointments/${appointment.id}`
        : `/api/v1/appointments`;

      const method = appointment ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contactId,
          service_type_id: serviceTypeId === "none" ? null : serviceTypeId,
          scheduled_at: scheduledIso,
          duration_minutes: Number(durationMinutes) || 30,
          status,
          notes: notes.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Erro ao salvar agendamento.");
      }

      if (json.data?.funil_atualizado) {
        toast.success(`Agendamento salvo! Lead movido automaticamente para a etapa "${json.data.etapa_destino}".`);
      } else {
        toast.success(appointment ? "Agendamento atualizado com sucesso!" : "Agendamento criado com sucesso!");
      }

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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{appointment ? "Editar Agendamento" : "Novo Agendamento"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Contato */}
          <div className="space-y-1.5">
            <Label htmlFor="contact">Contato / Cliente *</Label>
            {appointment && appointment.contacts ? (
              <Input
                disabled
                value={appointment.contacts.display_name || appointment.contacts.phone_number || appointment.contact_id}
              />
            ) : (
              <Select value={contactId} onValueChange={setContactId} required>
                <SelectTrigger id="contact">
                  <SelectValue placeholder="Selecione um contato..." />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.display_name || c.phone_number || c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Tipo de Atendimento */}
          <div className="space-y-1.5">
            <Label htmlFor="service-type">Tipo de Atendimento / Procedimento</Label>
            <Select value={serviceTypeId} onValueChange={handleServiceChange}>
              <SelectTrigger id="service-type">
                <SelectValue placeholder="Selecione um serviço (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum serviço específico</SelectItem>
                {serviceTypes.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.duration_minutes} min — R$ {(s.price_cents / 100).toFixed(2).replace(".", ",")})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Data e Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">Data *</Label>
              <Input
                id="date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time">Horário *</Label>
              <Input
                id="time"
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Duração e Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dur">Duração (minutos)</Label>
              <Input
                id="dur"
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
              <Label htmlFor="status">Situação / Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Solicitado / Pendente</SelectItem>
                  <SelectItem value="confirmed">Confirmado</SelectItem>
                  <SelectItem value="attended">Compareceu / Realizado</SelectItem>
                  <SelectItem value="no_show">Faltou (No-show)</SelectItem>
                  <SelectItem value="canceled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Observações */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Observações / Motivo</Label>
            <Textarea
              id="notes"
              rows={3}
              placeholder="Queixa principal, informações passadas pelo cliente ou notas de preparação..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : appointment ? "Salvar Alterações" : "Confirmar Agendamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
