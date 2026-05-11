import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);
const isAdminLogin = createRouteMatcher(["/admin/login"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // Allow the login page through regardless of auth state.
  if (isAdminLogin(request)) return;

  if (isAdminRoute(request)) {
    const authed = await convexAuth.isAuthenticated();
    if (!authed) return nextjsMiddlewareRedirect(request, "/admin/login");
  }
});

export const config = {
  // The library needs to see all requests so it can refresh the session cookie
  // and serve the /api/auth route — match everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
