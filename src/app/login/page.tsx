import type { Persona } from "@/lib/access";
import { demoPassword } from "@/server/auth";
import { getServices } from "@/server/store";

export const dynamic = "force-dynamic";

/** One card per persona. Each card is a submit button for the same form. */
const ROLES: { persona: Persona; kicker: string; title: string; body: string }[] = [
  { persona: "specialist", kicker: "Specialist · HR", title: "Onboarding board", body: "Every hire's tasks by status, and who's ready or stuck." },
  { persona: "finance", kicker: "Finance", title: "Spend + reclaim", body: "Live burn, budgets, the ledger, and seats to take back." },
  { persona: "it", kicker: "Team · IT", title: "IT queue", body: "Seats to grant, accounts to create, inventory on hand." },
  { persona: "vendor", kicker: "Team · Hardware", title: "Hardware queue", body: "Hardware to order. Raise POs against the budget." },
  { persona: "facilities", kicker: "Team · Facilities", title: "Facilities queue", body: "Badges and day-one setup." },
  { persona: "manager", kicker: "Manager", title: "My hires", body: "How far along each of your people is." },
];

/** Demo login: shared password + pick a role. */
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const needsPassword = demoPassword() !== "";
  const { repo } = await getServices();
  const hires = await repo.hires.list();

  return (
    <main className="main" style={{ maxWidth: 1100 }}>
      <div className="head-text">
        <span className="eyebrow">Provision · SelectQuote</span>
        <h1 className="title">Who are you today?</h1>
      </div>
      <form method="post" action="/api/session" className="login">
        {next && <input type="hidden" name="next" value={next} />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {needsPassword && (
          <div className="field login-password">
            <label htmlFor="password">Demo password</label>
            <input id="password" name="password" type="password" className="input" required autoComplete="current-password" />
          </div>
        )}
        <div className="roles">
          {ROLES.map((r) => (
            <button key={r.persona} type="submit" name="persona" value={r.persona} className="card role-card">
              <span className="card-kicker">{r.kicker}</span>
              <span className="card-title">{r.title}</span>
              <span className="card-body">{r.body}</span>
            </button>
          ))}
          <div className="card">
            <span className="card-kicker">New hire</span>
            <span className="card-title">My onboarding</span>
            <span className="card-body">Your checklist and your people. No costs.</span>
            <div className="field">
              <label htmlFor="hireId">I am</label>
              <select id="hireId" name="hireId" className="input">
                {hires.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" name="persona" value="hire" className="btn btn-primary">
              Sign in as new hire
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
