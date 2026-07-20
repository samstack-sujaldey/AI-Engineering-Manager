function buildPrompt({
	rawMessage,
	parserResult,
	existingTask = null,
	existingIssue = null,
	threadContext = [],
	attachments = [],
}) {
	return `
You are an AI Engineering Manager.

The parser has already analyzed this Slack message. Your job is to verify, improve and complete its output.

Rules:
- Keep correct parser values.
- Correct mistakes only when you are highly confident.
- Fill missing information if it can be inferred.
- Never invent Slack user IDs.
- Never remove IDs or rename fields.
- Return ONLY valid JSON.

Classification:

TASK
Engineering work that is completed, in progress, planned or assigned.
Examples:
- Implemented feature
- Working on API
- Fixed bug
- Tested module
- Investigated issue
- Started resolving problems
- Reviewed PR
- Deployment
- Configuration
- Refactoring
- Documentation

ISSUE
Anything blocking progress.
Examples:
- Bug
- Error
- Crash
- Failure
- API issue
- Authentication issue
- Build failure
- Dependency issue
- Waiting for approval

GENERAL_DISCUSSION
Only use when the message is NOT a task or issue.
Examples:
- Questions
- Suggestions
- Brainstorming
- Announcements
- Greetings

Priority:
URGENT
HIGH
MEDIUM
LOW

Task Status:
TODO
PROCESSING
BLOCKED
COMPLETED

Issue Status:
OPEN
HOLD
RESOLVED

Raw Message:
${rawMessage}

Parser Output:
${JSON.stringify(parserResult)}

Existing Task:
${JSON.stringify(existingTask)}

Existing Issue:
${JSON.stringify(existingIssue)}

Thread Context:
${JSON.stringify(threadContext)}

Attachments:
${JSON.stringify(attachments)}
`;
}

module.exports = {
	buildPrompt,
};