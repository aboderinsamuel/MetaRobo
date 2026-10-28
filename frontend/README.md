# RoboCraft web app

Next.js 16 (App Router) + React Three Fiber + Tailwind CSS v4. See
[`../README.md`](../README.md) for the full project overview.

```bash
npm install
npm run dev          # http://localhost:3000, expects the API on http://127.0.0.1:8000
npm run lint
npm run typecheck
npm run build
```

Outside Vercel, `BACKEND_URL` sets where `/api/*` (except the lab's own `/api/lab/*`) is proxied to;
it is read at build time. On Vercel the root `vercel.json` routes `/api/*` to the backend service instead.

Code map:

- `src/app/`: the landing page and `studio/[template]`.
- `src/components/studio/`:
  - panels: parameters (generated from the API's template spec), pose, insights tabs;
  - the wiring diagram renderer;
  - the code viewer.
- `src/components/viewport/`: the 3D scene. The robot models use a Z-up robot frame, the
  same frame as the backend maths.
- `src/lib/`:
  - the typed API client;
  - the zustand store;
  - data hooks (debounced analysis, latest-wins pose requests, code generation);
  - playback interpolation.
