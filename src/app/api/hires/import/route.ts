import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import { defaultIdGenerator } from "@/lib/ids";
import type { Hire } from "@/lib/types";

interface ImportRow {
  name: string;
  email: string;
  roleName: string;
  startDate: string;
  managerId?: string | null;
  cohort?: string | null;
  /** App ids to grant as active licenses on import. */
  appIds?: string[];
}

/**
 * POST /api/hires/import — bulk create hires and auto-instantiate tasks +
 * licenses from the matching role template.
 *
 * Body: { rows: ImportRow[] }. A row's template is matched by roleName.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { rows?: ImportRow[] };
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json(
      { error: "rows must be a non-empty array" },
      { status: 400 },
    );
  }

  const { repo, templates } = await getServices();
  const created: {
    hire: Hire;
    taskCount: number;
    licenseCount: number;
    deferredCount: number;
    deferred: { appId: string; appName: string }[];
  }[] = [];

  for (const row of body.rows) {
    if (!row.name || !row.email || !row.roleName || !row.startDate) {
      return NextResponse.json(
        { error: "each row needs name, email, roleName, startDate" },
        { status: 400 },
      );
    }

    const hire: Hire = {
      id: defaultIdGenerator(),
      name: row.name,
      email: row.email,
      roleName: row.roleName,
      managerId: row.managerId ?? null,
      startDate: row.startDate,
      cohort: row.cohort ?? null,
    };
    await repo.hires.insert(hire);

    const [template] = await repo.templates.where(
      (t) => t.roleName === row.roleName,
    );

    let taskCount = 0;
    let licenseCount = 0;
    let deferred: { appId: string; appName: string }[] = [];
    if (template) {
      const result = await templates.instantiateForHire(
        hire.id,
        template.id,
        row.appIds ?? [],
      );
      taskCount = result.tasks.length;
      licenseCount = result.licenses.length;
      deferred = result.deferred;
    }

    created.push({
      hire,
      taskCount,
      licenseCount,
      deferredCount: deferred.length,
      deferred,
    });
  }

  return NextResponse.json({ created }, { status: 201 });
}
