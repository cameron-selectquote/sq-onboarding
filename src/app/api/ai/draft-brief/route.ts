import {NextResponse} from 'next/server';
import {getServices} from '@/server/store';

/**
 * POST /api/ai/draft-brief — a hire's onboarding state -> a thorough welcome
 * brief.
 *
 * Body: { hireId: string }. Gathers what's actually set up for the hire —
 * granted seats, provisioned hardware, completed account tasks, and anything
 * still outstanding — plus their role and start date, and hands it all to the
 * AiClient. The brief view renders the returned blurbs. One welcome, not one
 * per tool.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {hireId?: string};

  if (!body.hireId) {
    return NextResponse.json({error: 'hireId is required'}, {status: 400});
  }

  const {repo, ai} = await getServices();

  const hire = await repo.hires.get(body.hireId);
  if (!hire) {
    return NextResponse.json({error: 'Hire not found'}, {status: 404});
  }

  const [licenses, apps, assets, assetCatalog, tasks] = await Promise.all([
    repo.licenses.where((l) => l.hireId === hire.id && l.status === 'active'),
    repo.appCatalog.list(),
    repo.assets.where((a) => a.assignedToHireId === hire.id),
    repo.assetCatalog.list(),
    repo.tasks.where((t) => t.hireId === hire.id),
  ]);

  const appNameById = new Map(apps.map((a) => [a.id, a.name]));
  const appNames = licenses
    .map((l) => appNameById.get(l.appId))
    .filter((name): name is string => Boolean(name));

  const assetNameById = new Map(assetCatalog.map((a) => [a.id, a.name]));
  const hardwareNames = assets
    .filter((a) => a.status === 'assigned')
    .map((a) => assetNameById.get(a.catalogId))
    .filter((name): name is string => Boolean(name));

  // Completed admin/account tasks (email/SSO, HR paperwork) read as "done".
  const completedSetup = tasks
    .filter(
      (t) =>
        t.status === 'done' && t.appId === null && t.costType !== 'one_time',
    )
    .map((t) => t.title);

  // Tasks still open (blocked/todo) that a person owns — surfaced as pending.
  const pending = tasks
    .filter((t) => t.status === 'blocked')
    .map((t) => t.title);

  const blurbs = await ai.draftBrief({
    hireName: hire.name,
    appNames,
    roleName: hire.roleName,
    startDate: hire.startDate,
    hardwareNames,
    completedSetup,
    pending,
  });
  return NextResponse.json({blurbs});
}
