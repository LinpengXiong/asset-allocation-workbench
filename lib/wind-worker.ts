import { env } from "cloudflare:workers";
import { windConfigFromValues } from "./wind-mcp";

export function windConfigFromWorkerEnv() {
  return windConfigFromValues(env as unknown as Record<string, unknown>);
}
