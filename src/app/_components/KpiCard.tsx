export function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <div className={`kpi kpi-${tone}`} role="group" aria-label={label}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" aria-live="polite">
        {value}
      </div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );
}
