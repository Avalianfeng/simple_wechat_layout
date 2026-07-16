# simple-wechat-layout

极简、可自托管的微信公众号排版助手。给家人用：写字 → 一键整理 → 复制到公众号后台。

**线上**：https://wxlayout.cylf.me（当前部署版本见本地 `SERVER_STATUS.local.md`，该文件不入库）

## 做什么

1. 注册登录后，任意文本经 **DeepSeek V4 Flash** 整理成干净 Markdown（默认每天 5 次，管理端可设不限）
2. 本地渲染：主题 + 配色 + 字体 / 字号 + 缩进；换样式只走 `/api/render`，**不重新调用 AI、不占次数**
3. 预览 + 一键复制到微信；账户页可查看用量与参考花费（本站不扣费，按官方价含缓存命中估算）
4. 整理结果可保存文章历史（默认最多 10 篇，超出删最早并清理未再引用的图片）
5. 邀请码注册 + 同 IP 注册上限，防刷号；管理后台可开关 AI、调额度
6. 主页底部可放收款码（`public/pay-qr.png`）自愿支持

## 本地运行

```bash
cp .env.example .env
# 编辑 .env：DEEPSEEK_API_KEY、ADMIN_TOKEN、REGISTER_INVITE_CODE

npm install
npm start
```

打开 http://127.0.0.1:3080  
管理后台：http://127.0.0.1:3080/admin.html（填写 `ADMIN_TOKEN`）

给家人「不限次数」：管理后台找到用户 → 勾选「不限」→ 保存。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | 必填，服务端使用 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-v4-flash`；也可用 `deepseek-v4-pro` |
| `ADMIN_TOKEN` | 管理后台令牌 |
| `REGISTER_INVITE_CODE` | 设置后注册必填邀请码 |
| `REGISTER_PER_IP_PER_DAY` | 同 IP 每日注册上限，默认 `2`；`0` 不限制 |
| `DEFAULT_DAILY_AI_LIMIT` | 新用户默认日次数，默认 `5`；`-1` 为不限 |
| `HISTORY_LIMIT` | 每用户历史篇数上限，默认 `10` |
| `DEEPSEEK_PRICE_INPUT_CACHE_HIT` / `INPUT` / `OUTPUT` | 参考单价（元/百万 tokens）；默认按模型用 V4 公开价 |
| `SUPPORT_WECHAT` | 页脚微信号（可复制） |
| `PUBLIC_BASE_URL` | 公网根地址，上传图片绝对 URL；本地可留空 |

完整示例见 [.env.example](./.env.example)。

## API（摘要）

- `POST /api/auth/register|login|logout|password` — 账号
- `GET /api/me`、`GET /api/me/usage` — 当前用户、用量明细与累计汇总
- `GET|DELETE /api/history`、`GET /api/history/:id` — 文章历史
- `GET /api/options` — 主题 / 配色 / 限额说明
- `POST /api/upload` — 需登录
- `POST /api/convert` — 需登录 + 日额度；返回 usage / 参考花费，并写入历史
- `POST /api/render` — 需登录；换肤不调 AI；`save=true` 时写入历史
- `GET /api/admin/overview` — 限额与今日概况
- `GET /api/admin/ips`、`POST|DELETE /api/admin/ips/ban` — 注册 IP 与封禁
- `GET|PATCH /api/admin/users`、`GET /api/admin/users/:id/usage` — 用户与明细
- `GET /api/health` — 健康检查（含 DeepSeek 探测）

`style` 字段：`{ theme, primaryColor, fontFamily, fontSize, indent, justify }`

将「加我好友」二维码放到 `public/wechat-qr.png`，收款码放到 `public/pay-qr.png`（竖图会按原比例显示，勿强制正方形）。

## 部署（cylf.me / aeris）

生产域名：`wxlayout.cylf.me`。对齐 `D:\学习\VPS\docs\新项目上机SOP.md`：

1. Cloudflare 增加 `wxlayout` A 记录 → 服务器 IP（DNS Only）
2. 将本仓库放到 `/opt/docker/compose/layout/`，放入 `.env`（含 DeepSeek Key、邀请码、管理令牌）
3. `docker compose up -d --build`（使用本目录 [docker-compose.yml](./docker-compose.yml)）
4. **追加** Caddy 站点块（勿整文件覆盖）：

```caddyfile
wxlayout.cylf.me {
    reverse_proxy layout:3080
}
```

5. `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`（以 SOP 实况为准）

内存限制 512M；`data/`（SQLite + uploads）挂 volume。线上密钥与部署快照写在本地 `SERVER_STATUS.local.md`（已 gitignore，勿提交）。

## 图片说明

| 场景 | 结果 |
|------|------|
| 本站预览 | 本站 `/uploads/...` 正常显示 |
| 粘贴公众号 | 外链图会被过滤，需按页面提示在后台按序插图 |
| 后期（有 AppID） | 可接 `uploadimg` 换成 `mmbiz.qpic.cn` 再复制 |

## 明确不做（当前）

余额充值扣费、收集用户 API Key、微信草稿自动推送。
