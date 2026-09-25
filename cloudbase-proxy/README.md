# CloudBase 国内站点

这是资产配置工作台的腾讯云 CloudBase 国内版本。

- 云函数直接提供页面、密码验证、会话 cookie 和最新数据，不依赖境外站点。
- 数据文件为 `latest-payload.json`，网页每 60 秒自动拉取一次。
- 数据响应强制私有且不缓存；健康检查公开的只有日期与不可逆的数据指纹。
- 发布命令由项目根目录的 `scripts/publish-data-cloudbase.mjs` 统一执行，发布后会核对线上数据指纹。

函数通过 HTTP 访问服务接收 `event` 中的路径、方法、请求头与请求体，并返回 CloudBase 集成响应。
