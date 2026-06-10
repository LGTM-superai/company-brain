# Company Brain — minimal demo frontend

A single self-contained `index.html` (no build step) to **upload documents** and
**search / ask** the Company Brain. Talks to the FastAPI backend at a configurable
API base URL.

> Easily removable: delete this `frontend/` directory and the "MINIMAL DEMO FRONTEND"
> block in `api/app.py`.

## Two ways to use it

**A. On the server (no Vercel).** The backend already serves the page:
```bash
uvicorn api.app:app --reload      # then open http://localhost:8000/
```

**B. On Vercel (static), pointing at your backend.**
```bash
cd frontend
vercel            # or: vercel --prod   (Vercel CLI; it auto-detects a static site)
```
Or import the repo in the Vercel dashboard and set **Root Directory = `frontend`**.

Then set the **API base URL** in the page's top-right field (saved to `localStorage`),
or pass it in the URL: `https://your-app.vercel.app/?api=http://localhost:8000`.

## Backend reachability

The page runs in *your* browser, so a Vercel-hosted page can call `http://localhost:8000`
directly (modern browsers exempt `localhost` from mixed-content blocking) as long as the
backend is running locally. CORS is enabled on the backend for this.

If your browser blocks it, expose the backend over HTTPS with a tunnel and use that URL:
```bash
cloudflared tunnel --url http://localhost:8000     # or: ngrok http 8000
```

## What it does

- **Upload** — POST `/upload` (UTF-8 text/Markdown), with title/domain/sensitivity.
- **Search** — POST `/search`; renders catalog hits (titles visible to everyone) + raw trace.
- **read** (per result) — POST `/read` as the chosen user; content is **gated by role**.
- **Ask agent** — POST `/ask`; runs the agent (needs model creds).

The `username` field (alice=dev, hannah=hr, evan=csuite) drives the access checks.
