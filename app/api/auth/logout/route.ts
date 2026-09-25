import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../../../../lib/auth";

export async function POST() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 0 });
  return Response.json({ ok: true });
}
