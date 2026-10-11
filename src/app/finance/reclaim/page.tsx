import { filterQueueForInFlight, getBudgetVsActual, getReclaimBreakdown, getReclaimJobs, getReclaimQueue } from "@/server/queries";
import { Meter, Shell } from "../../_components/Shell";
import { ReclaimButton } from "../../_components/actions";
import { money } from "../../_components/format";

export const dynamic = "force-dynamic";

/** Finance reclaim-first (design 2d): what we can take back right now. */
export default async function FinanceReclaim() {
  const [{ rows: allRows, monthly: recoverable }, breakdown, { bva, reclaim }, { jobs, counts }] = await Promise.all([
    getReclaimQueue(),
    getReclaimBreakdown(),
    getBudgetVsActual(),
    getReclaimJobs(),
  ]);

  // A seat with an open job (pending/reclaiming) is in flight with IT: drop it
  // from the actionable queue so finance can't re-flag it. Its $/mo still rides
  // in the banner/breakdown (recoverable, from the unchanged report) — the money
  // is in flight, not yet recovered. Only the clickable rows filter.
  const inFlightLicenseIds = new Set(jobs.map((j) => j.licenseId));
  const queue = filterQueueForInFlight(allRows, inFlightLicenseIds);

  // Jobs finance kicked off — surfaced so finance can watch IT execute them.
  // This panel is now where in-flight seats live after leaving the queue above.
  const financeJobs = jobs.filter((j) => j.createdByTeam === "finance");

  const maxReason = Math.max(1, ...breakdown.reasons.map((r) => r.monthly));
  // Share of this quarter's projected overage that reclaiming would cover.
  const overageCoverage =
    bva.projectedVariance > 0 ? Math.min(100, Math.round((reclaim.quarterSavings / bva.projectedVariance) * 100)) : null;

  return (
    <Shell active="/finance/reclaim">
      <div className="banner">
        <div className="banner-text">
          <span style={{ fontSize: 13 }}>Recoverable spend</span>
          {/* Annualize the exact $/mo shown below (× 12) so the two figures can
              never drift and the ×12 relationship is explicit for the reader. */}
          <span className="banner-value">{money(Math.round(recoverable * 12))}/yr</span>
          <span style={{ fontSize: 14 }}>
            {breakdown.seats === 0
              ? "Nothing to reclaim. Nice."
              : `${money(Math.round(recoverable))}/mo × 12 across ${breakdown.seats} seats${
                  overageCoverage !== null ? ` · covers ${overageCoverage}% of the ${bva.quarter} overage` : ""
                }`}
          </span>
        </div>
        <ReclaimButton
          className="btn btn-on-color"
          createdByTeam="finance"
          label="Reclaim all"
          licenseIds={queue.flatMap((r) => r.licenseIds)}
        />
      </div>
      <div className="split-wide">
        <section className="panel" style={{ gap: 4 }}>
          <span className="panel-title" style={{ paddingBottom: 8 }}>Reclaim queue</span>
          {queue.length === 0 && (
            <span className="empty">
              {breakdown.seats === 0
                ? "No idle, flagged or duplicate seats."
                : "All flagged seats are in flight with IT."}
            </span>
          )}
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
                    <ReclaimButton createdByTeam="finance" label="Reclaim" licenseIds={r.licenseIds} />
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
                    <ReclaimButton createdByTeam="finance" label="Reclaim all" licenseIds={r.licenseIds} />
                  </summary>
                  <div className="reclaim-seats">
                    {r.seats.map((s) => (
                      <div key={s.licenseId} className="row row-seat">
                        <div className="who-text">
                          <span className="who-name">{s.hireName ?? "Unassigned"}</span>
                          <span className="who-sub">{s.app} · {s.detail}</span>
                        </div>
                        <span className="amt">{money(Math.round(s.monthly * 100) / 100)}/mo</span>
                        <ReclaimButton createdByTeam="finance" label="Reclaim" licenseIds={[s.licenseId]} />
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
      <section className="panel" style={{ gap: 4 }}>
        <div className="meter-head" style={{ alignItems: "center" }}>
          <span className="panel-title">Reclaim jobs</span>
          <span className="muted" style={{ fontSize: 13 }}>
            {counts.pending} pending · {counts.reclaiming} reclaiming · {counts.done} done
          </span>
        </div>
        {financeJobs.length === 0 ? (
          <span className="empty">No open jobs. Flag a seat above to kick one off for IT.</span>
        ) : (
          <div className="rows">
            {financeJobs.map((j) => (
              <div key={j.taskId} className="row row-seat">
                <div className="who-text">
                  <span className="who-name">{j.hireName ?? "Unassigned"}</span>
                  <span className="who-sub">{j.app}</span>
                </div>
                <span className="amt">{money(Math.round(j.monthly * 100) / 100)}/mo</span>
                <span className={j.status === "reclaiming" ? "pill pill-progress" : "pill pill-none"}>
                  {j.status === "reclaiming" ? "Reclaiming" : "Pending"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
