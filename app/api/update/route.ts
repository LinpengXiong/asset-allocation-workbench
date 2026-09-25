import { updateTokenMatches } from "../../../lib/auth";
import { latestPayload, savePayload } from "../../../lib/database";

function bearer(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

export async function GET(request: Request) {
  if (!updateTokenMatches(bearer(request))) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ payload: await latestPayload() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!updateTokenMatches(bearer(request))) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const payload = await request.json();
    const saved = await savePayload(payload);
    return Response.json({ ok: true, ...saved }, { status: saved.duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid payload";
    return Response.json({ error: message }, { status: 400 });
  }
}
