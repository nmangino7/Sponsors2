/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "35mb",
    },
  },
};
module.exports = nextConfig;
