import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The proposal PDF renders in a server-side Chromium (lib/pdfRender.ts).
  // Both packages load native files at run time, so they stay out of the
  // bundle, and the compressed browser in @sparticuz/chromium/bin is shipped
  // with the one route that uses it.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  outputFileTracingIncludes: {
    '/api/proposals/**/*': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
  async redirects() {
    // Route renames — keeps old bookmarks, previously-sent login-link emails
    // and Spotlight recents resolving. History:
    //   /insert → /catalog → /purchasing        (buy-side workspace)
    //   /database → /insights → /spend-cash     (spend analytics)
    //   /economics → /profitability             (item economics)
    //   /data → /import-export                  (bulk CSV)
    //   /quotes → /proposals                    (EPC Proposals rename)
    // 2026-07-30: URLs now match the menu titles. Query strings (?tab=…&q=…)
    // are preserved by Next automatically, so old deep links keep their tab.
    return [
      { source: "/insert", destination: "/purchasing", permanent: true },
      { source: "/insert/:path*", destination: "/purchasing/:path*", permanent: true },
      { source: "/catalog", destination: "/purchasing", permanent: true },
      { source: "/catalog/:path*", destination: "/purchasing/:path*", permanent: true },
      { source: "/database", destination: "/spend-cash", permanent: true },
      { source: "/database/:path*", destination: "/spend-cash/:path*", permanent: true },
      { source: "/insights", destination: "/spend-cash", permanent: true },
      { source: "/insights/:path*", destination: "/spend-cash/:path*", permanent: true },
      { source: "/economics", destination: "/profitability", permanent: true },
      { source: "/economics/:path*", destination: "/profitability/:path*", permanent: true },
      { source: "/data", destination: "/import-export", permanent: true },
      { source: "/data/:path*", destination: "/import-export/:path*", permanent: true },
      { source: "/quotes", destination: "/proposals", permanent: true },
      { source: "/quotes/:path*", destination: "/proposals/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
