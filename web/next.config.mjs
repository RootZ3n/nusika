/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No image optimization for now — magister doesn't ship hero imagery yet.
  images: { unoptimized: true },
};

export default nextConfig;
