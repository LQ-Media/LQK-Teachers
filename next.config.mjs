/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker image
  // for a persistent host stays small and needs no node_modules at runtime.
  output: "standalone",
};

export default nextConfig;
