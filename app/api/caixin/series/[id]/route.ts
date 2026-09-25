import { isAuthorizedOrUpdateToken } from "../../../../../lib/auth";
import { CaixinApiError, getCaixinObservations } from "../../../../../lib/caixin";
import { caixinConfigFromWorkerEnv } from "../../../../../lib/caixin-worker";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorizedOrUpdateToken(request))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "invalid_series_id" }, { status: 400 });
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(await getCaixinObservations(id, caixinConfigFromWorkerEnv(), {
      start: params.get("start") ?? undefined,
      end: params.get("end") ?? undefined,
      order: params.get("order") === "asc" ? "asc" : "desc",
      page: params.has("page") ? Number(params.get("page")) : undefined,
      pageSize: params.has("page_size") ? Number(params.get("page_size")) : undefined,
    }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CaixinApiError) {
      return Response.json({ error: error.code, requestId: error.requestId }, { status: error.code === "not_configured" ? 503 : error.status ?? 502 });
    }
    return Response.json({ error: "caixin_unavailable" }, { status: 502 });
  }
}
