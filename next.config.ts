import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  experimental: { optimizePackageImports: ["lucide-react", "motion"] },

  /**
   * `node:sqlite` is a Node builtin that webpack does not yet know about, so it
   * gets stubbed out unless declared external. Marking it here makes the bundle
   * emit `require("node:sqlite")` verbatim and hand it straight to Node.
   */
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...externals, { "node:sqlite": "commonjs node:sqlite" }];
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
