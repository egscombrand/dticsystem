import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Folder build dapat dipisah (mis. E2E memakai .next-e2e) agar tidak bertabrakan dengan `next dev` yang sedang berjalan.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    agentUpgrade: "security",
  },
  // Form pengajuan client kini di halaman utama `/`; alamat lama tetap berfungsi.
  async redirects() {
    // Alamat lama area internal dialihkan ke /dtic/*; /ajukan ke form pengajuan di `/`.
    return [
      { source: "/ajukan", destination: "/", permanent: false },
      { source: "/dashboard", destination: "/dtic/dashboard", permanent: false },
      { source: "/orders", destination: "/dtic/orders", permanent: false },
      { source: "/orders/:path*", destination: "/dtic/orders/:path*", permanent: false },
      { source: "/workboard", destination: "/dtic/workboard", permanent: false },
      { source: "/calendar", destination: "/dtic/calendar", permanent: false },
      { source: "/settings", destination: "/dtic/settings", permanent: false },
      { source: "/settings/:path*", destination: "/dtic/settings/:path*", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
