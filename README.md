# Leadcore

One app that combines:
- **YodSales Pro**: login, Home, Sales Hub pipeline, Territory Map, AI Assistant, Profile and themes, TH/EN, Admin Portal, Support, Fair Use
- **LeadGen**: search logic and lead data. That covers Google Maps scraping, Hot/Warm/Low scoring, approval, Apollo decision-maker contacts and the HubSpot push.
- **Cipher "New search"**: the self-hosted Google Maps engine (gosom), saved search templates, CSV/JSON export and the filterable leads table

```
backend/   Node + Express API   (LeadGen backend + new account/admin/AI/locations/insights routes)
frontend/  Vite + React + Tailwind (YodSales design; LeadGen pages run via a small next/* shim)
```

## 1. One-time database setup
In the **Supabase SQL editor of the LeadGen project**, run `backend/sql/unified_schema.sql`.
It only adds columns and tables. Existing LeadGen data is left as it is.

## 2. Settings
- `backend/.env`: copy `backend/.env.example`. You need Supabase, Apify, Apollo, HubSpot and Gemini keys, plus `ADMIN_EMAILS`.
  - If users log in to a **different** Supabase project than the LeadGen data, set `AUTH_SUPABASE_URL` and `AUTH_SUPABASE_ANON_KEY`.
  - Leave `GCP_PROJECT_ID` empty locally. The job queue then runs inside the backend, so no Cloud Tasks is needed.
- `frontend/.env`: copy `frontend/.env.example`. Set `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Use the anon key only.

## 3. Run locally (Windows)
Double-click **`start-dev.bat`**. It opens the backend on :8080 and the app on http://localhost:3000.

Manual alternative:
```
cd backend  && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## 4. Deploy on Vercel
`vercel.json` deploys two services in one Vercel project: `frontend` (Vite) at `/` and `backend` (Express) at `/api/*`.
Import the GitHub repo in Vercel and add the backend + frontend environment variables (from the two `.env.example` files) in Project Settings. Leave `VITE_API_URL` empty.
On Vercel the search pipeline runs inside the backend function, so very large searches can hit the function time limit. Use Cloud Tasks (`GCP_PROJECT_ID`) for those. The self-hosted gosom engine needs Docker and does not run on Vercel.

## 5. Deploy (Google Cloud Run)
Fill `backend/env.yaml` (from `env.yaml.example`, with `GCP_PROJECT_ID`, `BACKEND_URL` and `PUBLIC_BASE_URL` set) and `frontend/.env`, then run **`deploy.bat`**.

## Search engines (Lead Discovery → Advanced)
| Engine | Needs | Notes |
|---|---|---|
| Apify (default) | `APIFY_API_TOKEN` | Same as LeadGen today |
| Google Maps (gosom) | Docker on the backend machine | Free; runs `gosom/google-maps-scraper` |
| Demo | nothing | Sample data, for testing the full flow |

All three feed the same LeadGen pipeline: clean → score → approve → Apollo → HubSpot.

## Main screens
| Menu | Route | From |
|---|---|---|
| Home | `/` | YodSales (now live data) |
| Sales Hub | `/hub` | YodSales (now saved in the database, with stages and deal value) |
| Territory Map | `/territory` | YodSales map + New search leads table |
| AI Assistant | `/ai` | YodSales (Gemini now runs server-side, using your leads) |
| Lead Discovery | `/discover` | YodSales search bar + LeadGen launch options |
| Search Jobs, Approval, Lead Review | `/dashboard`, `/approval/:id`, `/leads/:id` | LeadGen |
| Apollo Search, Runs, All Contacts | `/apollo`, `/contacts/apollo`, `/contacts/all` | LeadGen |
| Admin Portal | `/admin` | YodSales (users, roles, traffic, support inbox) |
