/**
 * Paths that the OAuth flow redirects to.
 *
 * Better Auth appends `?error=<code>` to the error URL, so these paths must
 * stay in sync with the routes registered in `app/app/routes.ts`. `AUTH_ERROR_PATH`
 * has the leading slash that a redirect target needs; `AUTH_ERROR_ROUTE` is the
 * relative form that the route table accepts.
 */
export const AUTH_ERROR_ROUTE = "auth/error";

export const AUTH_ERROR_PATH = `/${AUTH_ERROR_ROUTE}`;
