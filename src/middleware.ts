import {NextResponse, type NextRequest} from 'next/server';
import {publicUrl} from '@/lib/public-url';
import {canCallApi, canOpenPath, homePathFor} from '@/lib/access';
import {SESSION_COOKIE} from '@/lib/session';
import {readSession} from '@/server/auth';

/**
 * Reachable without a session. `/api/session/view-as` does its own admin
 * check, so an admin viewing as an employee (no API access) can switch back.
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/api/session',
  '/api/session/logout',
  '/api/session/view-as',
  '/api/health',
]);

/**
 * Deny-by-default gate for every page and API route.
 * - No valid session: pages redirect to /login, APIs return 401.
 * - Signed in: access follows the *viewing* role (lib/access.ts); an employee
 *   is limited to home + their checklist and gets 403 from every API.
 */
export async function middleware(req: NextRequest) {
  const {pathname, search} = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith('/api/');
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (isApi)
      return NextResponse.json({error: 'Not signed in'}, {status: 401});
    const login = publicUrl('/login', req);
    if (pathname !== '/') login.searchParams.set('next', pathname + search);
    return NextResponse.redirect(login);
  }

  if (isApi) {
    // The Genie API is role-scoped server-side (see resolveGenieContext): every
    // signed-in role gets its own agent, and the employee/manager tools never
    // return costs. So it's allowed for any authenticated user, even though the
    // cost-bearing REST API stays admin-only.
    if (pathname === '/api/genie') return NextResponse.next();
    return canCallApi(session.viewAs) ?
        NextResponse.next()
      : NextResponse.json({error: 'Forbidden'}, {status: 403});
  }

  if (pathname === '/' || !canOpenPath(session.viewAs, pathname)) {
    return NextResponse.redirect(publicUrl(homePathFor(session.viewAs), req));
  }
  return NextResponse.next();
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
