import { Button } from '../ui';
import { useSession } from '../../context/SessionContext';
import { entryStrings as t, fmt } from '../../mode/strings';

/** Cross-page safety overlays: latched safe-stop banner + active maneuver proposal. */
export function Overlays() {
  const {
    isLatched, hasControl, cmdPost, commandsDisabled,
    activeProposal, proposalTimeLeft, lastProposalResult, decideManeuver,
  } = useSession();

  if (!isLatched && !activeProposal && !lastProposalResult && !commandsDisabled) return null;
  const urgent = proposalTimeLeft < 5000;

  return (
    <div className="overlays">
      {/* Why a banner and not just greyed-out buttons: an operator whose build
          has no command endpoint would otherwise see a normal console whose
          controls quietly do nothing. Naming the condition is the difference
          between a known limitation and a suspected outage. */}
      {commandsDisabled && (
        <div className="banner banner-info" role="status">
          <div>
            <strong>{t.commandsDisabledTitle}</strong>
            <div className="text-sm">{t.commandsDisabledBody}</div>
          </div>
        </div>
      )}

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
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)' }}>{t.maneuverHeading}</div>
              <div className="text-sm muted" style={{ marginTop: 2 }}>
                {activeProposal.reasonCode} — {activeProposal.context.sceneSummary}
              </div>
            </div>
            <span className="maneuver-timer" style={{ color: urgent ? 'var(--color-danger)' : 'var(--color-warning)' }}>
              {Math.ceil(proposalTimeLeft / 1000)}s
            </span>
          </div>

          {activeProposal.options.map((opt, idx) => {
            // ICD §6: the operator can APPROVE the proposed maneuver or SELECT
            // an alternative — the first option is the ADS's own proposal
            // (B-boundary convention; final schema frozen with the ADS team,
            // OP-3), so clicking it is an approval (CONFIRM_MANEUVER), any
            // other option is SELECT_ALTERNATIVE. Same execution on the
            // vehicle, different evidence in the EDR chain (LEG-05).
            const isProposed = idx === 0;
            return (
              <button
                key={opt.optionId}
                className={`maneuver-opt${opt.optionId === activeProposal.defaultOnTimeout ? ' default' : ''}`}
                disabled={!hasControl}
                onClick={() => decideManeuver(isProposed ? 'CONFIRM' : 'SELECT_ALTERNATIVE', opt.optionId)}
                aria-label={fmt(t.maneuverOptionAria, {
                  action: isProposed ? t.maneuverApproveAction : t.maneuverAlternativeAction,
                  description: opt.description,
                  expected: opt.expectedResult,
                })}
              >
                <div style={{ fontWeight: 600 }}>{opt.description}</div>
                <div className="text-sm muted" style={{ marginTop: 2 }}>{opt.expectedResult}</div>
                {isProposed &&
                  <div className="text-xs" style={{ color: 'var(--color-success, #2e7d32)', marginTop: 2 }}>{t.maneuverProposed}</div>}
                {opt.optionId === activeProposal.defaultOnTimeout &&
                  <div className="text-xs" style={{ color: 'var(--color-warning)', marginTop: 2 }}>{t.maneuverSafeDefault}</div>}
              </button>
            );
          })}
          <Button variant="ghost" size="sm" disabled={!hasControl} onClick={() => decideManeuver('REJECT')}>
            {t.maneuverReject}
          </Button>
          {/* Without this line, an observer without control sees a countdown
              and four dead buttons. ICD §6: the vehicle does not wait for a
              decision that never comes — say so before it happens. */}
          {!hasControl && <p className="text-xs muted" style={{ marginTop: 8 }}>{t.proposalNeedsControl}</p>}
        </div>
      )}

      {lastProposalResult && (
        <div className="banner banner-info text-sm" role="status">{fmt(t.proposalResult, { result: lastProposalResult })}</div>
      )}
    </div>
  );
}
