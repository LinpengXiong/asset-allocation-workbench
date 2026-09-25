export const WIND_INDEX_ENDPOINT = "https://mcp.wind.com.cn/vserver_index_data/mcp/";

export type WindMcpConfig = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class WindMcpError extends Error {
  readonly code: "not_configured" | "upstream_http" | "timeout" | "network" | "invalid_response" | "upstream_error";
  readonly status?: number;
  constructor(message: string, code: WindMcpError["code"], status?: number) {
    super(message);
    this.name = "WindMcpError";
    this.code = code;
    this.status = status;
  }
}

function parseSse(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Record<string, unknown>;
  const data = text.split(/\r?\n/).filter((line) => line.startsWith("data: ")).at(-1)?.slice(6);
  if (!data) throw new WindMcpError("Wind MCP 返回格式无法识别", "invalid_response");
  return JSON.parse(data) as Record<string, unknown>;
}

async function request(config: WindMcpConfig, method: string, params: Record<string, unknown>) {
  if (!config.apiKey?.trim()) throw new WindMcpError("WIND_API_KEY 未配置", "not_configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, config.timeoutMs ?? 10_000));
  try {
    const response = await (config.fetchImpl ?? fetch)(config.baseUrl || WIND_INDEX_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new WindMcpError(`Wind MCP HTTP ${response.status}`, "upstream_http", response.status);
    const payload = parseSse(body);
    if (payload.error) throw new WindMcpError("Wind MCP 返回 JSON-RPC 错误", "upstream_error");
    const result = payload.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    if (!result) throw new WindMcpError("Wind MCP 缺少 result", "invalid_response");
    if (result.isError) throw new WindMcpError("Wind MCP 工具调用失败", "upstream_error");
    return result;
  } catch (error) {
    if (error instanceof WindMcpError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new WindMcpError("Wind MCP 请求超时", "timeout");
    throw new WindMcpError("Wind MCP 网络请求失败", "network");
  } finally {
    clearTimeout(timer);
  }
}

export async function callWindIndexPrice(config: WindMcpConfig, args: { windcode: string; indexes?: string }) {
  await request(config, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "asset-allocation-protected-site", version: "1.0" },
  });
  return request(config, "tools/call", {
    name: "get_index_price_indicators",
    arguments: args,
    _meta: { clientVersion: "1.0" },
  });
}

export function windConfigFromValues(values: Record<string, unknown>): WindMcpConfig {
  return {
    apiKey: typeof values.WIND_API_KEY === "string" ? values.WIND_API_KEY : "",
    baseUrl: typeof values.WIND_INDEX_API_BASE_URL === "string" ? values.WIND_INDEX_API_BASE_URL : undefined,
  };
}
