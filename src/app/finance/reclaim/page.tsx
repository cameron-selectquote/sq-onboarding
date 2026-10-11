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
            {queue.map((r) => {
              // A single-seat "group" isn't a group — show it as one plain row
              // (hire + evidence inline, one Revoke). No expand, no duplicate button.
              if (r.seats.length === 1) {
                const s = r.seats[0]!;
                return (
                  <div key={r.key} className="row row-reclaim">
                    <span className="n-dot">1</span>
                    <div className="who-text">
                      <span className="who-name">{r.what}</span>
                      <span className="who-sub">
                        {s.hireName ?? "Unassigned"} · {s.detail}
                      </span>
                    </div>
                    <span className="amt">{money(Math.round(r.monthly * 100) / 100)}/mo</span>
                    <LicenseButton action="revoke" label="Revoke" licenseIds={r.licenseIds} />
                  </div>
                );
              }
              // Multi-seat group: expandable, with a per-seat drill-down.
              return (
                <details key={r.key} className="reclaim-group">
                  <summary className="row row-reclaim">
                    <span className="n-dot">{r.seats.length}</span>
                    <div className="who-text">
                      <span className="who-name">{r.what}</span>
                      <span className="who-sub">{r.why} · tap to see seats</span>
                    </div>
                    <span className="amt">{money(Math.round(r.monthly * 100) / 100)}/mo</span>
                    <LicenseButton action="revoke" label="Revoke all" licenseIds={r.licenseIds} />
                  </summary>
                  <div className="reclaim-seats">
                    {r.seats.map((s) => (
                      <div key={s.licenseId} className="row row-seat">
                        <div className="who-text">
                          <span className="who-name">{s.hireName ?? "Unassigned"}</span>
                          <span className="who-sub">{s.app} · {s.detail}</span>
                        </div>
                        <span className="amt">{money(Math.round(s.monthly * 100) / 100)}/mo</span>
                        <LicenseButton action="revoke" label="Revoke" licenseIds={[s.licenseId]} />
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
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
