import { Button, Card } from '../components/ui';
import { useSession } from '../context/SessionContext';

/**
 * Cloud-mode entry screen: shown instead of the console until the operator
 * has signed in through the Cognito Hosted UI (SEC-03 — MFA is enforced by
 * the user pool during that flow). Local dev never sees this page: without
 * VITE_AWS_* config there is no identity provider to talk to, and the gate
 * in App.tsx stays open.
 */
export function Login() {
  const { cloudSignIn } = useSession();
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--sidebar-bg)' }}>
      <Card>
        <div
          className="card-pad col gap-3"
          style={{ alignItems: 'center', textAlign: 'center', padding: 'var(--sp-10)', width: 360, maxWidth: '90vw' }}
        >
          <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--text-primary)' }}>Joppilot</div>
          <div style={{ color: 'var(--text-secondary)' }}>Stadt Zürich · ERZ · City Console</div>
          <Button size="lg" block onClick={cloudSignIn}>
            Operator sign-in
          </Button>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
            Signs in through AWS Cognito (MFA required). Operator accounts are provisioned by Jöppli.
          </div>
        </div>
      </Card>
    </div>
  );
}
