/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Tree-shake lucide icon imports across the dashboard client graph.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async redirects() {
    return [
      {
        source: "/dashboard/analytics",
        destination: "/dashboard/pay",
        permanent: true,
      },
    ]
  },
}

export default nextConfig
