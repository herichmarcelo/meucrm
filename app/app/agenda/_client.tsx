"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Calendar,
  Check,
  Checks,
  Clock,
  DotsThree,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UserCircle,
  X,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/empty/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AppointmentFormDialog,
  type AppointmentRow,
} from "@/components/agenda/AppointmentFormDialog";
import {
  ServiceTypeFormDialog,
  type ServiceTypeRow,
} from "@/components/agenda/ServiceTypeFormDialog";

interface Props {
  canManage: boolean;
}

const STATUS_BADGES: Record<
  AppointmentRow["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pendente", variant: "secondary" },
  confirmed: { label: "Confirmado", variant: "default" },
  attended: { label: "Compareceu", variant: "outline" },
  no_show: { label: "Faltou", variant: "destructive" },
  canceled: { label: "Cancelado", variant: "outline" },
};

function formatarDataHora(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

export function AgendaClient({ canManage }: Props) {
  const [activeTab, setActiveTab] = useState<"appointments" | "services">("appointments");

  // State: Appointments
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [appointmentFormOpen, setAppointmentFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentRow | null>(null);
  const [appointmentToCancel, setAppointmentToCancel] = useState<AppointmentRow | null>(null);

  // State: Service Types
  const [services, setServices] = useState<ServiceTypeRow[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [serviceFormOpen, setServiceFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceTypeRow | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<ServiceTypeRow | null>(null);

  const fetchAppointments = useCallback(async () => {
    setLoadingAppointments(true);
    try {
      const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/v1/appointments${qs}`);
      const json = await res.json();
      if (res.ok) {
        setAppointments(json.data?.appointments || []);
      }
    } catch {
      toast.error("Erro ao carregar agendamentos.");
    } finally {
      setLoadingAppointments(false);
    }
  }, [statusFilter]);

  const fetchServices = useCallback(async () => {
    setLoadingServices(true);
    try {
      const res = await fetch("/api/v1/service-types");
      const json = await res.json();
      if (res.ok) {
        setServices(json.data?.service_types || []);
      }
    } catch {
      toast.error("Erro ao carregar tipos de atendimento.");
    } finally {
      setLoadingServices(false);
    }
  }, []);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  useEffect(() => {
    if (activeTab === "services") {
      fetchServices();
    }
  }, [activeTab, fetchServices]);

  async function handleQuickStatusChange(
    appointmentId: string,
    newStatus: AppointmentRow["status"],
  ) {
    try {
      const res = await fetch(`/api/v1/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || "Erro ao atualizar status.");
      }
      if (json.data?.funil_atualizado) {
        toast.success(`Status atualizado! Lead movido no funil para "${json.data.etapa_destino}".`);
      } else {
        toast.success("Status atualizado!");
      }
      fetchAppointments();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar.");
    }
  }

  async function handleCancelAppointment() {
    if (!appointmentToCancel) return;
    try {
      const res = await fetch(`/api/v1/appointments/${appointmentToCancel.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Erro ao cancelar.");
      }
      toast.success("Agendamento cancelado com sucesso.");
      setAppointmentToCancel(null);
      fetchAppointments();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar.");
    }
  }

  async function handleDeleteService() {
    if (!serviceToDelete) return;
    try {
      const res = await fetch(`/api/v1/service-types/${serviceToDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || "Erro ao excluir serviço.");
      }
      toast.success("Serviço excluído com sucesso.");
      setServiceToDelete(null);
      fetchServices();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agenda & Atendimentos</h1>
          <p className="text-sm text-muted-foreground">
            Gestão de consultas, agendamentos marcados pela IA e tipos de atendimento integrados ao CRM.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === "appointments" ? (
            <Button
              onClick={() => {
                setEditingAppointment(null);
                setAppointmentFormOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Novo Agendamento
            </Button>
          ) : (
            canManage && (
              <Button
                onClick={() => {
                  setEditingService(null);
                  setServiceFormOpen(true);
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Novo Serviço
              </Button>
            )
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="appointments" className="gap-2">
            <Calendar className="h-4 w-4" />
            Agendamentos
          </TabsTrigger>
          <TabsTrigger value="services" className="gap-2">
            <Clock className="h-4 w-4" />
            Tipos de Atendimento
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: AGENDAMENTOS */}
        <TabsContent value="appointments" className="space-y-4 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: "all", label: "Todos" },
              { id: "pending", label: "Pendentes" },
              { id: "confirmed", label: "Confirmados" },
              { id: "attended", label: "Compareceram" },
              { id: "no_show", label: "Faltas" },
              { id: "canceled", label: "Cancelados" },
            ].map((f) => (
              <Button
                key={f.id}
                size="sm"
                variant={statusFilter === f.id ? "default" : "outline"}
                onClick={() => setStatusFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <Card>
            {loadingAppointments ? (
              <div className="space-y-3 p-6">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : appointments.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Calendar}
                  headline="Nenhum agendamento encontrado"
                  subcopy="Agendamentos marcados manualmente ou pelo agente de IA na conversa aparecerão aqui."
                  primary={{
                    label: "Criar Primeiro Agendamento",
                    onClick: () => {
                      setEditingAppointment(null);
                      setAppointmentFormOpen(true);
                    },
                  }}
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data & Hora</TableHead>
                    <TableHead>Cliente / Contato</TableHead>
                    <TableHead>Serviço</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[80px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appointments.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell className="font-medium">
                        {formatarDataHora(app.scheduled_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {app.contacts?.display_name || "Contato"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {app.contacts?.phone_number || app.contacts?.email || "Sem telefone"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {app.service_types ? (
                          <Badge variant="outline">{app.service_types.name}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{app.duration_minutes} min</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[11px]">
                          {app.created_by_kind === "agent" ? "🤖 Agente IA" : "👤 Operador"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGES[app.status]?.variant || "secondary"}>
                          {STATUS_BADGES[app.status]?.label || app.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <DotsThree className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {app.status === "pending" && (
                              <DropdownMenuItem onClick={() => handleQuickStatusChange(app.id, "confirmed")}>
                                <Check className="mr-2 h-4 w-4 text-emerald-600" />
                                Confirmar
                              </DropdownMenuItem>
                            )}
                            {app.status !== "attended" && app.status !== "canceled" && (
                              <DropdownMenuItem onClick={() => handleQuickStatusChange(app.id, "attended")}>
                                <Checks className="mr-2 h-4 w-4 text-blue-600" />
                                Marcar Compareceu
                              </DropdownMenuItem>
                            )}
                            {app.status !== "no_show" && app.status !== "canceled" && (
                              <DropdownMenuItem onClick={() => handleQuickStatusChange(app.id, "no_show")}>
                                <X className="mr-2 h-4 w-4 text-rose-600" />
                                Marcar Falta (No-show)
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingAppointment(app);
                                setAppointmentFormOpen(true);
                              }}
                            >
                              <PencilSimple className="mr-2 h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setAppointmentToCancel(app)}
                            >
                              <Trash className="mr-2 h-4 w-4" />
                              Cancelar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* TAB 2: TIPOS DE ATENDIMENTO */}
        <TabsContent value="services" className="space-y-4 pt-2">
          <Card>
            {loadingServices ? (
              <div className="space-y-3 p-6">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : services.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Clock}
                  headline="Nenhum tipo de atendimento cadastrado"
                  subcopy="Cadastre os serviços e procedimentos oferecidos para o agente de IA e atendentes agendarem com duração e preços pré-definidos."
                  primary={
                    canManage
                      ? {
                          label: "Criar Primeiro Serviço",
                          onClick: () => {
                            setEditingService(null);
                            setServiceFormOpen(true);
                          },
                        }
                      : undefined
                  }
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome do Serviço</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead className="w-[80px] text-right">Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.duration_minutes} min</TableCell>
                      <TableCell>
                        R$ {(s.price_cents / 100).toFixed(2).replace(".", ",")}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-muted-foreground">
                        {s.description || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.active ? "default" : "secondary"}>
                          {s.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <DotsThree className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingService(s);
                                  setServiceFormOpen(true);
                                }}
                              >
                                <PencilSimple className="mr-2 h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setServiceToDelete(s)}
                              >
                                <Trash className="mr-2 h-4 w-4" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modais */}
      <AppointmentFormDialog
        open={appointmentFormOpen}
        onOpenChange={setAppointmentFormOpen}
        appointment={editingAppointment}
        onSaved={fetchAppointments}
      />

      <ServiceTypeFormDialog
        open={serviceFormOpen}
        onOpenChange={setServiceFormOpen}
        serviceType={editingService}
        onSaved={fetchServices}
      />

      <ConfirmDialog
        open={!!appointmentToCancel}
        onOpenChange={(open) => !open && setAppointmentToCancel(null)}
        title="Cancelar Agendamento"
        description="Tem certeza que deseja cancelar este agendamento? Esta ação será registrada no histórico."
        confirmLabel="Sim, Cancelar"
        cancelLabel="Voltar"
        variant="destructive"
        onConfirm={handleCancelAppointment}
      />

      <ConfirmDialog
        open={!!serviceToDelete}
        onOpenChange={(open) => !open && setServiceToDelete(null)}
        title="Excluir Tipo de Atendimento"
        description={`Tem certeza que deseja excluir o serviço "${serviceToDelete?.name}"?`}
        confirmLabel="Excluir"
        cancelLabel="Voltar"
        variant="destructive"
        onConfirm={handleDeleteService}
      />
    </div>
  );
}
