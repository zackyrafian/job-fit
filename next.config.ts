import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // impit memakai binary native (impit-<platform>) untuk TLS impersonation;
  // jangan dibundle, biar di-require dari node_modules saat runtime.
  serverExternalPackages: ["impit"],
};

export default nextConfig;
