"use client";

import { loadFinance, loadHireDetails } from "../_components/api";
import { KpiCard } from "../_components/KpiCard";
import { formatUsd } from "../_components/format";
import { usePoll } from "../_components/usePoll";

/** Poll fast enough that grant/revoke/PO on another screen visibly moves burn. */
const POLL_MS = 3000;

export function FinanceDashboard() {
  const finance = usePoll(loadFinance, POLL_MS);
  const hires = usePoll(loadHireDetails, POLL_MS);

  if (finance.error) return <p className="error" role="alert">{finance.error}</p>;
  if (!finance.data) return <p className="muted">Loading finance summary…</p>;

  const { summary, budgets } = finance.data;
  const overspent = summary.overspentTeams;

  return (
    <>
      <h1>Finance</h1>

      {overspent.length > 0 ? (
        <div className="banner banner-bad" role="status">
          Over budget: {overspent.join(", ")}
        </div>
      ) : null}
      {summary.reclaimable > 0 ? (
        <div className="banner banner-good" role="status">
          {formatUsd(summary.reclaimable)} reclaimable from idle seats and returned hardware
        </div>
      ) : null}

      <div className="kpi-grid">
        <KpiCard
          label="Recurring monthly burn"
          value={formatUsd(summary.recurringMonthlyBurn)}
          hint="Active seats, normalized to monthly"
        />
        <KpiCard label="Total spend" value={formatUsd(summary.totalSpend)} hint="Sum of the ledger" />
        <KpiCard
          label="Reclaimable"
          value={formatUsd(summary.reclaimable)}
          tone={summary.reclaimable > 0 ? "good" : "default"}
          hint="Idle/reclaim seats + returned asset value"
        />
        <KpiCard
          label="Assets on hand"
          value={String(summary.assetsOnHand)}
          hint="In stock, assignable without a PO"
        />
      </div>

      <section className="panel" aria-labelledby="budgets-heading">
        <h2 id="budgets-heading">Budgets</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Period</th>
              <th scope="col" className="num">Spent</th>
              <th scope="col" className="num">Limit</th>
              <th scope="col">Burn-down</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((b) => (
              <tr key={b.id}>
                <td>{b.team}</td>
                <td>{b.period}</td>
                <td className="num">{formatUsd(b.spent)}</td>
                <td className="num">{formatUsd(b.limit)}</td>
                <td>
                  <meter
                    min={0}
                    max={b.limit || 1}
                    low={(b.limit || 1) * 0.75}
                    high={(b.limit || 1) * 0.9}
                    optimum={0}
                    value={Math.max(0, b.spent)}
                    aria-label={`${b.team} budget used`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel" aria-labelledby="cph-heading">
        <h2 id="cph-heading">Cost per hire</h2>
        {!hires.data ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Hire</th>
                <th scope="col">Role</th>
                <th scope="col" className="num">Seats</th>
                <th scope="col" className="num">Ledger total</th>
              </tr>
            </thead>
            <tbody>
              {hires.data.map((d) => (
                <tr key={d.hire.id}>
                  <td>{d.hire.name}</td>
                  <td>{d.hire.roleName}</td>
                  <td className="num">{d.licenses.filter((l) => l.status === "active").length}</td>
                  <td className="num">{formatUsd(d.totalSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
