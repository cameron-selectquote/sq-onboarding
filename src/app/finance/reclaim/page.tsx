import { getServices } from "@/server/store";
import { getReclaimQueue } from "@/server/queries";
import { costPerHire } from "@/lib/finance";
import { Meter, Shell } from "../../_components/Shell";
import { LicenseButton } from "../../_components/actions";
import { money } from "../../_components/format";

export const dynamic = "force-dynamic";

/** Finance reclaim-first (design 2d): what we can take back right now. */
export default async function FinanceReclaim() {
  const { repo } = await getServices();
  const [{ rows: queue, monthly: recoverable }, entries, hires] = await Promise.all([
    getReclaimQueue(),
    repo.ledgerEntries.list(),
    repo.hires.list(),
  ]);

  // Average ledger spend per hire, grouped by role.
  const byRole = new Map<string, number[]>();
  for (const h of hires) {
    const spend = costPerHire(entries, h.id);
    if (spend === 0) continue;
    byRole.set(h.roleName, [...(byRole.get(h.roleName) ?? []), spend]);
  }
  const roleCosts = [...byRole].map(([role, xs]) => ({ role, avg: xs.reduce((a, b) => a + b, 0) / xs.length }));
  roleCosts.sort((a, b) => b.avg - a.avg);
  const maxRole = roleCosts[0]?.avg ?? 0;

  return (
    <Shell active="/finance/reclaim">
      <div className="banner">
        <div className="banner-text">
          <span style={{ fontSize: 13 }}>Recoverable right now</span>
          <span className="banner-value">{money(Math.round(recoverable * 100) / 100)}/mo</span>
          <span style={{ fontSize: 14 }}>
            {queue.length === 0 ? "Nothing to reclaim. Nice." : `across ${queue.reduce((a, r) => a + r.licenseIds.length, 0)} seats`}
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
          <span className="panel-title">Cost per hire, by role</span>
          {roleCosts.length === 0 && <span className="empty">No spend on the ledger yet.</span>}
          {roleCosts.map((c) => (
            <Meter key={c.role} label={c.role} value={money(Math.round(c.avg))} pct={(c.avg / maxRole) * 100} hot />
          ))}
        </section>
      </div>
    </Shell>
  );
}
