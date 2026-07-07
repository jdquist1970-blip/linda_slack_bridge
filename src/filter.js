/**
 * Decides whether a Slack event should be forwarded to Linda.
 * Pure function — no side-effects, easy to test.
 *
 * @param {object} event          – Slack message event
 * @param {object} opts
 * @param {string} opts.botUserId – the bot's own Slack user id (from auth.test)
 * @param {string[]} opts.channelIds – allow-listed channel ids (empty = all)
 * @returns {boolean}
 */
export function shouldHandle(event, { botUserId, channelIds }) {
  // Subtypes cover edits, deletes, joins, bot_message, etc. — ignore all.
  if (event.subtype) return false;

  // Skip anything posted by a bot (includes other integrations).
  if (event.bot_id) return false;

  // Skip our own messages (belt-and-suspenders with bot_id check above).
  if (event.user === botUserId) return false;

  // Channel allow-list: if configured, only act in those channels.
  if (channelIds.length > 0 && !channelIds.includes(event.channel)) return false;

  // Must have actual text to forward.
  if (!event.text) return false;

  return true;
}
