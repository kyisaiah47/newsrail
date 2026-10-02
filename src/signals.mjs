// Two kinds of refusal, and the exit code each one gets.
//
// SlotStillOwed is a refusal about ONE candidate: a code gate refused the draft, no card could be
// rendered, the model wrote nothing usable, the pool had nothing fresh. Another item, another
// draft or the next tick answers it, so the slot is still owed and the tick reports `owed: true`.
//
// PlatformSignal is a statement about the ACCOUNT: an auth failure, a rate limit, a ban or
// suspension, an identity mismatch. Composing again cannot answer it, so the platform stops for
// this tick and the reason is reported once.
//
// Exit codes (the CLI uses these, and a scheduler can read them):
//   0   posted, owed, or a platform signal. None of these is a fault in the agent itself, so none
//       should trip a scheduler's failure breaker.
//   75  a hold: the wire is outside its active hours, inside its gap, or not armed (EX_TEMPFAIL).
//   1   a fault in the agent's own machinery: bad config, a crash, an unreadable file.

export class SlotStillOwed extends Error {
  constructor(why, { kind = '', subject = '' } = {}) {
    super(String(why || 'the draft was refused'));
    this.name = 'SlotStillOwed';
    this.slotStillOwed = true;
    this.kind = kind;
    this.subject = subject;
  }
}

export class PlatformSignal extends Error {
  constructor(signal, detail = '', { platform = '', status = 0 } = {}) {
    super(`STOPPED: ${signal}${detail ? `. ${detail}` : ''}`);
    this.name = 'PlatformSignal';
    this.platformSignal = signal;
    this.platform = platform;
    this.status = status;
  }
}

export const isOurs = (e) => Boolean(e && (e.slotStillOwed || e.name === 'SlotStillOwed'));
export const isTheirs = (e) => Boolean(e && (e.platformSignal || e.name === 'PlatformSignal'));

/** The exit code for a tick result or a thrown error. */
export function exitCode(resultOrError) {
  const r = resultOrError;
  if (!r) return 0;
  if (r instanceof Error) return isOurs(r) || isTheirs(r) ? 0 : 1;
  if (r.hold) return 75;
  return 0;
}

/**
 * Turn an HTTP failure from a platform into the right kind of error.
 * 401 and 403 are an auth wall, 429 is a rate limit. Anything else is a fault in the request.
 */
export function platformError(platform, status, body = '') {
  const text = String(body || '').slice(0, 300);
  if (/takedown|suspend|banned|deactivated|disabled/i.test(text)) {
    return new PlatformSignal('the account is suspended or taken down', text, { platform, status });
  }
  if (status === 401 || status === 403) {
    return new PlatformSignal(`the platform answered ${status}, so the sign-in failed or the token lacks a scope`, text, { platform, status });
  }
  if (status === 429) return new PlatformSignal('the platform rate-limited the account (429)', text, { platform, status });
  const e = new Error(`${platform} answered ${status}: ${text}`);
  e.status = status;
  return e;
}
