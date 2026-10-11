import { getServices } from "@/server/store";
import { getFinanceSummary, getReclaimQueue } from "@/server/queries";
import { avgCostPerSpendingHire, budgetBurnDown, burnDelta, cumulativeRecurringBurn, recurringAddedSince } from "@/lib/finance";
import { Kpi, Meter, PageHead, Shell } from "../_components/Shell";
import { money, teamLabel, timeAgo } from "../_components/format";

export const dynamic = "force-dynamic";

const COST_TYPE_LABEL = { none: "—", one_time: "one-time", recurring: "recurring" } as const;

/** Finance overview (design 2c): burn, budgets, live ledger. */
export default async function FinanceOverview() {
  const { repo } = await getServices();
  const [{ summary, budgets }, reclaim, entries, hires] = await Promise.all([
    getFinanceSummary(),
    getReclaimQueue(),
    repo.ledgerEntries.list(),
    repo.hires.list(),
  ]);
  const hireById = new Map(hires.map((h) => [h.id, h]));

  // Start of the local day — so "today" tracks the viewer's timezone, not UTC.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const burnToday = recurringAddedSince(entries, startOfToday);

  const spendingHires = hires.filter((h) => entries.some((e) => e.hireId === h.id));
  const avgPerHire = avgCostPerSpendingHire(entries, hires.map((h) => h.id));

  const recent = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  // Recurring burn trend ("costs growing over time") + period-over-period deltas.
  const burnSeries = cumulativeRecurringBurn(entries);
  const mom = burnDelta(burnSeries, 1);
  const yoy = burnDelta(burnSeries, 12);
  const maxBurn = Math.max(1, ...burnSeries.map((p) => p.burn));
  const fmtDelta = (d: { absolute: number; pct: number }) =>
    `${d.absolute >= 0 ? "+" : "−"}${money(Math.abs(Math.round(d.absolute)))} (${d.pct >= 0 ? "+" : "−"}${Math.abs(Math.round(d.pct * 100))}%)`;
  const monthLabel = (key: string) =>
    new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const monthYearLabel = (key: string) =>
    new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

  // Eyebrow reflects the actual data range, not a hardcoded budget period, so
  // the header can't claim a quarter the trend data spills outside of.
  const first = burnSeries[0]?.month;
  const last = burnSeries[burnSeries.length - 1]?.month;
  const periodLabel = !first
    ? (budgets[0]?.period ?? "onboarding")
    : first === last
      ? monthYearLabel(first)
      : `${monthYearLabel(first)} – ${monthYearLabel(last!)}`;

  return (
    <Shell active="/finance">
      <PageHead eyebrow={`${periodLabel} · onboarding spend`} title="Where the money's going" />
      <div className="kpis">
        <Kpi
          label="Recurring burn"
          value={money(Math.round(summary.recurringMonthlyBurn))}
          unit="/mo"
          sub={
            mom.comparable
              ? `${fmtDelta(mom)} MoM`
              : burnToday === 0
                ? "no change today"
                : `${burnToday > 0 ? "+" : ""}${money(burnToday)} today`
          }
        />
        <Kpi
          label="Total spend"
          value={money(Math.round(summary.totalSpend))}
          sub={`${spendingHires.length} hires with spend`}
        />
        <Kpi label="Avg cost per hire" value={money(Math.round(avgPerHire))} sub="seats + hardware + fees" />
        <Kpi
          label="Reclaimable"
          value={money(Math.round(reclaim.monthly))}
          unit="/mo"
          sub={`${reclaim.rows.reduce((a, r) => a + r.licenseIds.length, 0)} seats · ${summary.assetsOnHand} assets on hand`}
          tone="good"
        />
      </div>
      <div className="split">
        <section className="panel">
          <span className="panel-title">Budget burn-down</span>
          {budgets.map((b) => {
            const ratio = budgetBurnDown(b);
            const hot = ratio >= 0.9;
            return (
              <Meter
                key={b.id}
                label={teamLabel(b.team)}
                value={`${money(Math.round(b.spent))} of ${money(b.limit)}`}
                pct={ratio * 100}
                hot={hot}
                note={ratio > 1 ? "Over budget" : hot ? `${Math.round(ratio * 100)}% used` : undefined}
              />
            );
          })}
        </section>
        <section className="panel" style={{ gap: 6 }}>
          <div className="panel-head" style={{ paddingBottom: 6 }}>
            <span className="panel-title">Live ledger</span>
            <span className="tag tag-accent-2">● Live</span>
          </div>
          {recent.length === 0 && (
            <span className="empty">No ledger activity yet. Grant a seat or raise a PO from a team queue.</span>
          )}
          <div className="rows">
            {recent.map((e) => (
              <div key={e.id} className="row row-ledger">
                <div className="who-text">
                  <span className="who-name">{e.label}</span>
                  <span className="who-sub">
                    {(e.hireId && hireById.get(e.hireId)?.name) || "—"} · {timeAgo(e.createdAt)}
                  </span>
                </div>
                <span className={e.amount < 0 ? "amt amt-credit" : "amt"}>
                  {e.amount > 0 ? "+" : ""}
                  {money(e.amount)}
                  {e.costType === "recurring" ? "/mo" : ""}
                  <span className="amt-type">{e.amount < 0 ? "credit" : COST_TYPE_LABEL[e.costType]}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head" style={{ paddingBottom: 6 }}>
          <span className="panel-title">Recurring burn trend</span>
          <span style={{ display: "flex", gap: 6 }}>
            {mom.comparable && (
              <span className={mom.absolute >= 0 ? "tag" : "tag tag-accent-2"}>
                {fmtDelta(mom)} MoM
              </span>
            )}
            {yoy.comparable && (
              <span className={yoy.absolute >= 0 ? "tag" : "tag tag-accent-2"}>
                {fmtDelta(yoy)} YoY
              </span>
            )}
          </span>
        </div>
        {burnSeries.length === 0 && (
          <span className="empty">No recurring spend yet. Grant a seat to start the burn.</span>
        )}
        {burnSeries.map((p) => (
          <Meter
            key={p.month}
            label={monthLabel(p.month)}
            value={`${money(Math.round(p.burn))}/mo`}
            pct={(p.burn / maxBurn) * 100}
          />
        ))}
      </section>
    </Shell>
  );
}
