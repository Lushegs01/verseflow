import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  experimental: { optimizePackageImports: ["lucide-react", "motion"] },

  /**
   * Database drivers must not be bundled.
   *
   * PGlite ships a WASM build with its own Node filesystem shim; webpack rewrites
   * the module paths and the shim then receives a URL where it expects a string.
   * `pg` similarly resolves optional native extras at runtime. Leaving both
   * external hands them to Node untouched.
   */
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
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
