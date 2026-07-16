# simple-wechat-layout

极简、可自托管的微信公众号排版助手。给家人用：写字 → 一键整理 → 复制到公众号后台。

## 做什么

1. 任意文本（无格式或半 Markdown）**一律**经 DeepSeek 整理成干净 Markdown  
2. 本地渲染为带内联样式的 HTML（借 doocs/md 的 simple 主题思路）  
3. 预览 + 一键复制到微信编辑器  
4. 图片可上传到本站供预览；粘贴进公众号后需在后台手动插图（微信不认外链图）

## 本地运行

```bash
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

npm install
npm start
```

打开 http://127.0.0.1:3080

开发热重载：`npm run dev`

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | 必填，服务端使用，网页不暴露配置 |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `PORT` | 默认 `3080` |
| `PUBLIC_BASE_URL` | 公网根地址，用于上传图片绝对 URL；本地可留空 |

## API

- `POST /api/upload` — `multipart` 字段名 `images` → `{ images: [{ filename, url }] }`  
- `POST /api/convert` — `{ text, imageUrls[] }` → `{ markdown, html, images }`  
- `GET /uploads/:file` — 已上传图片  
- `GET /api/health` — 健康检查  

## 部署（cylf.me / aeris）

对齐 `D:\学习\VPS\docs\新项目上机SOP.md`：

1. Cloudflare 增加 `layout` A 记录 → 服务器 IP（DNS Only）  
2. 将本仓库放到 `/opt/docker/compose/layout/`，放入 `.env`（含 DeepSeek Key）  
3. `docker compose up -d --build`（使用本目录 [docker-compose.yml](./docker-compose.yml)）  
4. **追加** Caddy 站点块（勿整文件覆盖）：

```caddyfile
layout.cylf.me {
    reverse_proxy layout:3080
}
```

5. `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`（以 SOP 实况为准）  

内存限制 512M；uploads 目录挂 volume。

## 图片说明

| 场景 | 结果 |
|------|------|
| 本站预览 | 本站 `/uploads/...` 正常显示 |
| 粘贴公众号 | 外链图会被过滤，需按页面提示在后台按序插图 |
| 后期（有 AppID） | 可接 `uploadimg` 换成 `mmbiz.qpic.cn` 再复制 |

## 文档

- [DIRECTION.md](./DIRECTION.md) — 产品路线  
- [QUESTIONS.md](./QUESTIONS.md) — 需求问答记录  

## 明确不做（MVP）

跳过 AI、微信草稿自动推送、登录、多主题、依赖 md2wechat 远程排版。
