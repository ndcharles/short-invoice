/**
 * The answer to "can this destination be cloaked?", shared by the Worker (which works it out) and the
 * editors (which show it). A cloaked link shows its destination in a frame, and some sites cannot be shown
 * that way, so cloaking them gives visitors a blank page.
 */

/** What the person sees when cloaking is refused. */
export const NOT_CLOAKABLE = 'This link cannot be cloaked';

export type CloakCheck =
  /** The destination can be shown in a frame. */
  | { status: 'ok' }
  /** It cannot: `message` says why, in plain words, for the person turning cloaking on. */
  | { status: 'blocked'; host: string; reason: 'frame-options' | 'frame-ancestors' | 'known-site'; message: string }
  /**
   * Could not tell, so cloaking is allowed. not-checked: the address is not one we look at (a private address,
   * or looking is switched off). unreachable: the site did not answer. turned-away: it answered the check with
   * a refusal or a bot challenge, which says nothing about how it behaves for a real visitor.
   */
  | { status: 'unknown'; why: 'not-checked' | 'unreachable' | 'turned-away' };
