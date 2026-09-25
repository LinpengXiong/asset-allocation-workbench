import { isAuthorized } from "../../../lib/auth";
import { latestPayload } from "../../../lib/database";

export async function GET() {
  if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const payload = await latestPayload();
  return Response.json({ payload }, { headers: { "cache-control": "private, no-store" } });
}
