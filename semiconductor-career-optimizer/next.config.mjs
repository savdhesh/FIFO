/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdfkit", "pdf-parse", "mammoth", "@prisma/client"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Cache-Control", value: "private, no-store" },
    ] }];
  },
};
export default nextConfig;
