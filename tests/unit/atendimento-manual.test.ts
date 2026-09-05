import { describe, expect, it, vi } from "vitest";
import { pausarIaPorAtendimentoManual, PRAZO_DO_SILENCIO_MS, normalizarInstante } from "@/lib/escalacao/atendimento-manual";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-09-05T12:00:00.000Z");

function adminStub(
  silencedUntil: string | null,
  falha?: { leitura?: string; escrita?: string },
) {
  const updates: Array<Record<string, unknown>> = [];
  const chain = {
    select: () => chain,
    update: (patch: Record<string, unknown>) => {
      updates.push(patch);
      return chain;
    },
    eq: () => chain,
    maybeSingle: () => {
      if (falha?.leitura) return Promise.resolve({ data: null, error: { message: falha.leitura } });
      return Promise.resolve({ data: { bot_silenced_until: silencedUntil }, error: null });
    },
    then: (r: (v: unknown) => unknown) => {
      if (falha?.escrita) return Promise.resolve({ error: { message: falha.escrita } }).then(r);
      return Promise.resolve({ error: null }).then(r);
    },
  };
  return { admin: { from: vi.fn(() => chain) } as never, updates };
}

function silenciadaAte(patch: Record<string, unknown>): Date {
  return new Date(String(patch.bot_silenced_until));
}

describe("pausarIaPorAtendimentoManual — as duas pontas do prazo", () => {
  it("PONTA A: logo depois da fala humana, a conversa grava pausa de 60 minutos", async () => {
    const { admin, updates } = adminStub(null);
    const pausou = await pausarIaPorAtendimentoManual(admin, {
      organizationId: ORG,
      conversationId: CONV,
      agora: T0,
    });

    expect(pausou).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.bot_silenced_until).not.toBe("infinity");
    expect(silenciadaAte(updates[0]!).getTime()).toBe(T0.getTime() + PRAZO_DO_SILENCIO_MS);
  });

  it("PONTA B: rastro de handoff preenchido corretamente", async () => {
    const { admin, updates } = adminStub(null);
    await pausarIaPorAtendimentoManual(admin, {
      organizationId: ORG,
      conversationId: CONV,
      agora: T0,
    });

    expect(updates[0]!.last_handoff_at).toBe(T0.toISOString());
    expect(String(updates[0]!.last_handoff_reason)).toMatch(/Atendimento manual/);
  });
});

describe("pausarIaPorAtendimentoManual — cada fala humana RENOVA o prazo", () => {
  it("segunda mensagem 30 min depois empurra o vencimento para 30 min + o prazo", async () => {
    const primeiroVencimento = new Date(T0.getTime() + PRAZO_DO_SILENCIO_MS);
    const trintaMinDepois = new Date(T0.getTime() + 30 * 60 * 1000);

    const { admin, updates } = adminStub(primeiroVencimento.toISOString());
    const renovou = await pausarIaPorAtendimentoManual(admin, {
      organizationId: ORG,
      conversationId: CONV,
      agora: trintaMinDepois,
    });

    expect(renovou).toBe(true);
    expect(updates).toHaveLength(1);
    expect(silenciadaAte(updates[0]!).getTime()).toBe(
      trintaMinDepois.getTime() + PRAZO_DO_SILENCIO_MS,
    );
  });
});

describe("pausarIaPorAtendimentoManual — nunca ENCURTA um silêncio maior", () => {
  it("'infinity' (handoff formal) NUNCA é encurtado", async () => {
    const { admin, updates } = adminStub("infinity");
    const pausou = await pausarIaPorAtendimentoManual(admin, {
      organizationId: ORG,
      conversationId: CONV,
      agora: T0,
    });
    expect(pausou).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("janela mais longa já em vigor (ex.: 6h) não regride para o prazo padrão", async () => {
    const daquiA6h = new Date(T0.getTime() + 6 * 60 * 60 * 1000).toISOString();
    const { admin, updates } = adminStub(daquiA6h);
    const pausou = await pausarIaPorAtendimentoManual(admin, {
      organizationId: ORG,
      conversationId: CONV,
      agora: T0,
    });
    expect(pausou).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("silêncio já VENCIDO é estendido de novo", async () => {
    const jaPassou = new Date(T0.getTime() - 60_000).toISOString();
    const { admin, updates } = adminStub(jaPassou);
    const pausou = await pausarIaPorAtendimentoManual(admin, {
      organizationId: ORG,
      conversationId: CONV,
      agora: T0,
    });
    expect(pausou).toBe(true);
    expect(silenciadaAte(updates[0]!).getTime()).toBe(T0.getTime() + PRAZO_DO_SILENCIO_MS);
  });
});

describe("pausarIaPorAtendimentoManual — normalizarInstante", () => {
  it("normaliza strings de data e valores infinitos", () => {
    expect(normalizarInstante(null)).toBeNull();
    expect(normalizarInstante(undefined)).toBeNull();
    expect(normalizarInstante("infinity")).toBe(Number.POSITIVE_INFINITY);
    expect(normalizarInstante("-infinity")).toBe(Number.NEGATIVE_INFINITY);
    expect(normalizarInstante("data-invalida")).toBeNull();
    const d = new Date();
    expect(normalizarInstante(d)).toBe(d);
  });
});
