import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Overlays } from './Overlays';

export function AppShell() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="shell-main">
        <Header />
        <div className="shell-content">
          <Overlays />
          <Outlet />
        </div>
      </div>
    </div>
  );
}
