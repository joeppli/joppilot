import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import { navFor } from './nav';
import { useSession } from '../../context/SessionContext';
import { useMode } from '../../mode/ModeContext';
import { entryStrings as t } from '../../mode/strings';

export function Sidebar() {
  const { connection } = useSession();
  const { mode } = useMode();
  const online = connection === 'connected';
  const isDemo = mode === 'demo';
  const nav = navFor(mode);

  // A demo session IS connected — to a simulator in this tab. Calling that
  // "Live telemetry" would be the console vouching for invented numbers, so
  // the connected state is named after its actual source.
  const connLabel =
    connection === 'connecting' ? t.telemetryConnecting
      : connection === 'disconnected' ? t.telemetryOffline
        : mode === 'demo' ? t.telemetrySimulated
          : t.telemetryLive;

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
        {nav.map((section, i) => (
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

      {/* The demo shows four working screens; this says what the other
          modules are, so hiding them reads as scope rather than absence. */}
      {isDemo && <p className="sidebar-scope-note">{t.demoScopeNote}</p>}

      <div className="sidebar-foot">
        <span className="conn">
          <span className={`dot ${online ? 'on' : 'off'}`} />
          {connLabel}
        </span>
      </div>
    </aside>
  );
}
