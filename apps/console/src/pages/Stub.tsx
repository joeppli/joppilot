import { Card } from '../components/ui';
import { Icon } from '../components/layout/Icon';

/** Placeholder for IA pages not yet built — keeps the navigation complete. */
export function Stub({ title, icon, note }: { title: string; icon: string; note?: string }) {
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">{title}</div>
        <div className="page-sub">Planned — not yet implemented</div>
      </div>
      <Card>
        <div className="card-pad col gap-3" style={{ alignItems: 'center', textAlign: 'center', padding: 'var(--sp-10)' }}>
          <div style={{ color: 'var(--text-muted)' }}><Icon name={icon} size={40} /></div>
          <strong style={{ fontSize: 'var(--fs-md)' }}>{title} is coming soon</strong>
          <span className="muted text-sm" style={{ maxWidth: 420 }}>
            {note ?? 'This area is part of the fleet-management scope and will be built out next. The navigation is wired so the structure is in place.'}
          </span>
        </div>
      </Card>
    </div>
  );
}
