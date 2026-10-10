/**
 * Placeholder landing page.
 *
 * The 8 role views (specialist, manager, team, finance, my-onboarding, guided
 * setup, access brief) are the Web Developer workstream — they wire to the API
 * routes already built under /api. This page just confirms the app runs and
 * lists the live endpoints so the team can start iterating.
 */
export default function Home() {
  const endpoints = [
    "POST /api/hires/import",
    "GET  /api/hires",
    "GET  /api/hires/:id",
    "PATCH /api/tasks/:id",
    "POST /api/licenses/:id/grant",
    "POST /api/licenses/:id/revoke",
    "POST /api/pos",
    "GET  /api/assets",
    "POST /api/assets/:id/return",
    "GET  /api/finance/summary",
    "POST /api/ai/match-template",
  ];

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 760 }}>
      <h1>Provision</h1>
      <p>First-pass build. Domain core in <code>src/lib</code>, seeded in-memory store, Jest tests.</p>
      <h2>Live API endpoints</h2>
      <ul>
        {endpoints.map((e) => (
          <li key={e}><code>{e}</code></li>
        ))}
      </ul>
      <p>Role views build against these. See <code>BuildPlan.md</code> for the full surface.</p>
    </main>
  );
}
