# 财新 API 数据源接入

本项目已加入服务端财新数据适配层。API key 只允许出现在本地被忽略的 `.env.local` 或 Cloudflare Worker Secret 中，不能放进 React、静态资源、payload、日志或 Git。

## 已实现

- `lib/caixin.ts`：统一 HTTPS 请求、`X-API-Key` 鉴权、正常 User-Agent、10 秒超时、429/503/504 指数退避、`Retry-After`、HTML Challenge 检测、JSON/字段校验、`no_data` 不重试和 request ID 保留。
- `/api/caixin/search?q=...`：登录后服务端检索序列，不向浏览器暴露 key。
- `/api/caixin/series/{id}?start=...&end=...`：登录后服务端读取并规范化观测值。
- `scripts/caixin-fetch.mjs`：本地调试查询，不会自动改写 `collector/latest-payload.json`。
- `scripts/caixin-sync.mjs`：受控 Mac collector 通过 `SITE_URL + UPDATE_TOKEN` 调用线上财新代理，生成 67 项宏观指标的可审计匹配报告；不保存或接触 `CAIXIN_API_KEY`，不自动覆盖 payload。
- `scripts/caixin-map.mjs`：读取脱敏的序列 metadata/search 导出，生成可审计映射报告；不会改写 payload/D1。
- `config/caixin-series.example.json`：序列到现有指标的映射模板；未确认口径前默认关闭。

## 本地配置

在被 `.gitignore` 忽略的 `.env.local` 中自行填写，不要把值发到聊天：

```dotenv
CAIXIN_API_BASE_URL=https://cxdata.053727.xyz
CAIXIN_API_KEY=<你的财新 API key>
CAIXIN_API_USER_AGENT=your-organization/1.0 (contact@example.com)
```

本地查询示例：

```bash
node --experimental-strip-types scripts/caixin-fetch.mjs search "货币供应"
node --experimental-strip-types scripts/caixin-fetch.mjs meta <series_id>
node --experimental-strip-types scripts/caixin-fetch.mjs observations <series_id>
```

## Cloudflare 配置

在目标 Worker 的 Variables and Secrets 中添加：

- `CAIXIN_API_BASE_URL`：普通变量，可填 `https://cxdata.053727.xyz`。
- `CAIXIN_API_USER_AGENT`：普通变量，填写机构标识和联系邮箱。
- `CAIXIN_API_KEY`：**Secret**，在可见的 Cloudflare Dashboard 中手动输入；不要通过聊天、命令参数或日志传递。

本次只完成本地适配和验证，没有自动把财新序列写进线上评分，也没有覆盖生产 Worker。

## 映射边界

文档提供了搜索、元数据、观测值和批量接口，但没有指定哪些序列应映射到现有 67 个宏观指标、19 个资产因子或 6 个风格因子。只有在确认 `series_id`、`has_data`、单位、频率、来源和现有指标口径一致后，才应在映射模板中启用，并由采集任务生成带来源的 payload；否则保留当前 payload/D1 数据作为 fallback。

### 保守自动映射

将不含 API key 的序列元数据导出整理为 `{ "targets": [...], "series": [...] }` 后运行：

```bash
node --experimental-strip-types scripts/caixin-map.mjs metadata-export.json output/caixin-mapping-report.json
```

映射器会规范化名称、频率、单位和来源；只有名称高度重合、`has_data=true`、频率/单位无冲突且置信度至少 0.82 的候选才会 `enabled=true`。相近候选、缺数据、单位或频率冲突会保持禁用并写入 `blockers`。报告是审计产物，不会自动覆盖 `collector/latest-payload.json`、D1 或线上评分。

## 安全回退规则

- 未配置 `CAIXIN_API_KEY`：受保护 API 返回 503，现有 `/api/data` 和 D1/seed fallback 不受影响。
- 财新代理同时接受工作台登录会话或 `Authorization: Bearer UPDATE_TOKEN`；无认证仍返回 401。
- `no_data`、404：不重试，保留现有数据。
- 429/503/504 或网络超时：有限次数退避；仍失败时不覆盖现有数据。
- HTML Challenge 或 Cloudflare 错误页：视为上游不可用，不当作 JSON 解析。
- `meta.ignored_params` 非空：记录警告，提醒参数名可能写错。
