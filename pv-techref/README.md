# ICA Solar — PV Component Technical Reference

Internal engineering reference tool for PV solar components. Look up technical specifications for solar modules, hybrid inverters, batteries, solar charge controllers, and on-grid inverters.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Search:** Fuse.js (client-side fuzzy) + Supabase full-text
- **Deployment:** Vercel

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run the database migration

In your Supabase project dashboard, go to **SQL Editor** and run:

```
supabase/migrations/001_initial_schema.sql
```

Or using the Supabase CLI:

```bash
supabase db push
```

### 4. Seed the database

```bash
pnpm tsx scripts/seed.ts
```

This seeds all 33 product records across 5 categories.

### 5. Start the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
pv-techref/
├── app/
│   ├── layout.tsx                  # Root layout
│   ├── page.tsx                    # Home page with search
│   ├── globals.css                 # Global styles
│   ├── components/
│   │   ├── SearchBar.tsx           # Global autocomplete search (Cmd+K)
│   │   ├── CategoryNav.tsx         # Category navigation
│   │   ├── ProductCard.tsx         # Product summary card
│   │   ├── SpecTable.tsx           # Grouped spec table with copy button
│   │   ├── FilterBar.tsx           # Category-specific filter chips
│   │   └── CategoryBadge.tsx       # Color-coded category pill
│   ├── [category]/
│   │   └── page.tsx                # Category listing with sortable table
│   ├── [category]/[model]/
│   │   └── page.tsx                # Product detail with full spec table
│   └── api/
│       └── search/route.ts         # API route for autocomplete
├── lib/
│   ├── supabase.ts                 # Supabase client
│   ├── types.ts                    # TypeScript interfaces + category config
│   └── utils.ts                    # formatIDR, formatUnit, slugify helpers
├── scripts/
│   └── seed.ts                     # One-time data seeding script
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # Full schema with RLS
├── .env.local.example
├── vercel.json
└── package.json
```

## Categories & URL Structure

| Category | URL Slug | Table |
|---|---|---|
| PV Modules | `/pv-modules` | `pv_modules` |
| Hybrid Inverters | `/hybrid-inverters` | `hybrid_inverters` |
| Batteries | `/batteries` | `batteries` |
| Solar Charge Controllers | `/solar-charge-controllers` | `solar_charge_controllers` |
| On-Grid Inverters | `/on-grid-inverters` | `on_grid_inverters` |

Product detail: `/<category>/<model>`
Example: `/pv-modules/ICA550-72HMI`

## Features

- **Global Search** — Fuzzy search with Cmd+K shortcut, keyboard navigation, grouped results
- **Sortable Tables** — Click any column header to sort ascending/descending
- **Filters** — Per-category filter chips (power range, phase, battery chemistry, system voltage)
- **Spec Tables** — Grouped with copy-to-clipboard on each row
- **Print Friendly** — Clean print layout via `Ctrl+P`
- **Dark Theme** — Dark navy engineering dashboard

## Deployment to Vercel

1. Push to GitHub
2. Import repo in [Vercel Dashboard](https://vercel.com/new)
3. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy — auto-deploys on every push to `main`

## Data Format

- **Prices:** Displayed as `Rp X,XXX,XXX`. Null prices show `— (contact sales)`
- **Units:** Always shown inline (e.g. `42.4 V`, `98.5 %`, `29 kg`)
- **Null values:** Displayed as `—` (em dash)
- **Certifications:** Rendered as individual badge chips
