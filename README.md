# Crumb & Co. ERP

Full-stack Restaurant/Bakery ERP built with React, Vite and Supabase. It includes email authentication, data isolation per business, inventory, product purchases, expenses, POS billing, stock-aware sales, and date-range sales reports.

## Run locally

1. Copy `.env.example` to `.env` and replace both values from **Supabase Dashboard → Settings → API**.
2. Install and run: `npm install` then `npm run dev`.
3. Create an account, create your business, add products, then record stock purchases before selling.

## Deploy Supabase database

Create a new Supabase project, log in with the CLI, then run:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --remote
```

The migration enables Row Level Security: each signed-in owner can access only the business and records they own. Do not use a Supabase service-role key in the frontend.

## Deploy the frontend

Import this repository into Vercel or Netlify. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host’s environment variables, use build command `npm run build`, and publish directory `dist`.
