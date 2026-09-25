import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "asset_allocation_session";
const SESSION_SECONDS = 12 * 60 * 60;

function runtimeValue(name: "PORTAL_PASSWORD" | "SESSION_SECRET" | "UPDATE_TOKEN") {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hmac(value: string) {
  const secret = runtimeValue("SESSION_SECRET");
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string) {
  const max = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function passwordMatches(candidate: string) {
  const expected = runtimeValue("PORTAL_PASSWORD");
  return Boolean(expected) && constantTimeEqual(candidate, expected);
}

export async function createSessionToken() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const body = String(expires);
  return `${body}.${await hmac(body)}`;
}

export async function isAuthorized() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";
  const [expiresRaw, signature] = token.split(".");
  const expires = Number(expiresRaw);
  if (!expiresRaw || !signature || !Number.isFinite(expires)) return false;
  if (expires < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(expiresRaw);
  return constantTimeEqual(signature, expected);
}

export function updateTokenMatches(candidate: string) {
  const expected = runtimeValue("UPDATE_TOKEN");
  return Boolean(expected) && constantTimeEqual(candidate, expected);
}

export async function isAuthorizedOrUpdateToken(request: Request) {
  if (await isAuthorized()) return true;
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") && updateTokenMatches(authorization.slice(7));
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: SESSION_SECONDS,
};
