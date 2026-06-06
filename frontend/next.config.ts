import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 blocks cross-origin requests to dev assets by default.
  // Allow access via the server's Tailscale and LAN addresses in dev.
  allowedDevOrigins: ["100.117.10.28", "192.168.1.54"],
};

export default nextConfig;
