const { SECURITY_HEADERS } = require('./lib/security/securityHeaders');

const nextConfig = {
  output: 'standalone',
  // Do not advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/*': ['./memory/SYSTEM_PROMPT.md'],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com', pathname: '/**' },
      { protocol: 'https', hostname: 'images.unsplash.com', pathname: '/**' },
    ],
  },
  // Renamed from experimental.serverComponentsExternalPackages in Next 15
  serverExternalPackages: ['mongodb'],
  webpack(config, { dev }) {
    if (dev) {
      // Reduce CPU/memory from file watching
      config.watchOptions = {
        poll: 2000, // check every 2 seconds
        aggregateTimeout: 300, // wait before rebuilding
        ignored: ['**/node_modules'],
      };
    }
    return config;
  },
  onDemandEntries: {
    maxInactiveAge: 10000,
    pagesBufferLength: 2,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        // No Access-Control-* headers here: the API decides CORS per request
        // (lib/security/originPolicy.ts), and pages need none.
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;
