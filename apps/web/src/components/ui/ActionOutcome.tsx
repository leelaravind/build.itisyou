import { MaterialIcon } from './MaterialIcon.tsx';

/**
 * What happened to the thing you just submitted.
 *
 * Every server action here ends in a redirect that carries its outcome in the query string —
 * `?error=`, `?refused=`, `?requested=`, `?applied=` — and several pages never read it. A refused
 * lifecycle move, a change request that could not be applied, a rate limit: each returned the user
 * to the page they started on with nothing changed and nothing said, which reads as the click not
 * having registered and invites the second click the rate limit then refuses too.
 *
 * Gap-spec §55: the page maps a code to a safe sentence and never shows the code itself, and an
 * unknown code gets the generic sentence rather than being echoed back from the URL.
 *
 * Success is `role="status"` (polite); a refusal is `role="alert"`, because the user is waiting on it.
 */
export function ActionOutcome({
  tone,
  message,
}: {
  readonly tone: 'success' | 'refused';
  readonly message: string;
}) {
  const success = tone === 'success';
  return (
    <p
      role={success ? 'status' : 'alert'}
      className={
        success
          ? 'flex items-center gap-sm rounded border border-success/40 bg-success/10 p-md font-sans text-body-sm text-on-surface'
          : 'flex items-center gap-sm rounded border border-danger/40 bg-danger/10 p-md font-sans text-body-sm text-on-surface'
      }
    >
      <MaterialIcon
        name={success ? 'check_circle' : 'error'}
        size={18}
        className={success ? 'shrink-0 text-success' : 'shrink-0 text-danger'}
      />
      {message}
    </p>
  );
}

/** Look a code up, falling back to a generic sentence rather than echoing the URL. */
export function messageFor(
  messages: Readonly<Record<string, string>>,
  code: string,
  fallback: string,
): string {
  return Object.hasOwn(messages, code) ? (messages[code] ?? fallback) : fallback;
}

/** Why a lifecycle move was refused, in words (`?refused=` from `transitionProject`). */
export const LIFECYCLE_REFUSALS: Readonly<Record<string, string>> = {
  GATE_NOT_PASSED:
    'The project did not move: a gate it needs has not passed. The lifecycle below names which.',
  APPROVAL_MISSING:
    'The project did not move: this step needs an approval that has not been recorded. Record it on the evidence page.',
  APPROVAL_STALE:
    'The project did not move: its approval was given for an earlier version and no longer applies. Approve the current version.',
  NOT_A_TRANSITION: 'The project did not move: that is not a step the lifecycle allows from here.',
  ALREADY_IN_STATE: 'The project is already there.',
  ROLE_NOT_PERMITTED: 'The project did not move: your role cannot make that step.',
  ARCHIVED: 'This project is archived. Restoring it is the only step it accepts.',
  CONCURRENT_UPDATE:
    'Somebody else changed this project at the same moment, so nothing was changed. Look again and retry.',
  NOT_FOUND: 'That project could not be found.',
  FAILED: 'The move could not be made. Nothing was changed.',
};

/** Change-request refusals (`?error=` from the change actions). */
export const CHANGE_REFUSALS: Readonly<Record<string, string>> = {
  'rate-limited': 'Too many changes in a short time. Wait a moment and try again.',
  'title-required': 'A change request needs a title.',
  'reason-required': 'A decision needs a reason, whichever way it goes.',
  'unknown-decision': 'That decision was not recognised. Nothing was changed.',
  'already-decided': 'That change request has already been decided.',
  'no-impact-recorded': 'This request has no recorded impact to apply. Raise it again.',
  archived: 'This project is archived, so it cannot be changed.',
  'not-found': 'That change request could not be found.',
  APPROVER_IS_REQUESTER:
    'The person who raised a change cannot approve it. Somebody else has to decide.',
  NOT_APPROVED: 'Only an approved change can be applied.',
  NO_CHANGES: 'The request did not change anything.',
  NO_RATIONALE: 'A change request needs a rationale.',
  STALE_BASE_VERSION:
    'The project changed after this request was raised, so its impact no longer holds. It has been superseded; raise it again.',
  UNKNOWN_NODE: 'The request refers to something that is no longer in the plan.',
  failed: 'That could not be done. Nothing was changed.',
};
