/** @type {import('next').NextConfig} */
const defaultApiBaseUrl = process.env.NODE_ENV === "production"
  ? "https://server-gray-iota.vercel.app"
  : "http://localhost:4000";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? defaultApiBaseUrl)
  .trim()
  .replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
