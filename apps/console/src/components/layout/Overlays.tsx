import { Button } from '../ui';
import { useSession } from '../../context/SessionContext';

/** Cross-page safety overlays: latched safe-stop banner + active maneuver proposal. */
export function Overlays() {
  const {
    isLatched, hasControl, cmdPost,
    activeProposal, proposalTimeLeft, lastProposalResult, decideManeuver,
  } = useSession();

  if (!isLatched && !activeProposal && !lastProposalResult) return null;
  const urgent = proposalTimeLeft < 5000;

  return (
    <div className="overlays">
      {isLatched && hasControl && (
        <div className="banner banner-danger" role="alert">
          <div>
            <strong>Vehicle is in SAFE-STOP (latched)</strong>
            <div className="text-sm">Maneuver proposals are paused. Release the latch to resume operations.</div>
          </div>
          <Button variant="danger" onClick={() => cmdPost('clear-safe-stop')}>Clear safe-stop</Button>
        </div>
      )}

      {activeProposal && (
        <div className={`maneuver${urgent ? ' urgent' : ''}`} role="alert" aria-live="assertive">
          <div className="row between" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)' }}>Maneuver proposal</div>
              <div className="text-sm muted" style={{ marginTop: 2 }}>
                {activeProposal.reasonCode} — {activeProposal.context.sceneSummary}
              </div>
            </div>
            <span className="maneuver-timer" style={{ color: urgent ? 'var(--color-danger)' : 'var(--color-warning)' }}>
              {Math.ceil(proposalTimeLeft / 1000)}s
            </span>
          </div>

          {activeProposal.options.map(opt => (
            <button
              key={opt.optionId}
              className={`maneuver-opt${opt.optionId === activeProposal.defaultOnTimeout ? ' default' : ''}`}
              disabled={!hasControl}
              onClick={() => decideManeuver('SELECT_ALTERNATIVE', opt.optionId)}
              aria-label={`Select: ${opt.description}. Expected: ${opt.expectedResult}`}
            >
              <div style={{ fontWeight: 600 }}>{opt.description}</div>
              <div className="text-sm muted" style={{ marginTop: 2 }}>{opt.expectedResult}</div>
              {opt.optionId === activeProposal.defaultOnTimeout &&
                <div className="text-xs" style={{ color: 'var(--color-warning)', marginTop: 2 }}>Safe default on timeout</div>}
            </button>
          ))}
          <Button variant="ghost" size="sm" disabled={!hasControl} onClick={() => decideManeuver('REJECT')}>
            Reject proposal
          </Button>
        </div>
      )}

      {lastProposalResult && (
        <div className="banner banner-info text-sm" role="status">Last proposal: {lastProposalResult}</div>
      )}
    </div>
  );
}
