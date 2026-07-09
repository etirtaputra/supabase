import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Route renames: /insert → /catalog, /database → /insights.
    // Keeps old bookmarks and previously-sent login-link emails working.
    return [
      { source: "/insert", destination: "/catalog", permanent: true },
      { source: "/insert/:path*", destination: "/catalog/:path*", permanent: true },
      { source: "/database", destination: "/insights", permanent: true },
      { source: "/database/:path*", destination: "/insights/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
