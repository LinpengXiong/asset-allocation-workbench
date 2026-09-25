import { isAuthorizedOrUpdateToken } from "../../../../lib/auth";
import { CaixinApiError, searchCaixinSeries } from "../../../../lib/caixin";
import { caixinConfigFromWorkerEnv } from "../../../../lib/caixin-worker";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthorizedOrUpdateToken(request))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return Response.json({ error: "q must contain at least 2 characters" }, { status: 400 });
  try {
    return Response.json(await searchCaixinSeries(query, caixinConfigFromWorkerEnv()), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CaixinApiError) {
      return Response.json({ error: error.code, requestId: error.requestId }, { status: error.code === "not_configured" ? 503 : error.status ?? 502 });
    }
    return Response.json({ error: "caixin_unavailable" }, { status: 502 });
  }
}
