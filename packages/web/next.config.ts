import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
  ],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001"}/api/v1/:path*`,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
        url: false,
      };
    }
    return config;
  },
};

export default nextConfig;
