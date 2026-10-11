import { getServices } from "@/server/store";
import { getBudgetVsActual, getFinanceSummary, getReclaimQueue } from "@/server/queries";
import { avgCostPerSpendingHire, budgetBurnDown, burnDelta, cumulativeRecurringBurn, recurringAddedSince } from "@/lib/finance";
import { Kpi, Meter, PageHead, Shell } from "../_components/Shell";
import { money, teamLabel, timeAgo } from "../_components/format";

export const dynamic = "force-dynamic";

const COST_TYPE_LABEL = { none: "—", one_time: "one-time", recurring: "recurring" } as const;

/** Finance overview (design 2c): burn, budgets, live ledger. */
export default async function FinanceOverview() {
  const { repo } = await getServices();
  const [{ summary, budgets }, reclaim, entries, hires, bvaResult] = await Promise.all([
    getFinanceSummary(),
    getReclaimQueue(),
    repo.ledgerEntries.list(),
    repo.hires.list(),
    getBudgetVsActual(),
  ]);
  const { bva, reclaim: bvaReclaim } = bvaResult;
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
          sub={
            reclaim.oneTimeAsset > 0
              ? `${reclaim.rows.reduce((a, r) => a + r.licenseIds.length, 0)} seats · ${money(Math.round(reclaim.oneTimeAsset))} one-time asset residual`
              : `${reclaim.rows.reduce((a, r) => a + r.licenseIds.length, 0)} seats`
          }
          tone="good"
        />
      </div>
      <section className="panel">
        <div className="panel-head" style={{ paddingBottom: 6 }}>
          <span className="panel-title">Budget vs actual vs forecast · {bva.quarter}</span>
          <span style={{ display: "flex", gap: 6 }}>
            <span className={bva.varianceToDate > 0 ? "tag tag-accent-2" : "tag"}>
              {bva.varianceToDate >= 0 ? "+" : "−"}{money(Math.abs(Math.round(bva.varianceToDate)))} vs plan to date
            </span>
            <span className={bva.projectedVariance > 0 ? "tag tag-accent-2" : "tag"}>
              {bva.projectedVariance >= 0 ? "projected +" : "projected −"}{money(Math.abs(Math.round(bva.projectedVariance)))} at quarter end
            </span>
          </span>
        </div>
        <span className="meter-note" style={{ paddingBottom: 4 }}>
          {bva.projectedVariance > 0
            ? `On the current run-rate, spend is projected to finish ${money(Math.round(bva.projectedVariance))} over the ${money(bva.budget)} budget${bva.crossoverMonth ? `, crossing the line in ${monthLabel(bva.crossoverMonth)}` : ""}.`
            : `On the current run-rate, spend is projected to finish ${money(Math.abs(Math.round(bva.projectedVariance)))} under the ${money(bva.budget)} budget.`}
        </span>
        {bva.projectedVariance > 0 && bvaReclaim.reclaimableMonthly > 0 && (
          <div
            className={bvaReclaim.bringsUnderBudget ? "banner" : undefined}
            style={bvaReclaim.bringsUnderBudget ? { marginTop: 4 } : { marginTop: 4 }}
          >
            <span className="meter-note">
              {bvaReclaim.bringsUnderBudget
                ? `Reclaim the ${money(Math.round(bvaReclaim.reclaimableMonthly))}/mo of idle seats and you recover ${money(Math.round(bvaReclaim.quarterSavings))} this quarter — back under budget with ${money(Math.abs(Math.round(bvaReclaim.projectedVarianceAfter)))} to spare.`
                : `Reclaiming the ${money(Math.round(bvaReclaim.reclaimableMonthly))}/mo of idle seats recovers ${money(Math.round(bvaReclaim.quarterSavings))} this quarter, trimming the overage to ${money(Math.round(bvaReclaim.projectedVarianceAfter))}.`}
            </span>
          </div>
        )}
        {bva.months.map((m) => {
          const value = m.actual ?? m.forecast ?? 0;
          const isForecast = m.actual === null;
          const over = value > bva.budget;
          return (
            <Meter
              key={m.month}
              label={`${monthLabel(m.month)}${isForecast ? " (forecast)" : ""}`}
              value={`${money(Math.round(value))} of ${money(bva.budget)}`}
              pct={(value / bva.budget) * 100}
              hot={over}
              note={over ? "Over budget" : isForecast ? "projected" : undefined}
            />
          );
        })}
      </section>
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
