import { getServices } from "@/server/store";
import { getBudgetVsActual, getReclaimBreakdown, getReclaimQueue } from "@/server/queries";
import { Meter, Shell } from "../../_components/Shell";
import { LicenseButton } from "../../_components/actions";
import { money } from "../../_components/format";
import { FINANCE_NAV } from "../nav";

export const dynamic = "force-dynamic";

/** Finance reclaim-first (design 2d): what we can take back right now. */
export default async function FinanceReclaim() {
  const [{ rows: queue, monthly: recoverable }, breakdown, { bva, reclaim }] = await Promise.all([
    getReclaimQueue(),
    getReclaimBreakdown(),
    getBudgetVsActual(),
  ]);

  const maxReason = Math.max(1, ...breakdown.reasons.map((r) => r.monthly));
  // Share of this quarter's projected overage that reclaiming would cover.
  const overageCoverage =
    bva.projectedVariance > 0 ? Math.min(100, Math.round((reclaim.quarterSavings / bva.projectedVariance) * 100)) : null;

  return (
    <Shell nav={FINANCE_NAV} active="/finance/reclaim" who="Finance">
      <div className="banner">
        <div className="banner-text">
          <span style={{ fontSize: 13 }}>Recoverable spend</span>
          <span className="banner-value">{money(Math.round(breakdown.annual))}/yr</span>
          <span style={{ fontSize: 14 }}>
            {breakdown.seats === 0
              ? "Nothing to reclaim. Nice."
              : `${money(Math.round(recoverable))}/mo across ${breakdown.seats} seats${
                  overageCoverage !== null ? ` · covers ${overageCoverage}% of the ${bva.quarter} overage` : ""
                }`}
          </span>
        </div>
        <LicenseButton
          className="btn btn-on-color"
          action="revoke"
          label="Reclaim all"
          licenseIds={queue.flatMap((r) => r.licenseIds)}
        />
      </div>
      <div className="split-wide">
        <section className="panel" style={{ gap: 4 }}>
          <span className="panel-title" style={{ paddingBottom: 8 }}>Reclaim queue</span>
          {queue.length === 0 && <span className="empty">No idle, flagged or duplicate seats.</span>}
          <div className="rows">
            {queue.map((r) => (
              <div key={r.key} className="row row-reclaim">
                <span className="n-dot">{r.licenseIds.length}</span>
                <div className="who-text">
                  <span className="who-name">{r.what}</span>
                  <span className="who-sub">{r.why}</span>
                </div>
                <span className="amt">{money(Math.round(r.monthly * 100) / 100)}/mo</span>
                <LicenseButton action="revoke" label={`Revoke ${r.licenseIds.length}`} licenseIds={r.licenseIds} />
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <span className="panel-title">Where the waste is</span>
          {breakdown.reasons.length === 0 && <span className="empty">No reclaimable seats right now.</span>}
          {breakdown.reasons.map((r) => (
            <Meter
              key={r.reason}
              label={r.label}
              value={`${money(Math.round(r.monthly))}/mo`}
              pct={(r.monthly / maxReason) * 100}
              note={`${r.seats} seat${r.seats === 1 ? "" : "s"} · ${money(Math.round(r.monthly * 12))}/yr`}
            />
          ))}
        </section>
      </div>
    </Shell>
  );
}
