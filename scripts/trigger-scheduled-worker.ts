import { processDueScheduledMessages } from "@/app/api/v1/cron/scheduled-messages-worker/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";

async function main() {
  console.info("Acionando worker de mensagens agendadas...");
  const admin = createAdminClient();
  const requestId = randomUUID();
  const result = await processDueScheduledMessages(admin, new Date(), requestId);
  console.info("Resultado do processamento:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Erro no worker:", err);
  process.exit(1);
});
