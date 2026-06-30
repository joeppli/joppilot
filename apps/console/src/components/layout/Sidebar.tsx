import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import { NAV } from './nav';
import { useSession } from '../../context/SessionContext';

export function Sidebar() {
  const { connection } = useSession();
  const online = connection === 'connected';

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">J</div>
        <div className="sidebar-brand-text">
          <strong>Jöppli x ERZ</strong>
          <span>Stadt Zürich</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV.map((section, i) => (
          <div key={i}>
            {section.heading && <div className="sidebar-section">{section.heading}</div>}
            {section.items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                title={item.stub ? `${item.label} (coming soon)` : item.label}
              >
                <Icon name={item.icon} />
                <span className="grow">{item.label}</span>
                {item.stub && <span className="text-xs" style={{ opacity: .4 }}>soon</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <span className="conn">
          <span className={`dot ${online ? 'on' : 'off'}`} />
          {connection === 'connected' ? 'Live telemetry' : connection === 'connecting' ? 'Connecting…' : 'Offline'}
        </span>
      </div>
    </aside>
  );
}
