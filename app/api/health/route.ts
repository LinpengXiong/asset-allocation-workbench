export async function GET() {
  return Response.json({ ok: true, service: "multi-asset-allocation", time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
