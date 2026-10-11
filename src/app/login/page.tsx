import { redirect } from "next/navigation";
import { DEMO_ACCOUNTS } from "@/lib/accounts";
import { currentSession, demoPassword } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Username + password sign-in. Signed-in users go straight to /home. */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; username?: string }>;
}) {
  if (await currentSession()) redirect("/home");
  const { error, next, username } = await searchParams;
  // Dev with no DEMO_PASSWORD: any password works, so prefill admin and list accounts.
  const devOpen = demoPassword() === "";

  return (
    <main className="login-page">
      <form method="post" action="/api/session" className="card login-card">
        <div className="head-text">
          <span className="eyebrow">Provision · SelectQuote</span>
          <h1 className="title">Sign in</h1>
        </div>
        {next && <input type="hidden" name="next" value={next} />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            className="input"
            required
            autoComplete="username"
            autoCapitalize="none"
            defaultValue={username ?? (devOpen ? "admin" : "")}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            required={!devOpen}
            autoComplete="current-password"
            autoFocus={Boolean(username) || devOpen}
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Sign in
        </button>
        {devOpen && (
          <p className="login-hint">
            Dev mode: no password set. Accounts: {DEMO_ACCOUNTS.map((a) => a.username).join(", ")}.
          </p>
        )}
      </form>
    </main>
  );
}
