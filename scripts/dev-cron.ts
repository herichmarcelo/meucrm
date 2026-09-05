/**
 * scripts/dev-cron.ts — Scheduler local para desenvolvimento.
 *
 * Replica o comportamento do servico `scheduler` do docker-compose.prod.yml
 * (docker/scheduler/entrypoint.sh) em localhost, sem precisar de Docker.
 *
 * Execucao (num terminal separado, com o Next.js ja rodando):
 *   pnpm dev:cron
 *
 * O que faz:
 *   - A cada 60 segundos, chama os mesmos endpoints de cron que o scheduler
 *     de producao chama (espelho fiel de docker/scheduler/entrypoint.sh).
 *   - Usa INTERNAL_SECRET do .env.local como Bearer token.
 *   - Imprime resultado de cada chamada com timestamp e status HTTP.
 *
 * O que NAO faz:
 *   - Nao substitui o scheduler em producao — e so para dev local.
 *   - Nao trava: se um cron falhar, o loop segue para o proximo.
 */

import fs from "node:fs";

// Carrega .env e .env.local se existirem, de forma tolerante (sem quebrar se um deles faltar)
for (const envPath of [".env", ".env.local"]) {
  if (fs.existsSync(envPath)) {
    try {
      if (typeof (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile === "function") {
        (process as unknown as { loadEnvFile: (path: string) => void }).loadEnvFile(envPath);
      }
    } catch {
      // Ignora falha de parsing
    }
  }
}

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.INTERNAL_CRON_SECRET || process.env.INTERNAL_SECRET;

if (!SECRET) {
  console.error(
    "[dev-cron] INTERNAL_SECRET nao encontrado em .env.local ou .env.\n" +
      "           Preencha a chave e rode de novo.",
  );
  process.exit(1);
}

// Espelho da lista de * * * * * do docker/scheduler/entrypoint.sh
const CRONS_POR_MINUTO: [string, string][] = [
  ["api/v1/cron/scheduled-messages-worker", "Mensagens agendadas     "],
  ["api/v1/cron/agent-dispatcher",          "Dispatcher do agente    "],
  ["api/v1/cron/followup-flow-worker",      "Followup flow worker    "],
  ["api/v1/cron/event-log-drain",           "Event log drain         "],
  ["api/v1/cron/routing-worker",            "Routing worker          "],
  ["api/v1/cron/recover-stuck-messages",    "Recover stuck messages  "],
];

// Espelho dos */5 * * * * do entrypoint.sh
const CRONS_5MIN: [string, string][] = [
  ["api/v1/cron/snooze-watcher",             "Snooze watcher          "],
  ["api/v1/cron/attendant-heartbeat",        "Attendant heartbeat     "],
  ["api/v1/cron/channel-health",             "Channel health          "],
  ["api/v1/cron/storage-redaction?limit=50", "Storage redaction       "],
  ["api/v1/cron/webhook-log-retention",      "Webhook log retention   "],
];

const INTERVALO_MS = 60_000; // 1 minuto — paridade com o scheduler de prod

function agora(): string {
  return new Date().toLocaleTimeString("pt-BR", { hour12: false });
}

async function chamarCron(rota: string, desc: string): Promise<void> {
  const url = `${BASE_URL}/${rota}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET as string}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(25_000),
    });

    const status = res.ok ? "OK  " : "ERR ";
    let extra = "";
    try {
      const json = (await res.json()) as { data?: Record<string, unknown> };
      if (json?.data && typeof json.data === "object") {
        const resumo = Object.entries(json.data)
          .filter(([, v]) => v !== null && v !== undefined && v !== 0)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(", ");
        if (resumo) extra = ` (${resumo})`;
      }
    } catch {
      // body nao e JSON — ignora
    }

    console.log(`  ${agora()}  [${status}]  ${desc}  HTTP ${res.status}${extra}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${agora()}  [FAIL]  ${desc}  ${msg}`);
  }
}

async function rodadaMinuto(): Promise<void> {
  console.log(`\n${agora()} ─── tick (1 min) ───────────────────────────────`);
  await Promise.allSettled(CRONS_POR_MINUTO.map(([rota, desc]) => chamarCron(rota, desc)));
}

async function rodada5Min(): Promise<void> {
  console.log(`\n${agora()} ─── tick (5 min) ───────────────────────────────`);
  await Promise.allSettled(CRONS_5MIN.map(([rota, desc]) => chamarCron(rota, desc)));
}

// ─── boot ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│  dev-cron  —  scheduler local para desenvolvimento       │");
  console.log("└─────────────────────────────────────────────────────────┘");
  console.log(`  App URL  : ${BASE_URL}`);
  console.log(`  Intervalo: ${INTERVALO_MS / 1000}s`);
  console.log(`  Crons/min: ${CRONS_POR_MINUTO.length} endpoints`);
  console.log(`  Crons/5mi: ${CRONS_5MIN.length} endpoints`);
  console.log("\n  Aguardando 5s para o Next.js ficar pronto...");

  await new Promise<void>((r) => setTimeout(r, 5_000));

  let tick = 0;

  async function run(): Promise<void> {
    tick++;
    await rodadaMinuto();
    if (tick % 5 === 0) await rodada5Min();
  }

  // Primeira rodada imediata apos o boot
  await run();

  // Loop continuo a cada 60s
  setInterval(() => { void run(); }, INTERVALO_MS);

  process.on("SIGINT", () => {
    console.log("\n[dev-cron] Encerrado (Ctrl+C).");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[dev-cron] Erro fatal:", err);
  process.exit(1);
});
