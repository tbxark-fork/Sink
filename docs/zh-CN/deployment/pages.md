---
title: 部署到 Cloudflare Pages
description: 通过 Git 集成和仪表盘管理的绑定将 Sink 部署到 Cloudflare Pages。
---

# 部署到 Cloudflare Pages

## 1. 创建 Pages 项目

[Fork Sink 仓库](https://github.com/miantiao-me/Sink/fork)。在 Cloudflare 仪表盘中创建 **Pages** 项目，导入该 Fork，并设置：

- **生产分支：** `master`
- **框架预设：** Nuxt
- **构建命令：** `pnpm build`
- **构建输出目录：** `dist`

先创建项目，才能进入设置。

::: tip 必要时取消首次自动部署
如果绑定和变量还没配完就已开始部署，请打开部署列表点 **Cancel**，配完后再重新部署。
:::

## 2. 创建资源并绑定

创建需要的 Cloudflare 资源，然后打开 Pages 项目 → **Settings → Bindings** 添加。绑定 = 把资源用固定名称接到 Sink。

| 绑定名称    | 产品             | 是否必需 | 是什么         |
| ----------- | ---------------- | -------- | -------------- |
| `DB`        | D1               | 必需     | 保存链接       |
| `KV`        | KV               | 必需     | 加速跳转       |
| `ANALYTICS` | Analytics Engine | 推荐     | 访问统计       |
| `R2`        | R2               | 可选     | 备份与社交图片 |
| `AI`        | Workers AI       | 可选     | AI 建议        |

访问分析是可选的。启用步骤见[访问分析与近实时视图](/zh-CN/features/analytics)。

::: warning 必须加兼容性标志
在 **Settings → Functions → Compatibility Flags** 中，为 **Production** 和 **Preview** 都添加 `nodejs_compat`。Pages 上运行 Sink 需要这个标志。
:::

## 3. 变量和密钥

在 **Settings → Variables and Secrets** 中添加：

| 变量                     | 类型     | 填什么                                                      |
| ------------------------ | -------- | ----------------------------------------------------------- |
| `DEPLOY_D1_DATABASE_ID`  | 变量     | D1 数据库 ID（在 D1 详情页）                                |
| `DEPLOY_KV_NAMESPACE_ID` | 变量     | KV 命名空间 ID（在 KV 详情页）                              |
| `NUXT_SITE_TOKEN`        | 加密密钥 | 仪表盘登录密码和 API 密码（高强度、稳定，至少 8 个字符）    |
| `NUXT_CF_ACCOUNT_ID`     | 变量     | Cloudflare 账户 ID（访问分析用）                            |
| `NUXT_CF_API_TOKEN`      | 加密密钥 | 仅含 **Account → Account Analytics → Read** 的 Custom Token |

创建访问分析令牌：Cloudflare 仪表盘 → 右上角头像 → **My Profile** → **API Tokens** → **Create Token** → **Custom Token** → 权限选 **Account → Account Analytics → Read**。

Pages 的构建和运行共用这一套变量。R2 只能在 **Bindings** 里添加。更多选项见[配置参考](/zh-CN/configuration/)。

`master` 分支构建成功后，Pages 还会自动更新 D1 数据库结构。

## 4. 部署并首次使用

从 `master` 启动部署并等待完成。

1. 打开 `/dashboard`，用 `NUXT_SITE_TOKEN` 登录
2. 打开一次 **Dashboard → Links**（一次性存储初始化）
3. 创建链接

::: tip 必须先打开一次 Links
存储初始化完成前，创建链接可能失败，并提示「存储未就绪」（HTTP 423）。
:::

Pages 支持手动[备份](/zh-CN/features/backups)；本仓库里每日自动备份只为 Workers 配置。
