/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server in .next/standalone (server.js + only the traced
  // node_modules, incl. the better-sqlite3 binary) for the Akamai deploy.
  output: "standalone",
};

module.exports = nextConfig;
