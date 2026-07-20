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
  attachments = [], // Added attachments to the destructured options
}) {
  const message = rawMessage.trim().toLowerCase();

  // ALWAYS analyze if there are files attached, regardless of text length
  if (attachments && attachments.length > 0) {
    return true;
  }

  // Skip empty messages
  if (!message) {
    return false;
  }

  // Skip very short messages (likely just acknowledgments)
  if (message.length < MIN_MESSAGE_LENGTH) {
    return false;
  }

  // Skip exact matches in our skip list
  if (SKIP_MESSAGES.has(message)) {
    return false;
  }

  // FIXED: Changed '#' to '//'
  // Skip messages that are just emojis or reactions
  if (/^[\s\p{Emoji}\p{M}]*$/u.test(message)) {
    return false;
  }

  // FIXED: Changed '#' to '//'
  // Skip if message is just a URL or very short (likely doesn't need AI analysis)
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 3) {
    return false;
  }

  // FIXED: Changed '#' to '//'
  // Skip if parser is highly confident and it's a clear task/issue being created
  if (
    parserResult.confidence > 0.9 &&
    (parserResult.classification === "TASK" || parserResult.classification === "ISSUE") &&
    parserResult.action?.startsWith("CREATE_")
  ) {
    return false;
  }

  // FIXED: Changed '#' to '//'
  // Skip if it's just an acknowledgment of dependency
  if (
    parserResult.action === "ACKNOWLEDGE_DEPENDENCY"
  ) {
    return false;
  }

  return true;
}

module.exports = {
  shouldAnalyze,
};