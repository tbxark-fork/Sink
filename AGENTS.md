# Repository Guidelines

Guidelines for agentic coding agents operating in the Sink codebase.

## Project Overview

Sink is a link shortener with analytics, running 100% on Cloudflare. Uses Nuxt 4 frontend and Cloudflare Workers backend.

**All documentation and comments must be in English.**

## Project Structure

```
app/                    # Nuxt 4 application
  ├── components/       # Vue components (PascalCase)
  │   ├── ui/           # shadcn-vue components (DO NOT EDIT - auto-generated)
  │   ├── dashboard/    # Dashboard components
  │   └── home/         # Landing page components
  ├── composables/      # Vue composables (camelCase)
  ├── pages/            # File-based routing
  ├── types/            # TypeScript types
  ├── utils/            # Utility functions
  └── lib/              # Shared helpers
layers/dashboard/       # Dashboard layer (extends app/)
server/                 # Nitro server (Cloudflare Workers)
  ├── api/              # API endpoints (method suffix: create.post.ts)
  └── utils/            # Server utilities
schemas/                # Zod validation schemas (shared client/server)
tests/                  # Vitest tests (Cloudflare Workers pool)
```

## Commands

Use **pnpm** (v10+) with **Node.js 22+**.

```bash
# Development
pnpm dev                  # Start dev server (port 7465)
pnpm build                # Production build
pnpm preview              # Worker preview via wrangler
pnpm lint:fix             # ESLint with auto-fix
pnpm types:check          # TypeScript type check

# Testing (Vitest + @cloudflare/vitest-pool-workers)
pnpm vitest               # Watch mode
pnpm vitest run           # CI mode (run once)
pnpm vitest tests/api/link.spec.ts       # Single test file
pnpm vitest -t "creates new link"        # Match test name pattern

# Deployment
pnpm deploy:pages         # Deploy to Cloudflare Pages
pnpm deploy:worker        # Deploy to Cloudflare Workers
```

## Code Style

Uses `@antfu/eslint-config`. Run `pnpm lint:fix` before committing.

**Formatting**: 2-space indent | Single quotes | No semicolons | Trailing commas

### TypeScript

- Use TypeScript everywhere; prefer `interface` for objects, `type` for unions
- Avoid `any`; use proper types or `unknown`
- Use Zod for runtime validation in `schemas/`

```typescript
// schemas/link.ts - shared validation
export const LinkSchema = z.object({
  id: z.string().trim().max(26),
  url: z.string().trim().url().max(2048),
  slug: z.string().trim().max(2048).regex(slugRegex),
})
export type Link = z.infer<typeof LinkSchema>
```

### Vue Components

Use `<script setup lang="ts">` always. Files: PascalCase (`LinkEditor.vue`).

```vue
<script setup lang="ts">
import type { Link } from '@/types'

const props = defineProps<{ link: Link }>()
const emit = defineEmits<{ update: [link: Link] }>()
</script>

<template>
  <div>{{ props.link.slug }}</div>
</template>
```

### Imports

- **Prefer Nuxt auto-imports**: `ref`, `computed`, `useFetch`, `useState`, etc.
- **Explicit imports for**: external libs, types (`import type { Link } from '@/types'`), icons (`import { Copy } from 'lucide-vue-next'`)

### Naming Conventions

| Item           | Convention       | Example               |
| -------------- | ---------------- | --------------------- |
| Components     | PascalCase       | `LinkEditor.vue`      |
| Composables    | `use` prefix     | `useDashboardRoute()` |
| API routes     | method suffix    | `create.post.ts`      |
| Directories    | kebab-case       | `dashboard/links/`    |
| Functions/vars | camelCase        | `getLink`             |
| Constants      | UPPER_SNAKE_CASE | `DASHBOARD_ROUTES`    |

### Error Handling

```typescript
// Server API - use createError for HTTP errors
export default eventHandler(async (event) => {
  const link = await readValidatedBody(event, LinkSchema.parse)
  if (existingLink) {
    throw createError({ status: 409, statusText: 'Link already exists' })
  }
})
```

## Cloudflare Bindings

Access via destructuring `event.context`:

```typescript
const { cloudflare } = event.context
const { KV, ANALYTICS, AI, R2 } = cloudflare.env
```

| Binding     | Type             | Purpose                    |
| ----------- | ---------------- | -------------------------- |
| `KV`        | Workers KV       | Link storage               |
| `ANALYTICS` | Analytics Engine | Click tracking & analytics |
| `AI`        | Workers AI       | AI-powered slug generation |
| `R2`        | R2 Bucket        | Data backup & file storage |

## Testing Patterns

Tests use `@cloudflare/vitest-pool-workers` with real Cloudflare bindings (single worker, shared storage).

```typescript
import { describe, expect, it } from 'vitest'
import { fetchWithAuth, postJson } from '../utils'

describe.sequential('/api/link/create', () => {
  it('creates new link with valid data', async () => {
    const response = await postJson('/api/link/create', { url: 'https://example.com', slug: 'test' })
    expect(response.status).toBe(201)
  })
})
```

**Test utilities** (`tests/utils.ts`): `fetchWithAuth`, `postJson`, `putJson`, `fetch`

Use `describe.sequential` for tests that share state.

## UI Components

- Use shadcn-vue from `app/components/ui/` - **Never edit** (auto-generated)
- Use `ResponsiveModal` for mobile-optimized dialogs
- Use Tailwind CSS v4 for styling
- Use static English for `aria-label` (no `$t()` translations)

## Commits

Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`

## Pre-commit

`simple-git-hooks` runs `lint-staged` on commit, auto-runs `eslint --fix` on staged files.
