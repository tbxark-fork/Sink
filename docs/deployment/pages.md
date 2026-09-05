---
title: Deploy on Cloudflare Pages
description: Deploy Sink on Cloudflare Pages through Git integration and dashboard-managed bindings.
---

# Deploy on Cloudflare Pages

## 1. Create the Pages project

Create a [fork of the Sink repository](https://github.com/miantiao-me/Sink/fork). In the Cloudflare dashboard, create a **Pages** project, import the fork, and set:

- **Production branch:** `master`
- **Framework preset:** Nuxt
- **Build command:** `pnpm build`
- **Build output directory:** `dist`

Create the project so settings become available.

::: tip Cancel the first auto-deploy if needed
If a deploy starts before you finish bindings and variables, open the deployment list, click **Cancel**, finish setup, then deploy again.
:::

## 2. Create resources and bind them

Create the Cloudflare resources you need, then open the Pages project → **Settings → Bindings** and add them. Binding = connect a resource to Sink under a fixed name.

| Binding name | Product          | Required?   | What it is                |
| ------------ | ---------------- | ----------- | ------------------------- |
| `DB`         | D1               | Yes         | Stores links              |
| `KV`         | KV               | Yes         | Speeds up redirects       |
| `ANALYTICS`  | Analytics Engine | Recommended | Visit stats               |
| `R2`         | R2               | Optional    | Backups and social images |
| `AI`         | Workers AI       | Optional    | AI suggestions            |

Analytics is optional. Setup: [Analytics and Realtime](/features/analytics).

::: warning Required compatibility flag
Under **Settings → Functions → Compatibility Flags**, add `nodejs_compat` for both **Production** and **Preview**. Sink needs this flag to run on Pages.
:::

## 3. Variables and secrets

Under **Settings → Variables and Secrets**, add:

| Variable                 | Type             | What to put                                                           |
| ------------------------ | ---------------- | --------------------------------------------------------------------- |
| `DEPLOY_D1_DATABASE_ID`  | Variable         | D1 database ID (from the D1 detail page)                              |
| `DEPLOY_KV_NAMESPACE_ID` | Variable         | KV namespace ID (from the KV detail page)                             |
| `NUXT_SITE_TOKEN`        | Encrypted secret | Dashboard login password and API password (strong, stable, ≥ 8 chars) |
| `NUXT_CF_ACCOUNT_ID`     | Variable         | Cloudflare account ID (for analytics)                                 |
| `NUXT_CF_API_TOKEN`      | Encrypted secret | Custom Token with **Account → Account Analytics → Read** only         |

How to create the analytics token: Cloudflare dashboard → profile icon → **My Profile** → **API Tokens** → **Create Token** → **Custom Token** → permission **Account → Account Analytics → Read**.

Pages uses one variable set for both build and runtime. Add R2 only under **Bindings**. More options: [configuration](/configuration/).

On successful `master` builds, Pages also updates the D1 database schema automatically.

## 4. Deploy and first use

Start a deployment from `master` and wait until it finishes.

1. Open `/dashboard` and sign in with `NUXT_SITE_TOKEN`
2. Open **Dashboard → Links** once (one-time storage setup)
3. Create a link

::: tip First open of Links
Until storage setup finishes, creating links may fail with “storage not ready” (HTTP 423).
:::

Manual [backups](/features/backups) work on Pages; automatic daily backups are configured for Workers only in this repo.
