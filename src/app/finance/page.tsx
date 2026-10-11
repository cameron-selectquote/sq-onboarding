import { getServices } from "@/server/store";
import { filterQueueForInFlight, getBudgetVsActual, getFinanceSummary, getReclaimJobs, getReclaimQueue } from "@/server/queries";
import { avgCostPerSpendingHire, budgetBurnDown, burnDelta, cumulativeRecurringBurn, financeHeroState, rangeStart, recoveredThisQuarter, recurringAddedSince, type FinanceRange } from "@/lib/finance";
import { sum } from "@/lib/ledger";
import { Kpi, Meter, PageHead, SegLinks, Shell } from "../_components/Shell";
import { ReclaimButton } from "../_components/actions";
import { money, teamLabel, timeAgo } from "../_components/format";

export const dynamic = "force-dynamic";

const COST_TYPE_LABEL = { none: "—", one_time: "one-time", recurring: "recurring" } as const;

/** Finance overview (design 2c): burn, budgets, live ledger. */
export default async function FinanceOverview({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await searchParams;
  // Default (and any unknown value) is ALL — full history, page looks as today.
  const range: FinanceRange = ["3m", "6m", "12m"].includes(rawRange ?? "")
    ? (rawRange as FinanceRange)
    : "all";

  const { repo } = await getServices();
  const [{ summary, budgets }, reclaim, entries, hires, bvaResult, { jobs }] = await Promise.all([
    getFinanceSummary(),
    getReclaimQueue(),
    repo.ledgerEntries.list(),
    repo.hires.list(),
    getBudgetVsActual(),
    getReclaimJobs(),
  ]);
  const { bva, reclaim: bvaReclaim } = bvaResult;
  const hireById = new Map(hires.map((h) => [h.id, h]));

  // Hero banner: current-quarter forecast → reclaim loop. Driven by `bva` +
  // `bvaReclaim` (not the ?range= picker).
  //
  // A seat with an open job (pending/reclaiming) is in flight with IT — identical
  // to the finance reclaim page. The CTA must flag only the seats NOT already in
  // flight, so repeated "Fix the overage" clicks can't re-offer already-flagged
  // seats. Both this CTA and the reclaim page's actionable queue filter by the
  // same in-flight id set, so they can't disagree. Everything derives from the
  // same reclaim-queue rows (recurring $/mo only — never the one-time residual).
  const inFlightLicenseIds = new Set(jobs.map((j) => j.licenseId));
  const actionableRows = filterQueueForInFlight(reclaim.rows, inFlightLicenseIds);
  const actionableLicenseIds = actionableRows.flatMap((r) => r.licenseIds);
  const actionableMonthly = actionableRows.reduce((a, r) => a + r.monthly, 0);
  const inFlightMonthly = reclaim.monthly - actionableMonthly;
  const hero = financeHeroState(bva, bvaReclaim, { actionableMonthly, inFlightMonthly });

  // Realized recurring savings this quarter — traced to the ledger, NOT the
  // reclaimable estimate, and NOT scoped by the ?range= picker (current-quarter,
  // like the hero and BvA).
  const recovered = recoveredThisQuarter(entries, new Date());

  // Month-granularity window ending at the current month. Filtered entries drive
  // the historical panels (burn trend + deltas, Total spend, Avg cost per hire,
  // Live ledger); current-state tiles and BvA stay live below.
  const start = rangeStart(new Date(), range);
  const filtered = start === null
    ? entries
    : entries.filter((e) => new Date(e.createdAt).getTime() >= start.getTime());

  // Start of the local day — so "today" tracks the viewer's timezone, not UTC.
  // "+$X today" stays full-ledger / today-scoped, independent of the range.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const burnToday = recurringAddedSince(entries, startOfToday);

  const spendingHires = hires.filter((h) => filtered.some((e) => e.hireId === h.id));
  const avgPerHire = avgCostPerSpendingHire(filtered, hires.map((h) => h.id));
  // Ranged "Total spend": the filtered sum. When range=all, filtered === entries,
  // so this equals summary.totalSpend (the full-ledger total) exactly.
  const rangedTotalSpend = range === "all" ? summary.totalSpend : sum(filtered.map((e) => e.amount));

  const recent = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  // Recurring burn trend ("costs growing over time") + period-over-period deltas.
  const burnSeries = cumulativeRecurringBurn(filtered);
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
      <div className="banner">
        {hero.kind === "overage" ? (
          <>
            <div className="banner-text">
              <span style={{ fontSize: 13 }}>Forecast → reclaim · {bva.quarter}</span>
              <span className="banner-value">
                {money(Math.round(hero.projectedVariance))} over
              </span>
              <span style={{ fontSize: 14 }}>
                {`Projected ${money(Math.round(hero.projectedVariance))} over the ${money(hero.budget)} budget this quarter${
                  hero.crossoverMonth ? `, crossing the line in ${monthLabel(hero.crossoverMonth)}` : ""
                }. `}
                {hero.bringsUnderBudget
                  ? `Reclaim ${money(Math.round(hero.reclaimableMonthly))}/mo of idle seats to recover ${money(Math.round(hero.quarterSavings))} this quarter — back under budget with ${money(Math.abs(Math.round(hero.projectedVarianceAfter)))} to spare.`
                  : `Reclaim ${money(Math.round(hero.reclaimableMonthly))}/mo of idle seats to recover ${money(Math.round(hero.quarterSavings))} this quarter, trimming the overage to ${money(Math.round(hero.projectedVarianceAfter))}.`}
              </span>
            </div>
            <ReclaimButton
              className="btn btn-on-color"
              createdByTeam="finance"
              label="Fix the overage"
              licenseIds={actionableLicenseIds}
            />
          </>
        ) : hero.kind === "inflight" ? (
          <div className="banner-text">
            <span style={{ fontSize: 13 }}>Forecast → reclaim · {bva.quarter}</span>
            <span className="banner-value">
              {money(Math.round(hero.projectedVariance))} over
            </span>
            <span style={{ fontSize: 14 }}>
              {`Reclaim in progress — ${money(Math.round(hero.inFlightMonthly))}/mo flagged, awaiting IT. Projected back under budget once completed.`}
            </span>
          </div>
        ) : (
          <div className="banner-text">
            <span style={{ fontSize: 13 }}>Forecast · {bva.quarter}</span>
            <span className="banner-value">
              {hero.kind === "healthy"
                ? `${money(Math.round(hero.amount))} ${hero.overBudget ? "over" : "under"}`
                : "On plan"}
            </span>
            <span style={{ fontSize: 14 }}>
              {hero.kind === "healthy"
                ? hero.overBudget
                  ? `Projected ${money(Math.round(hero.amount))} over budget this quarter — no idle seats to reclaim right now.`
                  : `On track — projected ${money(Math.round(hero.amount))} under budget this quarter.`
                : "On plan — spend is tracking the budget this quarter."}
            </span>
          </div>
        )}
      </div>
      <PageHead eyebrow={`${periodLabel} · onboarding spend`} title="Where the money's going" />
      <div>
        <SegLinks
          active={range === "all" ? "/finance" : `/finance?range=${range}`}
          options={[
            { href: "/finance", label: "All" },
            { href: "/finance?range=3m", label: "3 months" },
            { href: "/finance?range=6m", label: "6 months" },
            { href: "/finance?range=12m", label: "12 months" },
          ]}
        />
      </div>
      <div className="kpis">
        <Kpi
          label="Recurring burn"
          value={money(Math.round(summary.recurringMonthlyBurn))}
          unit="/mo"
          sub={`${
            mom.comparable
              ? `${fmtDelta(mom)} MoM`
              : burnToday === 0
                ? "no change today"
                : `${burnToday > 0 ? "+" : ""}${money(burnToday)} today`
          } · current`}
        />
        <Kpi
          label="Total spend"
          value={money(Math.round(rangedTotalSpend))}
          sub={`${spendingHires.length} hires with spend`}
        />
        <Kpi label="Avg cost per hire" value={money(Math.round(avgPerHire))} sub="seats + hardware + fees" />
        <Kpi
          label="Reclaimable"
          value={money(Math.round(reclaim.monthly))}
          unit="/mo"
          sub={
            reclaim.oneTimeAsset > 0
              ? `${reclaim.rows.reduce((a, r) => a + r.licenseIds.length, 0)} seats · ${money(Math.round(reclaim.oneTimeAsset))} one-time asset residual · current`
              : `${reclaim.rows.reduce((a, r) => a + r.licenseIds.length, 0)} seats · current`
          }
          tone="good"
        />
        <Kpi
          label="Recovered this quarter"
          value={money(Math.round(recovered))}
          unit="/mo"
          sub="realized · recurring"
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
        <span className="meter-note">Always the current quarter — not scoped to the selected range.</span>
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
            <span className="panel-title">Ledger</span>
          </div>
          {recent.length === 0 && (
            <span className="empty">No ledger activity yet. Grant a seat or raise a PO from a team queue.</span>
          )}
          <div className="rows">
            {recent.map((e) => {
              // Recurring license-revoke credits are realized reclaims — label
              // them "reclaimed" so the recovery reads as such, distinct from an
              // ordinary revoke. Presentation only: amount/type are unchanged.
              const isReclaim = e.type === "license_revoke" && e.amount < 0 && e.costType === "recurring";
              return (
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
                    <span className="amt-type">{isReclaim ? "reclaimed" : e.amount < 0 ? "credit" : COST_TYPE_LABEL[e.costType]}</span>
                  </span>
                </div>
              );
            })}
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
            label={monthYearLabel(p.month)}
            value={`${money(Math.round(p.burn))}/mo`}
            pct={(p.burn / maxBurn) * 100}
          />
        ))}
      </section>
    </Shell>
  );
}
