import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headers: serve manifest and SW with no-cache so browsers always get fresh copies
  async headers() {
    return [
      {
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Content-Type",  value: "application/manifest+json" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Content-Type",  value: "application/javascript" },
        ],
      },
    ];
  },
};

export default nextConfig;
