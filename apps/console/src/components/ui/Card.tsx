import { ReactNode } from 'react';

export function Card({ children, className = '', pad = false }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={`card${pad ? ' card-pad' : ''} ${className}`}>{children}</div>;
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="card-header">
      <span className="card-title">{title}</span>
      {action}
    </div>
  );
}

export function StatCard({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <div className="stat">
      <span className="stat-value" style={tone ? { color: tone } : undefined}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
