# Wind 数据源接入

## 结论

本机 Wind MCP/CLI 可用；本次探针成功返回 `economic_data.search_economic_indicator` 的宏观指标元数据。Cloudflare Worker 不能直接调用本机 CLI、用户桌面进程或本地 Wind MCP 会话，因此不能把“本机可用”误报成“线上 Worker 已实时取数”。

## 已实现

- `lib/wind.ts`：Wind CLI JSON envelope 解析、错误信封处理、审计 source ID 生成；不携带 key。
- `scripts/wind-sync.mjs`：在采集机运行 Wind CLI，生成 `output/wind-audit.json`；默认只读，不发布、不覆盖 payload/D1。
- `config/wind-source.example.json`：provider、CLI、工具和 collector-bridge 配置模板。
- `scripts/publish-data.mjs`：仍是现有显式发布入口；只有人工检查过合并后的 payload 后才应调用。
- `/api/wind/index/price?windcode=...`：登录后只读调用 Wind `index_data.get_index_price_indicators`，密钥只从 Worker Secret 读取。

## Worker 配置

线上直连需要在目标 Worker 的 Variables and Secrets 中手动添加：

- `WIND_API_KEY`：Secret。
- `WIND_INDEX_API_BASE_URL`：普通变量，默认 `https://mcp.wind.com.cn/vserver_index_data/mcp/`。

当前代码只接入了契约明确的指数截面行情入口，未猜测其它 Wind 工具参数。未配置 `WIND_API_KEY` 时接口返回 503，现有数据接口与 fallback 不受影响。

本机发布入口为 `scripts/sync-wind-index.mjs 000001.SH --publish`：它先从线上 `/api/update` 下载完整 payload，再只更新 `index` 和 Wind source 记录，运行 `validate-payload.mjs` 后调用现有 `publish-data.mjs`。19 个大类因子、6 个风格因子和评分均原样保留。macOS LaunchAgent 仅提供未加载的模板：`launchd/com.asset-allocation.wind-index.plist.example`。

## 运行方式

```bash
node --experimental-strip-types scripts/wind-sync.mjs "中国GDP相关指标有哪些" output/wind-gdp-audit.json
```

Wind CLI 的本机 API key 由 Wind 自己的凭据配置管理；不要把它写入仓库、前端、命令参数或日志。Worker 线上若要实时同步宏观或批量数据，仍需要外部受控采集机/定时任务持有 Wind 授权，再通过现有 Bearer `UPDATE_TOKEN` 发布经过校验的完整 payload；本项目本轮没有自动发布或部署。

## 数据边界

- 现有 `/api/data`、D1 和 seed fallback 不变。
- Wind 结果先写审计文件，包含 provider、问题、指标代码、名称、单位、来源、频率、更新时间和 source ID。
- 不把 Wind 原始返回直接覆盖现有 `collector/latest-payload.json`；指标映射、评分和写入必须单独审核。
- 若 Wind CLI 返回 `AUTH_ERROR`、额度、网络或后端错误，采集任务应失败并保留现有数据。

## 当前限制

本机实时探针可用，但 Cloudflare Worker 不能直接在线取本机 Wind 数据。还缺少正式的 Wind 线上授权/采集机、定时调度和 67 个宏观指标的逐项口径映射；因此当前不能宣称线上实时 Wind 已接通。
