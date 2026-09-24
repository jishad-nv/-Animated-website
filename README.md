# Pop Carty — Premium Animated E-Commerce Store

> A cinematic, scroll-driven animated e-commerce experience built with Three.js, Google Model Viewer, and a production-grade Node.js API.

---

## 🏗️ Architecture (v2.0 — Vercel-Ready)

```
popcarty/
├── frontend/          ← Static site → Deploy to Vercel
│   ├── index.html     ← Main store page
│   ├── admin.html     ← Admin dashboard
│   ├── js/
│   │   └── config.js  ← Dynamic API URL resolver (no hardcoding)
│   ├── assets/        ← Logo, product images, 3D assets
│   ├── public/        ← Hero animation frames (250 PNG sequence)
│   └── vercel.json    ← Vercel routing config
│
├── backend/           ← REST API service → Deploy to Render/Railway/Fly.io
│   ├── server.js      ← Express API server (all routes)
│   ├── db.js          ← PostgreSQL + SQLite dual-engine adapter
│   ├── image_to_3d.js ← AI image-to-3D generation (Meshy/Tripo API)
│   ├── migrate_to_postgres.js  ← One-time SQLite→PostgreSQL migrator
│   └── package.json
│
├── render.yaml        ← One-click Render.com backend deployment
├── vercel.json        ← Root Vercel config (points to frontend/)
└── .env.example       ← Environment variable template
```

---

## 🚀 Deployment Guide

### Step 1 — Set Up a Managed PostgreSQL Database

Choose any free tier:
- **[Neon](https://neon.tech)** — Free 512MB, serverless Postgres (recommended)
- **[Supabase](https://supabase.com)** — Free 500MB, includes storage
- **[Render PostgreSQL](https://render.com)** — Free 90 days

Copy the **connection string** (looks like `postgresql://user:pass@host/db?sslmode=require`).

---

### Step 2 — Deploy the Backend (Render.com)

**Option A: Blueprint (automatic)**
1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New** → **Blueprint**
3. Connect your repo — Render auto-reads `render.yaml`
4. Add environment variables in the dashboard (see below)

**Option B: Manual Web Service**
1. Go to Render → **New** → **Web Service**
2. Connect repo, set **Root Directory** to `backend`
3. Build: `npm install` | Start: `node server.js`

**Required environment variables on Render:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string |
| `JWT_SECRET` | Random 64-char hex (auto-generated or use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `FRONTEND_URL` | Your Vercel frontend URL (set after Step 3) |
| `DEFAULT_ADMIN_EMAIL` | `admin@yourstore.com` |
| `DEFAULT_ADMIN_PASSWORD` | Strong password |

> After deploying, copy the backend URL (e.g. `https://popcarty-backend.onrender.com`)

---

### Step 3 — Deploy the Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import repo
2. Set **Root Directory** to `frontend`
3. No build command needed (static site)
4. Add environment variable:
   - `VITE_API_URL` = your Render backend URL (e.g. `https://popcarty-backend.onrender.com`)
5. Deploy ✅

**Important**: After getting your Vercel URL, go back to Render and update `FRONTEND_URL` with it.

---

### Step 4 — (Optional) Migrate Existing Data

If you had data in a local SQLite file:

```bash
DATABASE_URL="postgresql://..." node backend/migrate_to_postgres.js
```

---

## 🔧 Local Development

```bash
# Install dependencies
npm install
cd backend && npm install && cd ..

# Start backend (SQLite fallback used automatically)
npm run dev:backend

# In a separate terminal — serve frontend
npm run dev:frontend
# Visit: http://localhost:3000
```

The backend defaults to SQLite at `data/popcarty.db` when `DATABASE_URL` is not set.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🎬 Cinematic Hero | 250-frame scroll-driven PNG animation sequence |
| 🌐 3D Product Viewer | Three.js + Google Model Viewer (GLB PBR models) |
| 🛒 Persistent Cart & Wishlist | Server-side, login-persisted |
| 📦 Order Management | Atomic stock decrement, immutable order snapshots |
| 🔐 Auth | HMAC-SHA256 JWT tokens, role-based (customer/admin) |
| 🗄️ Dual DB | PostgreSQL (production) / SQLite (development) |
| 🤖 AI 3D Generation | Image-to-3D via Meshy API (optional) |
| 🌙 Dark/Light Mode | Auto-detects system preference |
| 🌍 RTL Support | Arabic (Tajawal) + Malayalam (Manjari) |
| 📱 Responsive | Mobile-first design |

---

## 🔑 Admin Access

Default credentials (change immediately in production!):
- **Email**: `admin@popcarty.com`
- **Password**: `PopCarty@2026!`

Admin panel: `https://your-store.vercel.app/admin`

---

## 📖 API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/products` | List all active products |
| `POST /api/auth/register` | Register new customer |
| `POST /api/auth/login` | Login (returns JWT) |
| `GET /api/cart` | Get cart (auth required) |
| `POST /api/orders` | Place order (auth required) |
| `GET /api/admin/dashboard` | Admin stats (admin only) |
| `POST /api/admin/products` | Create product (admin only) |
| `GET /health` | Backend health check |

Full API documentation: see [`BACKEND_DOCUMENTATION.md`](./BACKEND_DOCUMENTATION.md)
