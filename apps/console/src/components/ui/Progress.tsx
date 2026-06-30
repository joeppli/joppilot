export function Progress({ value, tone }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = tone ?? (pct > 20 ? 'var(--color-success)' : 'var(--color-danger)');
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
