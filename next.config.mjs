/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker image
  // for a persistent host stays small and needs no node_modules at runtime.
  output: "standalone",

  experimental: {
    serverActions: {
      // Server Actions cap request bodies at 1 MB by default, which is smaller
      // than the files this portal legitimately accepts — a phone photo of a
      // certificate is routinely 4–8 MB. Under that ceiling Next rejects the
      // request before our own action runs, so our friendly size message never
      // fires and the user just sees "a server error occurred". Raised to sit
      // above MAX_CERT_BYTES (lib/certs.js) so our own validation speaks first.
      //
      // Profile photos are cropped to 512×512 in the browser before upload
      // (components/AvatarCropper.js) and arrive under ~200 KB whatever the
      // original was, so this headroom is really for certificates.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
