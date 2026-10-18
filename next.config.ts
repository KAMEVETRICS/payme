import type { NextConfig } from "next";

const securityHeaders = [
  // Nobody may frame Payer's pages (clickjacking). Circle's own windows are framed
  // inside Payer, which this does not affect.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const config: NextConfig = {
  poweredByHeader: false,
  // Circle's server SDKs use Node APIs and must not be bundled.
  serverExternalPackages: ["@circle-fin/developer-controlled-wallets", "@circle-fin/user-controlled-wallets"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
