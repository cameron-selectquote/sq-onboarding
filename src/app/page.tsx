import Link from "next/link";

/**
 * Role picker. There's no auth in the first pass (role-views spec, out of
 * scope), so each role view is just a route; DevOps swaps this for Supabase
 * auth later.
 */
const ROLES = [
  { href: "/specialist", kicker: "Specialist · HR", title: "Onboarding board", body: "Every hire's tasks by status, and who's ready or stuck." },
  { href: "/finance", kicker: "Finance", title: "Spend + reclaim", body: "Live burn, budgets, the ledger, and seats to take back." },
  { href: "/team/it", kicker: "Team · IT", title: "IT queue", body: "Seats to grant, accounts to create, inventory on hand." },
  { href: "/team/vendor", kicker: "Team · Vendor", title: "Vendor queue", body: "Hardware to order. Raise POs against the budget." },
  { href: "/team/facilities", kicker: "Team · Facilities", title: "Facilities queue", body: "Badges and desks for day one." },
  { href: "/manager", kicker: "Manager", title: "My hires", body: "How far along each of your people is." },
  { href: "/myonboarding?hire=hire_1", kicker: "New hire", title: "My onboarding", body: "Your checklist and your people. No costs." },
];

export default function Home() {
  return (
    <main className="main" style={{ maxWidth: 1100 }}>
      <div className="head-text">
        <span className="eyebrow">Provision · SelectQuote</span>
        <h1 className="title">Who are you today?</h1>
      </div>
      <div className="roles">
        {ROLES.map((r) => (
          <Link key={r.href} href={r.href} className="card role-card">
            <span className="card-kicker">{r.kicker}</span>
            <span className="card-title">{r.title}</span>
            <p className="card-body">{r.body}</p>
          </Link>
        ))}
      </div>
      <p className="card-body" style={{ marginTop: 24 }}>
        Developer? Exercise every endpoint — including the AI template matcher
        and welcome-brief drafter — from the{" "}
        <Link href="/api-docs">interactive API docs</Link>.
      </p>
    </main>
  );
}
