import { isAuthorized } from "../../../../../lib/auth";
import { WindMcpError, callWindIndexPrice } from "../../../../../lib/wind-mcp";
import { windConfigFromWorkerEnv } from "../../../../../lib/wind-worker";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const windcode = params.get("windcode")?.trim() ?? "";
  if (!windcode || !/^[A-Za-z0-9.,_:-]+$/.test(windcode)) return Response.json({ error: "invalid_windcode" }, { status: 400 });
  const indexes = params.get("indexes")?.trim() || undefined;
  try {
    return Response.json(await callWindIndexPrice(windConfigFromWorkerEnv(), { windcode, indexes }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WindMcpError) return Response.json({ error: error.code }, { status: error.code === "not_configured" ? 503 : error.status ?? 502 });
    return Response.json({ error: "wind_unavailable" }, { status: 502 });
  }
}
