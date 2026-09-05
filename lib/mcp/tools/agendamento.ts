/**
 * Capacidades de AGENDAMENTO DE CONSULTAS E SERVIÇOS — IA marca atendimentos via conversa.
 *
 * Garante:
 * - Service role com filtro obrigatório de `organization_id`;
 * - Consulta de tipos de serviço disponíveis;
 * - Cálculo de horários livres em formato natural conciso (poucas opções por vez);
 * - Agendamento e atualização de status com validação de horários futuros;
 * - Sincronização automática com as etapas do funil de vendas.
 */
import { z } from "zod";
import type { McpToolDefinition } from "../types";
import { syncAppointmentStage } from "@/lib/appointments/pipeline-sync";

// ---------------------------------------------------------------------------
// 1. Listar serviços / tipos de atendimento
// ---------------------------------------------------------------------------

const listServicesInputShape = {
  somente_ativos: z.boolean().optional().default(true),
};

export const crmListServices: McpToolDefinition<typeof listServicesInputShape> = {
  name: "crm_list_services",
  description:
    "Lista os tipos de atendimento, procedimentos ou consultas oferecidos pela empresa, " +
    "com nome, duração estimada em minutos e preço (em centavos). Use para informar o cliente " +
    "sobre opções de serviço antes de marcar um horário.",
  inputSchema: listServicesInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("service_types")
      .select("id, name, description, duration_minutes, price_cents, active")
      .eq("organization_id", ctx.organizationId);

    if (input.somente_ativos) {
      query = query.eq("active", true);
    }

    const { data, error } = await query.order("name", { ascending: true });
    if (error) throw new Error(`listar_servicos_falhou: ${error.message}`);

    return {
      servicos: (data ?? []).map((s) => ({
        id: s.id,
        nome: s.name,
        descricao: s.description,
        duracao_minutos: s.duration_minutes,
        preco_cents: s.price_cents,
        preco_formatado: `R$ ${(s.price_cents / 100).toFixed(2).replace(".", ",")}`,
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Consultar horários livres em formato legível e conciso
// ---------------------------------------------------------------------------

const listSlotsInputShape = {
  dias_a_frente: z.number().int().min(1).max(14).optional().default(7)
    .describe("Quantos dias à frente verificar horários disponíveis."),
  service_type_id: z.string().uuid().optional()
    .describe("ID do tipo de atendimento para considerar a duração exata."),
  limite_opcoes: z.number().int().min(1).max(10).optional().default(5)
    .describe("Número máximo de horários sugeridos a retornar por vez."),
};

export const crmListAvailableSlots: McpToolDefinition<typeof listSlotsInputShape> = {
  name: "crm_list_available_slots",
  description:
    "Busca horários disponíveis na agenda da empresa para atendimento ou consulta. " +
    "Devolve uma lista concisa e formatada em linguagem natural ('sexta-feira 04/09 às 14:00') " +
    "com poucas opções para não poluir a conversa. Ofereça essas opções ao cliente.",
  inputSchema: listSlotsInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    // 1. Descobre a duração do serviço (padrão 30 min)
    let duracaoMinutos = 30;
    if (input.service_type_id) {
      const { data: servico } = await ctx.supabase
        .from("service_types")
        .select("duration_minutes")
        .eq("organization_id", ctx.organizationId)
        .eq("id", input.service_type_id)
        .maybeSingle();

      if (servico?.duration_minutes) {
        duracaoMinutos = servico.duration_minutes;
      }
    }

    // 2. Busca agendamentos ocupados no período
    const agora = new Date();
    const fimPeriodo = new Date(agora.getTime() + input.dias_a_frente * 24 * 60 * 60 * 1000);

    const { data: ocupados } = await ctx.supabase
      .from("appointments")
      .select("scheduled_at, duration_minutes")
      .eq("organization_id", ctx.organizationId)
      .in("status", ["pending", "confirmed"])
      .gte("scheduled_at", agora.toISOString())
      .lte("scheduled_at", fimPeriodo.toISOString());

    const intervalosOcupados = (ocupados ?? []).map((o) => {
      const inicio = new Date(o.scheduled_at).getTime();
      return {
        inicio,
        fim: inicio + (o.duration_minutes || 30) * 60 * 1000,
      };
    });

    // 3. Gera candidatos de horários (Segunda a Sexta, 08:30 às 17:30, intervalos de 1h ou duração)
    const slotsDisponiveis: Array<{
      texto_legivel: string;
      scheduled_at_iso: string;
      dia_da_semana: string;
    }> = [];

    const diaCursor = new Date(agora);
    // Se já passou das 17h hoje, começa a partir de amanhã
    if (diaCursor.getHours() >= 17) {
      diaCursor.setDate(diaCursor.getDate() + 1);
    }

    const formatterDia = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
    });

    const formatterHora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });

    const horasComerciais = [9, 10, 11, 14, 15, 16];

    for (let d = 0; d < input.dias_a_frente && slotsDisponiveis.length < input.limite_opcoes; d++) {
      const diaAtual = new Date(diaCursor.getTime() + d * 24 * 60 * 60 * 1000);
      const diaSemana = diaAtual.getDay();
      // Pula domingo (0) e sábado à tarde se aplicável
      if (diaSemana === 0 || diaSemana === 6) continue;

      for (const hora of horasComerciais) {
        if (slotsDisponiveis.length >= input.limite_opcoes) break;

        const slotInicio = new Date(diaAtual);
        slotInicio.setHours(hora, 0, 0, 0);

        // Se o horário já passou hoje, pula
        if (slotInicio.getTime() <= agora.getTime() + 60 * 60 * 1000) {
          continue;
        }

        const slotFim = slotInicio.getTime() + duracaoMinutos * 60 * 1000;

        // Verifica colisão com agendamentos existentes
        const colide = intervalosOcupados.some(
          (oc) => Math.max(slotInicio.getTime(), oc.inicio) < Math.min(slotFim, oc.fim),
        );

        if (!colide) {
          const diaFormatado = formatterDia.format(slotInicio);
          const horaFormatada = formatterHora.format(slotInicio);
          slotsDisponiveis.push({
            texto_legivel: `${diaFormatado} às ${horaFormatada}`,
            scheduled_at_iso: slotInicio.toISOString(),
            dia_da_semana: diaFormatado.split(",")[0] || "dia útil",
          });
        }
      }
    }

    return {
      duracao_minutos: duracaoMinutos,
      total_sugestoes: slotsDisponiveis.length,
      horarios_livres: slotsDisponiveis,
      instrucao_ao_agente:
        "Apresente 2 a 3 opções de forma simples e natural ao cliente. " +
        "Quando ele escolher, use a tool crm_book_appointment com o scheduled_at_iso correspondente.",
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Marcar agendamento
// ---------------------------------------------------------------------------

const bookAppointmentInputShape = {
  contact_id: z.string().uuid().describe("ID do contato para quem a consulta/atendimento será marcada."),
  scheduled_at: z.string().describe("Data e hora no formato ISO-8601 (ex: 2026-09-04T14:00:00.000Z)."),
  service_type_id: z.string().uuid().optional().describe("ID do tipo de atendimento selecionado."),
  duration_minutes: z.number().int().min(10).max(480).optional().default(30)
    .describe("Duração prevista em minutos."),
  notes: z.string().optional().describe("Observações ou queixa inicial informada pelo cliente."),
  confirmed: z.boolean().optional().default(false)
    .describe("true se já deve nascer confirmado, ou false para aguardar confirmação."),
};

export const crmBookAppointment: McpToolDefinition<typeof bookAppointmentInputShape> = {
  name: "crm_book_appointment",
  description:
    "Cria um agendamento de consulta ou atendimento para o contato. " +
    "Sincroniza automaticamente a movimentação do lead para as etapas de agendamento no funil do CRM.",
  inputSchema: bookAppointmentInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const dataAgendada = new Date(input.scheduled_at);
    if (Number.isNaN(dataAgendada.getTime())) {
      throw new Error("scheduled_at_invalido: forneça uma data ISO-8601 válida.");
    }

    // 1. Descobre se o contato possui um lead associado
    const { data: lead } = await ctx.supabase
      .from("crm_leads")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", input.contact_id)
      .maybeSingle();

    const statusInicial = input.confirmed ? "confirmed" : "pending";

    // 2. Insere o agendamento
    const { data: appointment, error } = await ctx.supabase
      .from("appointments")
      .insert({
        organization_id: ctx.organizationId,
        contact_id: input.contact_id,
        lead_id: lead?.id ?? null,
        service_type_id: input.service_type_id ?? null,
        scheduled_at: dataAgendada.toISOString(),
        duration_minutes: input.duration_minutes,
        status: statusInicial,
        notes: input.notes ?? null,
        created_by_kind: "agent",
      })
      .select("id, organization_id, contact_id, lead_id, scheduled_at, duration_minutes, status")
      .single();

    if (error || !appointment) {
      throw new Error(`criar_agendamento_falhou: ${error?.message || "erro desconhecido"}`);
    }

    // 3. Sincroniza com o funil do CRM
    const syncResult = await syncAppointmentStage(
      ctx.supabase,
      ctx.organizationId,
      lead?.id ?? null,
      statusInicial,
    );

    const formatter = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      sucesso: true,
      appointment_id: appointment.id,
      status: appointment.status,
      horario_formatado: formatter.format(dataAgendada),
      funil_atualizado: syncResult.moved,
      etapa_destino: syncResult.targetSlug,
      mensagem: `Agendamento registrado com sucesso para ${formatter.format(dataAgendada)}.`,
    };
  },
};

// ---------------------------------------------------------------------------
// 4. Atualizar status do agendamento
// ---------------------------------------------------------------------------

const updateAppointmentStatusInputShape = {
  appointment_id: z.string().uuid().describe("ID do agendamento a atualizar."),
  status: z.enum(["pending", "confirmed", "attended", "no_show", "canceled"])
    .describe("Novo status: confirmed (confirmado), attended (compareceu), no_show (faltou), canceled (cancelado)."),
  notes: z.string().optional().describe("Motivo ou observação sobre a mudança de status."),
};

export const crmUpdateAppointmentStatus: McpToolDefinition<typeof updateAppointmentStatusInputShape> = {
  name: "crm_update_appointment_status",
  description:
    "Atualiza o status de uma consulta ou atendimento (ex: confirmar, registrar comparecimento, falta ou cancelamento). " +
    "Não permite registrar falta (no_show) para consultas futuras.",
  inputSchema: updateAppointmentStatusInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    // 1. Busca o agendamento atual
    const { data: appointment, error: fetchErr } = await ctx.supabase
      .from("appointments")
      .select("id, organization_id, lead_id, scheduled_at, status")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.appointment_id)
      .maybeSingle();

    if (fetchErr || !appointment) {
      throw new Error(`agendamento_nao_encontrado: ${fetchErr?.message || "ID inexistente"}`);
    }

    // Validação de negócio da v1.11.0: Falta (no_show) não pode ser marcada no futuro
    if (input.status === "no_show") {
      const dataAgendada = new Date(appointment.scheduled_at);
      if (dataAgendada.getTime() > Date.now()) {
        throw new Error("validacao_falhou: Não é possível registrar falta (no_show) para um agendamento futuro que ainda não ocorreu.");
      }
    }

    // 2. Atualiza no banco
    const updatePayload: Record<string, unknown> = {
      status: input.status,
      updated_at: new Date().toISOString(),
    };
    if (input.notes !== undefined) {
      updatePayload.notes = input.notes;
    }

    const { error: updateErr } = await ctx.supabase
      .from("appointments")
      .update(updatePayload)
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.appointment_id);

    if (updateErr) {
      throw new Error(`atualizar_status_falhou: ${updateErr.message}`);
    }

    // 3. Sincroniza funil se status move o lead
    const syncResult = await syncAppointmentStage(
      ctx.supabase,
      ctx.organizationId,
      appointment.lead_id,
      input.status,
    );

    return {
      sucesso: true,
      appointment_id: appointment.id,
      novo_status: input.status,
      funil_atualizado: syncResult.moved,
      etapa_destino: syncResult.targetSlug,
    };
  },
};
