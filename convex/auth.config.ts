// JWT issuer config — required for ctx.auth.getUserIdentity() to work.
// @convex-dev/auth uses the Convex deployment itself as the issuer; CONVEX_SITE_URL
// is set automatically by `npx convex dev`.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
