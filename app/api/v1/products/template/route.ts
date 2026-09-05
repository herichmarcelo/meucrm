/**
 * GET /api/v1/products/template — baixa o modelo de planilha CSV para catálogo de produtos.
 */
import { gerarModeloCsv } from "@/lib/catalogo/csv";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const csv = gerarModeloCsv();
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="modelo_catalogo_produtos.csv"',
      "Cache-Control": "no-cache",
    },
  });
}
