import type { NextConfig } from "next";

// The browser calls the FastAPI engines on the same origin under /api, so there is no CORS setup.
// On Vercel the project's services routing (vercel.json at the repo root) sends /api/* to the
// backend service before requests reach Next, except /api/lab/*, which this app serves itself.
// Elsewhere (npm run dev, Docker) Next proxies /api/* to BACKEND_URL; its own /api/lab routes
// still win because filesystem routes are matched before these rewrites.
const onVercel = Boolean(process.env.VERCEL);
const backend = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Vercel packages the app itself; the standalone server is for the Docker image.
  output: onVercel ? undefined : "standalone",
  async rewrites() {
    return onVercel ? [] : [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
