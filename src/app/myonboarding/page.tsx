import { notFound } from "next/navigation";
import { getServices } from "@/server/store";
import { toHireChecklist, type HireChecklist } from "@/lib/progress";
import { Avatar, Shell } from "../_components/Shell";
import { longDate, teamLabel } from "../_components/format";

export const dynamic = "force-dynamic";

/**
 * Cost-free data fetch for the new-hire page (role-views AC #4). Everything
 * the page renders comes out of toHireChecklist, which has no cost fields.
 */
async function loadChecklist(hireId: string | undefined): Promise<{ list: HireChecklist; managerName: string | null } | null> {
  const { repo } = await getServices();
  const hire = hireId ? await repo.hires.get(hireId) : (await repo.hires.list())[0];
  if (!hire) return null;
  const tasks = await repo.tasks.where((t) => t.hireId === hire.id);
  const manager = hire.managerId ? await repo.users.get(hire.managerId) : null;
  return { list: toHireChecklist(hire, tasks), managerName: manager?.name ?? null };
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** New-hire checklist (design 2i; 2h layout on narrow screens). No costs. */
export default async function MyOnboarding({ searchParams }: { searchParams: Promise<{ hire?: string }> }) {
  const { hire: hireId } = await searchParams;
  const data = await loadChecklist(hireId);
  if (!data) notFound();
  const { list, managerName } = data;
  const first = list.hire.name.split(" ")[0];
  const left = list.total - list.done;
  const next = list.items.find((i) => i.status !== "done");

  return (
    <Shell nav={[{ href: `/myonboarding?hire=${list.hire.id}`, label: "My onboarding" }]} active={`/myonboarding?hire=${list.hire.id}`} whoLabel="Signed in as" who={list.hire.name}>
      <span className="blob" aria-hidden />
      <div className="hire-layout">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="head-text" style={{ gap: 6 }}>
            <span className="eyebrow">
              {list.hire.roleName} · starts {longDate(list.hire.startDate)}
            </span>
            <h1 className="title" style={{ fontSize: 36, lineHeight: 1.05 }}>
              {left === 0 ? (
                <>You're all set, {first}.</>
              ) : (
                <>
                  Almost there, {first}.
                  <br />
                  {left === 1 ? "One thing left." : `${left} things left.`}
                </>
              )}
            </h1>
          </div>
          <section className="panel" style={{ gap: 0, padding: "10px 20px" }}>
            {list.items.length === 0 && <span className="empty">Your checklist is on its way.</span>}
            {list.items.map((item) => {
              const done = item.status === "done";
              return (
                <div key={item.id} className="row-check">
                  <span className={done ? "check-dot is-done" : "check-dot"}>{done && <Check />}</span>
                  <span className={done ? "check-title is-done" : "check-title"}>{item.title}</span>
                  <span className="who-sub">{teamLabel(item.ownerTeam)}</span>
                </div>
              );
            })}
          </section>
        </div>
        <div className="hire-rail">
          {next && (
            <section className="turn">
              <span className="turn-kicker">Up next</span>
              <span className="turn-title">{next.title}</span>
              <span style={{ fontSize: 13 }}>{teamLabel(next.ownerTeam)} is on it. We'll let you know when it's done.</span>
            </section>
          )}
          <section className="panel" style={{ padding: 20, gap: 12 }}>
            <span className="panel-title" style={{ fontSize: 18 }}>Your people</span>
            {managerName ? (
              <div className="who" style={{ gap: 12 }}>
                <Avatar name={managerName} size="lg" />
                <div className="who-text">
                  <span className="who-name">{managerName}</span>
                  <span className="who-sub">Your manager</span>
                </div>
              </div>
            ) : (
              <span className="empty">We'll introduce your manager soon.</span>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}
