/** @type {import('next').NextConfig} */
const repo = "VT-MultiTeam-Scheduler";

const nextConfig = {
  output: "export",          // builds a static site into /out
  trailingSlash: true,       // GitHub Pages likes /path/ not /path
  basePath: `/${repo}`,      // IMPORTANT: repo name
  assetPrefix: `/${repo}/`,  // ensures JS/CSS load from the right path
  images: { unoptimized: true } // required for static export
};

export default nextConfig;
