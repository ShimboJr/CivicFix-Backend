const mongoose = require('mongoose');

/**
 * SessionMessage
 *
 * Represents a one-way message sent from an admin to the resident who is
 * currently in an active LiveLocationSession.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * DESIGN RATIONALE — SILENT, POLL-BASED ONLY
 * ──────────────────────────────────────────────────────────────────────────────
 * These messages are intentionally NEVER routed through the push / system-
 * notification infrastructure.  The resident may be hiding their phone from a
 * threat; anything that causes the device to make a sound, vibrate, or light up
 * with a banner is actively dangerous.
 *
 * The resident's client polls GET /:id/messages at a short interval and renders
 * new messages in-UI without any OS-level interruption.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * DIRECTIONALITY
 * ──────────────────────────────────────────────────────────────────────────────
 * `sender` is always an admin.  The resident has exactly one response action
 * available — tapping "I'm Safe" (POST /:id/confirm-safe) — which sets a
 * timestamp on the session document.  There is no free-text reply channel on
 * the resident side; this prevents a coerced reply that could reveal the
 * resident's situation to a threat actor reading over their shoulder.
 *
 * Fields:
 *   session   — which LiveLocationSession this message belongs to
 *   sender    — the admin who sent it (always an admin — enforced by the route)
 *   text      — the message body
 *   isPreset  — true when the admin selected a canned phrase rather than typing;
 *               lets the client offer a quick-tap preset UI alongside a
 *               free-text field without needing a separate preset collection
 *   timestamps — createdAt used as the message's chronological sort key
 */
const sessionMessageSchema = new mongoose.Schema(
  {
    session: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'LiveLocationSession',
      required: [true, 'Session reference is required'],
      index:    true,
    },

    // Always an admin — the route layer enforces this with authorize('admin')
    // before the controller is ever reached.
    sender: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Sender (admin) is required'],
    },

    text: {
      type:     String,
      required: [true, 'Message text is required'],
      trim:     true,
    },

    // Differentiates quick-select canned phrases from free-text messages.
    // Stored so the client can visually distinguish them (e.g. a chip style
    // vs a bubble style) without parsing message content.
    isPreset: {
      type:    Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // createdAt is the chronological sort key for GET /:id/messages
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// getSessionMessages queries { session } and sorts by { createdAt: 1 }.
// The compound index (session + createdAt) makes this a single bounded IXSCAN
// rather than a COLLSCAN followed by an in-memory sort.
sessionMessageSchema.index({ session: 1, createdAt: 1 });

module.exports = mongoose.model('SessionMessage', sessionMessageSchema);
