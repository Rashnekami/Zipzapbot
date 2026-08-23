export {
  isAddressableChat,
  isBroadcastJid,
  isGroupJid,
  isLidJid,
  isNewsletterJid,
  isUserJid,
  jidUser,
  normalizeJid,
  parseJid,
  sameUser,
  SERVER,
  type ParsedJid,
} from './domain/jid.js';

export { SelfIdentity } from './domain/identity.js';

export {
  hasMedia,
  resolveTargetMediaKind,
  type IncomingMessage,
  type MediaKind,
  type QuotedContext,
} from './domain/message.js';

export type {
  ConnectionState,
  GroupInfo,
  GroupParticipant,
  OutgoingMediaType,
  SendMediaInput,
  SendResult,
  SendTextInput,
  Unsubscribe,
  WhatsAppGateway,
} from './ports/whatsapp.js';

export {
  decidePacing,
  effectiveDailyCap,
  isQuietHour,
  remainingActiveMs,
  DEFAULT_PACING,
  DEFAULT_WARMUP_CAPS,
  type PacingConfig,
  type PacingDecision,
  type PacingInput,
  type PacingReason,
  type PacingState,
  type QuietHours,
  type WarmupConfig,
} from './domain/pacing.js';

export {
  selectNextDestination,
  sortByStarvation,
  type RotationCandidate,
} from './domain/destination-rotation.js';
