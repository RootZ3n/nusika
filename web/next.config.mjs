/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No image optimization for now — nusika doesn't ship hero imagery yet.
  images: { unoptimized: true },
};

export default nextConfig;
