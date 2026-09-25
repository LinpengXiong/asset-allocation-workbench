import { cookies } from "next/headers";
import { createSessionToken, passwordMatches, SESSION_COOKIE, sessionCookieOptions } from "../../../../lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!(await passwordMatches(body.password ?? ""))) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return Response.json({ error: "密码不正确，请重试。" }, { status: 401 });
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  return Response.json({ ok: true });
}
