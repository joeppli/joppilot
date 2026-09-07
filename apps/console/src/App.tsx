import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { ModeProvider, useMode } from './mode/ModeContext';
import { operatorSessionAlive, type AppMode } from './mode/mode';
import { EntryGate } from './mode/EntryGate';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { MapDispatch } from './pages/MapDispatch';
import { Vehicles } from './pages/Vehicles';
import { Operations } from './pages/Operations';
import { Stub } from './pages/Stub';

import './theme/fonts.css';
import './theme/tokens.css';
import './theme/base.css';
import './components/ui/ui.css';
import './components/layout/layout.css';

export default function App() {
  return (
    <ModeProvider>
      <Gated />
    </ModeProvider>
  );
}

/**
 * Nothing renders until a mode is chosen AND, for operators, actually backed by
 * a sign-in.
 *
 * The gate is a MOUNT boundary, not a visual overlay: SessionProvider — which
 * owns every socket, poll and AWS call — is not constructed at all while the
 * gate is up. A visitor who never picks a mode therefore causes no network
 * traffic of any kind.
 *
 * WHY THE SECOND CHECK IS HERE AND NOT ONLY IN readStoredMode: choosing
 * 'operator' is not the same as being signed in. The gate stores the mode and
 * THEN redirects to the Hosted UI, so between those two steps the mode says
 * "operator" while no token exists — and the app used to mount into that gap
 * and paint the whole console (sidebar, fleet, dashboard) for anyone who
 * clicked the button. On a slow link that window is seconds long. The same gap
 * reopens on the way back: a visitor who hits BACK from the Hosted UI returns
 * to a document restored from the bfcache, where no module-level code reruns
 * and the stored-mode check never happens.
 *
 * Evaluating it per render closes both: it holds whenever React paints,
 * regardless of how the session got into this state. Demo is untouched — it
 * needs no credential and never consults this branch.
 */
function Gated() {
  const { mode } = useMode();
  if (!mode) return <EntryGate />;
  if (mode === 'operator' && !operatorSessionAlive()) return <EntryGate />;

  return (
    <SessionProvider>
      <BrowserRouter>
        <LandingRedirect mode={mode} />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/map" element={<MapDispatch />} />
            <Route path="/vehicles" element={<Vehicles />} />
            <Route path="/operations" element={<Operations />} />
            <Route path="/inspections" element={<Stub title="Inspections" icon="inspection" />} />
            <Route path="/issues" element={<Stub title="Issues" icon="issues" />} />
            <Route path="/reminders" element={<Stub title="Reminders" icon="reminders" />} />
            <Route path="/service" element={<Stub title="Service" icon="service" />} />
            <Route path="/charging" element={<Stub title="Charging & Energy" icon="charging" />} />
            <Route path="/contacts" element={<Stub title="Contacts & Users" icon="contacts" />} />
            <Route path="/parts" element={<Stub title="Parts & Inventory" icon="parts" />} />
            <Route path="/places" element={<Stub title="Places" icon="places" />} />
            <Route path="/reports" element={<Stub title="Reports" icon="reports" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}

/**
 * A demo visitor came to watch a vehicle move, so the session LANDS on the map
 * instead of on a dashboard of cards.
 *
 * This is a LANDING rule, not a routing rule — and the difference matters.
 * Routing '/' to the map permanently made the Dashboard unreachable for a demo
 * session: the sidebar offered a Dashboard link that bounced straight back to
 * the map, which is precisely the dead end the demo must not have. Firing once,
 * and only from '/', keeps the landing behaviour while leaving every screen
 * navigable (and leaves a deep link into any other path alone).
 */
function LandingRedirect({ mode }: { mode: AppMode }) {
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (mode === 'demo' && window.location.pathname === '/') navigate('/map', { replace: true });
  }, [mode, navigate]);
  return null;
}
