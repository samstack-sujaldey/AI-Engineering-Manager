const MIN_MESSAGE_LENGTH = 10;

const SKIP_MESSAGES = new Set([
	"ok",
	"okay",
	"thanks",
	"thank you",
	"done",
	"yes",
	"no",
	"👍",
	"👌",
	"🙏",
	"received",
	"noted",
	"ack",
]);

function shouldAnalyze({
	rawMessage = "",
	parserResult = {},
}) {
	const message = rawMessage.trim().toLowerCase();

	if (!message) {
		return false;
	}

	if (SKIP_MESSAGES.has(message)) {
		return false;
	}

	if (message.length < MIN_MESSAGE_LENGTH) {
		return false;
	}

	// Skip simple acknowledgements
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