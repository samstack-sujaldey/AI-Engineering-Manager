const { randomUUID } = require('crypto');

function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Token-based Jaccard + character similarity for duplicate detection.
 * Returns 0..1 score.
 */
function similarity(a = '', b = '') {
  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/<@([A-Z0-9]+)>/g, '')
      .replace(/@[A-Za-z][\w.-]*/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? intersection / union : 0;

  // Cheap sequence ratio on shorter/longer
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  let matches = 0;
  for (let i = 0; i < shorter.length; i += 1) {
    if (longer.includes(shorter.slice(i, i + 3))) matches += 1;
  }
  const seq = shorter.length ? matches / shorter.length : 0;

  return Math.min(1, jaccard * 0.7 + seq * 0.3);
}

function isOverdue(dueDate, now = new Date()) {
  if (!dueDate) return false;
  return new Date(dueDate) < now;
}

module.exports = { newId, similarity, isOverdue };
