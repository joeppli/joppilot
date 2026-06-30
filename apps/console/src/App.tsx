import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { MapDispatch } from './pages/MapDispatch';
import { Vehicles } from './pages/Vehicles';
import { Operations } from './pages/Operations';
import { Stub } from './pages/Stub';

import './theme/tokens.css';
import './theme/base.css';
import './components/ui/ui.css';
import './components/layout/layout.css';

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
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
