const MIN_MESSAGE_LENGTH = 10;

const SKIP_MESSAGES = new Set([
  "ok", "okay", "thanks", "thank you", "done", "yes", "no", "👍", "👌", "🙏",
  "received", "noted", "ack", "got it", "thanks!", "thank you!", "ok thanks",
  "ok thanks!", "thx", "thx!", "np", "np!", "cool", "nice", "good", "great",
  "awesome", "awesome!", "nice!", "good!", "great!", "lol", "lol!", "haha",
  "haha!", "hehe", "hehe!",
]);

function shouldAnalyze({
  rawMessage = "",
  parserResult = {},
  attachments = [],
}) {
  const message = rawMessage.trim().toLowerCase();

  // ALWAYS analyze when attachment files are included
  if (attachments && attachments.length > 0) {
    return true;
  }

  if (!message) {
    return false;
  }

  if (message.length < MIN_MESSAGE_LENGTH) {
    return false;
  }

  if (SKIP_MESSAGES.has(message)) {
    return false;
  }

  if (/^[\s\p{Emoji}\p{M}]*$/u.test(message)) {
    return false;
  }

  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 2) {
    return false;
  }

  if (
    parserResult.confidence > 0.9 &&
    (parserResult.classification === "TASK" || parserResult.classification === "ISSUE") &&
    parserResult.action?.startsWith("CREATE_")
  ) {
    return false;
  }

  if (parserResult.action === "ACKNOWLEDGE_DEPENDENCY") {
    return false;
  }

  return true;
}

module.exports = {
  shouldAnalyze,
};