import Link from "next/link";
import { redirect } from "next/navigation";
import { hireProgress, toHireChecklist } from "@/lib/progress";
import { currentSession } from "@/server/auth";
import { getFinanceSummary, getLedgerFeed, getReclaimQueue } from "@/server/queries";
import { getServices } from "@/server/store";
import { OFFBOARDING_COHORT } from "@/data/seed";
import { Kpi, Meter, PageHead, Shell } from "../_components/Shell";
import { money, shortDate, teamLabel, timeAgo } from "../_components/format";

export const dynamic = "force-dynamic";

/** Home dashboard (login-home spec AC #9): one page, a view per viewing role. */
export default async function Home() {
  const session = await currentSession();
  if (!session) redirect("/login");

  const first = session.name.split(" ")[0];
  return (
    <Shell active="/home">
      {session.viewAs === "admin" && <AdminHome first={first} />}
      {session.viewAs === "manager" && <ManagerHome first={first} />}
      {session.viewAs === "employee" && session.hireId && <EmployeeHome hireId={session.hireId} />}
    </Shell>
  );
}

async function AdminHome({ first }: { first: string | undefined }) {
  const { repo } = await getServices();
  const [{ summary }, reclaim, { entries }, hires, tasks] = await Promise.all([
    getFinanceSummary(),
    getReclaimQueue(),
    getLedgerFeed(5),
    repo.hires.list(),
    repo.tasks.list(),
  ]);
  const active = hires.filter((h) => h.cohort !== OFFBOARDING_COHORT);
  const rows = active
    .map((hire) => ({ hire, progress: hireProgress(tasks.filter((t) => t.hireId === hire.id)) }))
    .sort((a, b) => Number(b.progress.blocked) - Number(a.progress.blocked) || a.progress.pct - b.progress.pct);
  const blockedTasks = tasks.filter((t) => t.status === "blocked").length;

  return (
    <>
      <PageHead eyebrow="Admin · overview" title={`Welcome back, ${first ?? "there"}`} />
      <div className="kpis">
        <Kpi label="Active hires" value={active.length} sub={`${hires.length - active.length} offboarding`} />
        <Kpi label="Recurring burn" value={money(Math.round(summary.recurringMonthlyBurn))} unit="/mo" />
        <Kpi label="Reclaimable" value={money(Math.round(reclaim.monthly))} unit="/mo" tone="good" />
        <Kpi label="Blocked tasks" value={blockedTasks} tone={blockedTasks > 0 ? "warn" : undefined} />
      </div>
      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Hire progress</span>
            <Link href="/specialist/hires">All hires</Link>
          </div>
          {rows.map(({ hire, progress }) => (
            <Meter
              key={hire.id}
              label={hire.name}
              value={`${progress.done} of ${progress.total}`}
              pct={progress.pct}
              hot={progress.blocked}
              note={progress.blocked ? `Blocked: ${progress.next?.title ?? ""}` : undefined}
            />
          ))}
        </section>
        <section className="panel" style={{ gap: 6 }}>
          <div className="panel-head">
            <span className="panel-title">Recent ledger</span>
            <Link href="/finance">Finance</Link>
          </div>
          {entries.length === 0 && <span className="empty">No ledger activity yet.</span>}
          <div className="rows">
            {entries.map((e) => (
              <div key={e.id} className="row row-ledger">
                <div className="who-text">
                  <span className="who-name">{e.label}</span>
                  <span className="who-sub">
                    {e.hireName ?? "—"} · {timeAgo(e.createdAt)}
                  </span>
                </div>
                <span className={e.amount < 0 ? "amt amt-credit" : "amt"}>
                  {e.amount > 0 ? "+" : ""}
                  {money(e.amount)}
                  {e.costType === "recurring" ? "/mo" : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

/** No costs: a manager reports on progress, not spend. */
async function ManagerHome({ first }: { first: string | undefined }) {
  const { repo } = await getServices();
  const [manager] = await repo.users.where((u) => u.role === "manager");
  const hires = manager ? await repo.hires.where((h) => h.managerId === manager.id) : [];
  const tasks = await repo.tasks.list();
  const rows = hires
    .map((hire) => ({ hire, progress: hireProgress(tasks.filter((t) => t.hireId === hire.id)) }))
    .sort((a, b) => a.hire.startDate.localeCompare(b.hire.startDate));
  const ready = rows.filter((r) => r.progress.total > 0 && r.progress.done === r.progress.total).length;
  const blocked = rows.filter((r) => r.progress.blocked).length;

  return (
    <>
      <PageHead eyebrow="Manager · your team" title={`Welcome back, ${first ?? "there"}`} />
      <div className="kpis">
        <Kpi label="Your hires" value={rows.length} />
        <Kpi label="Ready for day one" value={ready} tone="good" />
        <Kpi label="Blocked" value={blocked} tone={blocked > 0 ? "warn" : undefined} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">Onboarding progress</span>
          <Link href="/manager">My hires</Link>
        </div>
        {rows.length === 0 && <span className="empty">No hires yet.</span>}
        {rows.map(({ hire, progress }) => (
          <Meter
            key={hire.id}
            label={`${hire.name} · starts ${shortDate(hire.startDate)}`}
            value={`${progress.pct}%`}
            pct={progress.pct}
            hot={progress.blocked}
            note={progress.next ? `${progress.blocked ? "Blocked" : "Up next"}: ${progress.next.title}` : "All set for day one"}
          />
        ))}
      </section>
    </>
  );
}

/** No costs: everything rendered comes from toHireChecklist, which has no cost fields. */
async function EmployeeHome({ hireId }: { hireId: string }) {
  const { repo } = await getServices();
  const hire = await repo.hires.get(hireId);
  if (!hire) return <span className="empty">We couldn&apos;t find your onboarding record.</span>;
  const list = toHireChecklist(hire, await repo.tasks.where((t) => t.hireId === hire.id));
  const pct = list.total === 0 ? 0 : Math.round((list.done / list.total) * 100);
  const upcoming = list.items.filter((i) => i.status !== "done").slice(0, 3);

  return (
    <>
      <PageHead eyebrow={`${list.hire.roleName} · starts ${shortDate(list.hire.startDate)}`} title={`Hi, ${list.hire.name.split(" ")[0]}`} />
      <div className="kpis">
        <Kpi label="Checklist" value={`${pct}%`} sub={`${list.done} of ${list.total} done`} tone={pct === 100 ? "good" : undefined} />
        <Kpi label="Left to do" value={list.total - list.done} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">Up next</span>
          <Link href="/myonboarding">Full checklist</Link>
        </div>
        {upcoming.length === 0 && <span className="empty">You&apos;re all set for day one.</span>}
        <div className="rows">
          {upcoming.map((item) => (
            <div key={item.id} className="row-check">
              <span className="check-dot" />
              <span className="check-title">{item.title}</span>
              <span className="who-sub">{teamLabel(item.ownerTeam)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
