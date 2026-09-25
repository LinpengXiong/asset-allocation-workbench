import { env } from "cloudflare:workers";
import { caixinConfigFromValues } from "./caixin";

export function caixinConfigFromWorkerEnv() {
  return caixinConfigFromValues(env as unknown as Record<string, unknown>);
}
