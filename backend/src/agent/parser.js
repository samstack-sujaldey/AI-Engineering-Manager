/**
 * Stateless Task Intelligence Parser
 * Analyzes a Slack message + context and returns structured JSON.
 * Does not persist state — the application layer owns storage & reminders.
 */

const config = require("../config");

const PRIORITY = {
	URGENT: [
		/\bcritical\b/i,
		/\basap\b/i,
		/\bimmediately\b/i,
		/\bproduction\b/i,
		/\bhotfix\b/i,
		/\bp0\b/i,
		/\burgent\b/i,
		/\boutage\b/i,
		/\bsev[-\s]?0\b/i,
	],
	HIGH: [
		/\bimportant\b/i,
		/\bpriority\b/i,
		/\bp1\b/i,
		/\bhigh\b/i,
		/\bsev[-\s]?1\b/i,
	],
	LOW: [
		/\bminor\b/i,
		/\blater\b/i,
		/\bnice\s+to\s+have\b/i,
		/\bwhenever\s+possible\b/i,
		/\blow\b/i,
		/\bp3\b/i,
	],
};

const STATUS = {
	COMPLETED: [
		/\bdone\b/i,
		/\bcomplet(e|ed)\b/i,
		/\bresolved\b/i,
		/\bmerged\b/i,
		/\bfixed\b/i,
		/\bfinished\b/i,
		/\bshipped\b/i,
		/\bclosed\b/i,
	],
	PROCESSING: [
		/\bprocessing\b/i,
		/\bworking\s+on\b/i,
		/\bimplementing\b/i,
		/\bcoding\b/i,
		/\btesting\b/i,
		/\bin\s+progress\b/i,
		/\bwip\b/i,
		/\bstarting\b/i,
	],
	BLOCKED: [
		/\bblock(e|ed)\b/i,
		/\bwaiting\s+(for|on)\b/i,
		/\bpending\b/i,
		/\bcannot\s+continue\b/i,
		/\bwaiting\s+approval\b/i,
		/\bwaiting\s+review\b/i,
		/\bblocker\b/i,
		/\bstuck\b/i,
	],
};

const ISSUE_PATTERNS = [
	/\bissue\b/i,
	/\bnot\s+showing\b/i,
	/\bproblem\b/i,
	/\bbug\b/i,
	/\bcrash(ed|ing)?\b/i,
	/\boutage\b/i,
	/\bdown\b/i,
	/\bfail(ed|ure|ing)?\b/i,
	/\berror\b/i,
	/\bincident\b/i,
	/\bregression\b/i,
	/\btimeout\b/i,
	/\bisn'?t\s+working\b/i,
	/\bnot\s+working\b/i,
	/\bbroken\b/i,
	/\bunexpected\b/i,
	/\bexception\b/i,
	/\b500\b/,
	/\bnull\s+pointer\b/i,
	/\bproduction\s+issue\b/i,
	/\bapi\s+fail/i,
	/\bauth(entication)?\s+fail/i,
	/\bdeploy(ment)?\s+fail/i,
	/\bsev[-\s]?[0-2]\b/i,
];

const TASK_PATTERNS = [
	/\btask\s*-/i,
	/\b(please\s+)?(deploy|create|build|implement|add|fix|update|prepare|finish|complete|write|review|merge|ship|release|migrate|refactor|handle|take\s+care)\b/i,
	/\b(need(s)?\s+to|should|must|have\s+to)\b/i,
	/\bi'?ll\s+(finish|do|deploy|create|fix|update|handle|work)\b/i,
	/\bassign(ed)?\s+(this\s+)?to\b/i,
	/\bwill\s+(deploy|finish|do|handle|fix|update|create)\b/i,
	/\bis\s+working\s+on\b/i,
	/\blet\s+\w+\s+finish\b/i,
];

const DISCUSSION_PATTERNS = [
	/\bwhat\s+(do\s+you|if|about)\b/i,
	/\bidea(s)?\b/i,
	/\bbrainstorm\b/i,
	/\barchitecture\b/i,
	/\bplanning\b/i,
	/\bannounce(ment)?\b/i,
	/\bthoughts\??\b/i,
	/\bcurious\b/i,
	/\bfyi\b/i,
	/\bheads\s+up\b/i,
];

const DEPENDENCY_PATTERNS = [
	{ type: "Waiting for Review", re: /waiting\s+(for|on)\s+(a\s+)?review/i },
	{
		type: "Waiting for Approval",
		re: /waiting\s+(for|on)\s+(a\s+)?approval/i,
	},
	{ type: "Waiting for Merge", re: /waiting\s+(for|on)\s+(a\s+)?merge/i },
	{
		type: "Waiting for Deployment",
		re: /waiting\s+(for|on)\s+(a\s+)?deploy/i,
	},
	{ type: "Waiting for API", re: /waiting\s+(for|on)\s+(the\s+)?api/i },
	{ type: "Waiting for Access", re: /waiting\s+(for|on)\s+access/i },
	{
		type: "Waiting for Infrastructure",
		re: /waiting\s+(for|on)\s+(infra|infrastructure)/i,
	},
	{ type: "Waiting for User", re: /waiting\s+(for|on)\s+<?@?([\w.-]+)>?/i },
];

const ASSIGNEE_PATTERNS = [
	/(?:^|\s)(?:<@([A-Z0-9]+)>|@([A-Za-z0-9_.-]+))\s+(?:task|issue)\s*-/i,
	/(?:^|\s)<@([A-Z0-9]+)>\s*(?:please\s+)?(?:handle|finish|fix|update|deploy|create|take|do|review|look\s+at)\b/i,
	/(?:^|\s)@([A-Za-z][\w.-]*)\s+(?:please\s+)?(?:handle|finish|fix|update|deploy|create|take|do|review)\b/i,
	/\bassign(?:ed)?\s+(?:this\s+)?to\s+(?:<@([A-Z0-9]+)>|@?([A-Za-z][\w.-]*))/i,
	/\b([A-Za-z][\w.-]*)\s+will\s+(?:deploy|finish|do|handle|fix|update|create|take)/i,
	/\b([A-Za-z][\w.-]*)\s+is\s+working\s+on\b/i,
	/\blet\s+([A-Za-z][\w.-]*)\s+finish\b/i,
	/(?:^|\s)<@([A-Z0-9]+)>\s+please\b/i,
	/(?:^|\s)@([A-Za-z][\w.-]*)\s+please\b/i,
];

const SELF_ASSIGN_PATTERNS = [
	/\bi'?ll\s+(finish|do|deploy|create|fix|update|handle|work|take)/i,
	/\bi\s+am\s+working\s+on\b/i,
	/\bi'm\s+working\s+on\b/i,
	/\bmy\s+task\b/i,
];

const UNASSIGNED_PATTERNS = [
	/\bcan\s+someone\b/i,
	/\banyone\b/i,
	/\bwho\s+can\b/i,
	/\bvolunteer\b/i,
	/\bneed\s+(a\s+)?volunteer\b/i,
];

const ACK_PATTERNS = [
	/^\s*(ok|okay|acknowledged|working\s+on\s+it|got\s+it|i'?ll\s+handle\s+it)\s*[.!]?\s*$/i,
];

const WEEKDAYS = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
};

function emptyUser() {
	return { id: "", name: "", display_name: "", email: "" };
}

function normalizePersonName(value = "") {
	const trimmed = String(value || "").trim();
	if (!trimmed) return "";

	const withoutAngleBrackets = trimmed.replace(/^<|>$/g, "").trim();
	if (!withoutAngleBrackets) return "";

	if (withoutAngleBrackets.includes("@")) {
		return withoutAngleBrackets.split("@")[0].trim();
	}

	return withoutAngleBrackets.replace(/[_-]+/g, " ").trim();
}

function toUser(u = {}) {
	const primaryName = normalizePersonName(u.name || u.real_name || "");
	const displayName = normalizePersonName(
		u.display_name || u.real_name || u.name || "",
	);

	return {
		id: u.id || u.slack_id || "",
		name: primaryName || u.name || u.real_name || "",
		display_name: displayName || primaryName || u.name || u.real_name || "",
		email: u.email || "",
	};
}

function matchAny(text, patterns) {
	return patterns.some((p) => p.test(text));
}

function scoreMatches(text, patterns) {
	return patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
}

function extractMentionedUsers(text, userDirectory = {}) {
	const users = [];
	const seen = new Set();
	const lowerText = text.toLowerCase();

	// 1. Extract Slack ID mentions (<@U123456>)
	const idMentions = [...text.matchAll(/<@([A-Z0-9]+)>/g)];
	for (const m of idMentions) {
		const id = m[1];
		if (seen.has(id)) continue;
		seen.add(id);
		const known = userDirectory[id] || {};
		users.push(toUser({ id, ...known }));
	}

	// 2. Extract @username mentions
	const nameMentions = [...text.matchAll(/(?:^|\s)@([A-Za-z][\w.-]*)/g)];
	for (const m of nameMentions) {
		const name = m[1];
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const known =
			Object.values(userDirectory).find(
				(u) =>
					(u.name || "").toLowerCase() === key ||
					(u.display_name || "").toLowerCase() === key ||
					(u.real_name || "").toLowerCase().split(/\s+/)[0] === key,
			) || {};
		users.push(toUser({ name, display_name: name, ...known }));
	}

	// 3. Match plain-text names against workspace user directory
	const cleanWords = lowerText.replace(/[^a-z0-9\s]/g, "").split(/\s+/);
	Object.values(userDirectory).forEach((u) => {
		if (!u.id || seen.has(u.id)) return;
		const handle = (u.name || "").toLowerCase();
		const displayName = (u.display_name || "").toLowerCase();
		const firstName = (u.real_name || "").toLowerCase().split(/\s+/)[0];

		const isMatched = cleanWords.some(
			(w) =>
				w.length > 2 &&
				(w === handle || w === displayName || w === firstName),
		);

		if (isMatched) {
			seen.add(u.id);
			users.push(toUser(u));
		}
	});

	return users;
}

function detectAssignee(text, sender, mentionedUsers) {
	if (matchAny(text, UNASSIGNED_PATTERNS)) {
		return {
			owner: { id: "", name: "Unassigned" },
			assigned_to: { id: "", name: "Unassigned" },
			assigned_by: toUser(sender),
			needs_assignment: true,
		};
	}

	for (const pattern of ASSIGNEE_PATTERNS) {
		const m = text.match(pattern);
		if (!m) continue;
		const token = m[1] || m[2] || m[3];
		if (!token) continue;

		const mentioned =
			mentionedUsers.find(
				(u) =>
					u.id === token ||
					(u.name || "").toLowerCase() === token.toLowerCase() ||
					(u.display_name || "").toLowerCase() ===
						token.toLowerCase(),
			) || null;

		const assignee =
			mentioned ||
			toUser({
				id: /^[A-Z0-9]+$/.test(token) ? token : "",
				name: token,
				display_name: token,
			});

		return {
			owner: assignee,
			assigned_to: assignee,
			assigned_by: toUser(sender),
			needs_assignment: false,
		};
	}

	if (matchAny(text, SELF_ASSIGN_PATTERNS)) {
		const self = toUser(sender);
		return {
			owner: self,
			assigned_to: self,
			assigned_by: self,
			needs_assignment: false,
		};
	}

	if (mentionedUsers.length > 0) {
		const target =
			mentionedUsers.find((u) => u.id !== sender.id) || mentionedUsers[0];
		return {
			owner: target,
			assigned_to: target,
			assigned_by: toUser(sender),
			needs_assignment: false,
		};
	}

	const senderUser = toUser(sender);
	return {
		owner: senderUser,
		assigned_to: senderUser,
		assigned_by: senderUser,
		needs_assignment: false,
	};
}

function detectPriority(text) {
	if (matchAny(text, PRIORITY.URGENT)) return "URGENT";
	if (matchAny(text, PRIORITY.HIGH)) return "HIGH";
	if (matchAny(text, PRIORITY.LOW)) return "LOW";
	return "MEDIUM";
}

function detectStatus(text) {
	const lower = text.toLowerCase();
	// 🟢 FIXED: Added 'resolved' and 'resolve' to the match list
	if (/\b(?:done|completed|finished|resolved|resolve)\b/.test(lower))
		return "COMPLETED";
	if (/\b(?:block|blocked|stuck|hold)\b/.test(lower)) return "BLOCKED";
	if (/\b(?:processing|doing|working|in progress|open)\b/.test(lower))
		return "PROCESSING";
	return "TODO";
}

function nextWeekday(from, dayIndex) {
	const d = new Date(from);
	const diff = (dayIndex + 7 - d.getDay()) % 7 || 7;
	d.setDate(d.getDate() + diff);
	d.setHours(17, 0, 0, 0);
	return d;
}

function parseTimeOfDay(text, base) {
	const m = text.match(/\b(\d{1,2})(?:[:\s](\d{2}))?\s*(am|pm)\b/i);
	if (!m) return null;
	let hours = parseInt(m[1], 10);
	const minutes = parseInt(m[2] || "0", 10);
	const meridiem = m[3].toLowerCase();

	if (meridiem === "pm" && hours < 12) hours += 12;
	if (meridiem === "am" && hours === 12) hours = 0;

	const d = new Date(base);
	d.setHours(hours, minutes, 0, 0);
	return d;
}

function extractDueDate(text, now = new Date()) {
	const lower = text.toLowerCase();

	if (/\btoday\b/.test(lower) || /\btonight\b/.test(lower)) {
		const d = new Date(now);
		if (/\btonight\b/.test(lower)) d.setHours(21, 0, 0, 0);
		else {
			const withTime = parseTimeOfDay(text, d);
			if (withTime) return withTime.toISOString();
			d.setHours(17, 0, 0, 0);
		}
		return d.toISOString();
	}

	if (/\btomorrow\b/.test(lower)) {
		const d = new Date(now);
		d.setDate(d.getDate() + 1);
		const withTime = parseTimeOfDay(text, d);
		if (withTime) return withTime.toISOString();
		d.setHours(17, 0, 0, 0);
		return d.toISOString();
	}

	if (/\bend\s+of\s+(the\s+)?week\b/.test(lower) || /\beow\b/.test(lower)) {
		return nextWeekday(now, 5).toISOString();
	}

	if (/\bend\s+of\s+(the\s+)?sprint\b/.test(lower)) {
		const d = new Date(now);
		d.setDate(d.getDate() + 14);
		d.setHours(17, 0, 0, 0);
		return d.toISOString();
	}

	const nextDay = lower.match(
		/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
	);
	if (nextDay) {
		const d = nextWeekday(now, WEEKDAYS[nextDay[1]]);
		if (d - now < 7 * 24 * 3600 * 1000) d.setDate(d.getDate() + 7);
		return d.toISOString();
	}

	const dayOnly = lower.match(
		/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
	);
	if (dayOnly) {
		return nextWeekday(now, WEEKDAYS[dayOnly[1]]).toISOString();
	}

	const absolute = text.match(
		/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
	);
	if (absolute) {
		const months = {
			jan: 0,
			january: 0,
			feb: 1,
			february: 1,
			mar: 2,
			march: 2,
			apr: 3,
			april: 3,
			may: 4,
			jun: 5,
			june: 5,
			jul: 6,
			july: 6,
			aug: 7,
			august: 7,
			sep: 8,
			sept: 8,
			september: 8,
			oct: 9,
			october: 9,
			nov: 10,
			november: 10,
			dec: 11,
			december: 11,
		};
		const day = parseInt(absolute[1], 10);
		const month = months[absolute[2].toLowerCase()];
		const d = new Date(now.getFullYear(), month, day, 17, 0, 0, 0);
		if (d < now) d.setFullYear(d.getFullYear() + 1);
		return d.toISOString();
	}

	const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
	if (iso) {
		const d = new Date(`${iso[1]}T17:00:00`);
		return d.toISOString();
	}

	const timeOnly = parseTimeOfDay(text, now);
	if (timeOnly) return timeOnly.toISOString();

	return null;
}

function extractDependencies(text) {
	const deps = [];
	for (const { type, re } of DEPENDENCY_PATTERNS) {
		if (re.test(text)) deps.push(type);
	}
	return [...new Set(deps)];
}

function extractBlockedReason(text) {
	const explicitMatch = text.match(
		/(?:reason|blocker|blocked\s+by)[\s:-]+(.+?)(?:\n|$)/i,
	);
	if (explicitMatch) return explicitMatch[1].trim();

	const naturalMatch =
		text.match(
			/blocked\s+(?:because|due\s+to|by|on)\s+(.+?)(?:\.|\n|$)/i,
		) ||
		text.match(/waiting\s+(?:for|on)\s+(.+?)(?:\.|\n|$)/i) ||
		text.match(
			/cannot\s+continue\s+(?:because|due\s+to)\s+(.+?)(?:\.|\n|$)/i,
		);

	return naturalMatch ? naturalMatch[1].trim() : "";
}

function extractEntities(text) {
	const urls = [...text.matchAll(/https?:\/\/[^\s>|]+/g)].map((m) => m[0]);
	const pr = text.match(/\b(?:pr|pull\s*request)\s*#?(\d+)/i);
	const commit = text.match(/\b([a-f0-9]{7,40})\b/i);
	const branch = text.match(
		/\b(?:branch|on)\s+[`'"]?([A-Za-z0-9._/-]+)[`'"]?/i,
	);
	const repo = text.match(
		/\b(?:repo|repository)\s+[`'"]?([A-Za-z0-9._/-]+)[`'"]?/i,
	);
	const ticket = text.match(/\b([A-Z]{2,10}-\d+)\b/);
	const sprint = text.match(/\bsprint\s+(\d+|[\w-]+)/i);
	const files = [
		...text.matchAll(
			/[`'"]([^`'"]+\.(?:js|ts|tsx|jsx|py|go|java|rb|php|css|html|json|yml|yaml|md))[`'"]/gi,
		),
	].map((m) => m[1]);

	return {
		repository: repo ? repo[1] : "",
		branch: branch ? branch[1] : "",
		commit: commit && !/^20\d{2}/.test(commit[1]) ? commit[1] : "",
		pull_request: pr ? pr[1] : "",
		ticket: ticket ? ticket[1] : "",
		sprint: sprint ? sprint[1] : "",
		urls,
		files,
	};
}

function classifyMessage(text) {
	const lowerText = text.toLowerCase().trim();

	// 🟢 FIX 1: Prevent reason replies from triggering new issues/tasks
	if (
		lowerText.startsWith("reason -") ||
		lowerText.startsWith("reason:") ||
		lowerText.includes(" reason -")
	) {
		return {
			classification: "GENERAL_DISCUSSION",
			confidence: 0.99,
			needs_human_review: false,
		};
	}

	if (
		lowerText.startsWith("task -") ||
		lowerText.includes(" task -") ||
		lowerText.includes("> task -")
	) {
		return {
			classification: "TASK",
			confidence: 0.99,
			needs_human_review: false,
		};
	}
	if (
		lowerText.startsWith("issue -") ||
		lowerText.includes(" issue -") ||
		lowerText.includes("> issue -")
	) {
		return {
			classification: "ISSUE",
			confidence: 0.99,
			needs_human_review: false,
		};
	}

	const issueScore = scoreMatches(text, ISSUE_PATTERNS);
	const taskScore = scoreMatches(text, TASK_PATTERNS);
	const discussionScore = scoreMatches(text, DISCUSSION_PATTERNS);

	let classification = "GENERAL_DISCUSSION";
	let confidence = 0.55;

	if (issueScore > 0 && issueScore >= taskScore) {
		classification = "ISSUE";
		confidence = Math.min(0.98, 0.72 + issueScore * 0.08);
	} else if (taskScore > 0) {
		classification = "TASK";
		confidence = Math.min(0.98, 0.7 + taskScore * 0.07);
	} else if (discussionScore > 0) {
		classification = "GENERAL_DISCUSSION";
		confidence = Math.min(0.95, 0.75 + discussionScore * 0.05);
	}

	// Imperative command fallback
	if (
		/^[A-Z]?[a-z]+\s+the\s+\w+/i.test(text) &&
		taskScore === 0 &&
		issueScore === 0
	) {
		if (
			!/\b(is|are|was|were|isn't|aren't)\b/i.test(text) &&
			/\b(deploy|create|fix|update|build|add|prepare)\b/i.test(text)
		) {
			classification = "TASK";
			confidence = 0.85;
		}
	}

	if (confidence < config.confidenceFloor) {
		return {
			classification: "GENERAL_DISCUSSION",
			confidence,
			needs_human_review: true,
		};
	}

	return { classification, confidence, needs_human_review: false };
}

function generateTitle(text, classification) {
	let cleaned = text
		.replace(/<@([A-Z0-9]+)>/g, "")
		.replace(/@[A-Za-z][\w.-]*/g, "")
		.replace(/https?:\/\/\S+/g, "")
		.replace(/\s+/g, " ")
		.trim();

	cleaned = cleaned.replace(/^.*?(task|issue)\s*-\s*/i, "");
	cleaned = cleaned
		.replace(
			/\s*-\s*(block(ed)?|done|todo|processing|in progress)\s*$/i,
			"",
		)
		.trim();

	if (cleaned.endsWith("]")) cleaned = cleaned.slice(0, -1).trim();

	const sentence = cleaned.split(/[.!?\n]/)[0].trim();
	if (!sentence)
		return classification === "ISSUE" ? "Untitled Issue" : "Untitled Task";
	return sentence.length > 100 ? `${sentence.slice(0, 97)}...` : sentence;
}

function detectWatchersAndReviewers(text, mentionedUsers, assignedTo) {
	const watchers = [];
	const reviewers = [];

	if (
		/cc\s*:?/i.test(text) ||
		/\bfyi\b/i.test(text) ||
		/\bwatch(ing)?\b/i.test(text)
	) {
		for (const u of mentionedUsers) {
			if (u.id !== (assignedTo && assignedTo.id)) watchers.push(u);
		}
	}

	if (/\breview(er|ing)?\b/i.test(text)) {
		for (const u of mentionedUsers) {
			if (u.id !== (assignedTo && assignedTo.id)) reviewers.push(u);
		}
	}

	return { watchers, reviewers };
}

function isAcknowledgement(text) {
	return ACK_PATTERNS.some((p) => p.test(text.trim()));
}

function buildNotificationHints({
	classification,
	title,
	owner,
	dueDate,
	status,
	blockedReason,
	text,
	mentionedUsers,
}) {
	const notifications = [];

	if (
		classification === "TASK" &&
		!dueDate &&
		owner?.id &&
		status !== "COMPLETED"
	) {
		notifications.push({
			type: "MISSING_DUE_DATE",
			target_user_id: owner.id,
			target_user_name: owner.name || owner.display_name || "",
			message: `I couldn't determine the due date for your task '${title}'. Please reply with the due date.`,
			immediate: true,
		});
	}

	if (
		classification === "TASK" &&
		status === "BLOCKED" &&
		!blockedReason &&
		owner?.id
	) {
		notifications.push({
			type: "MISSING_BLOCK_REASON",
			target_user_id: owner.id,
			target_user_name: owner.name || owner.display_name || "",
			message:
				"Your task is marked as blocked. Please tell me what is blocking it.",
			immediate: true,
		});
	}

	if (classification === "ISSUE" && mentionedUsers.length > 0) {
		const dependent =
			mentionedUsers.find((u) => u.id !== owner?.id) || mentionedUsers[0];

		if (dependent?.id && dependent.id !== owner?.id) {
			notifications.push({
				type: "DEPENDENT_USER",
				target_user_id: dependent.id,
				target_user_name:
					dependent.name || dependent.display_name || "",
				message: `@${dependent.name || dependent.display_name}, ${owner?.name || "Someone"} reported an issue ('${title}') and needs to connect with you. Please reply 'resolved' or 'done' in the thread when fixed!`,
				immediate: true,
				expects_acknowledgement: true,
			});
		}
	}

	return notifications;
}

function buildResponse(partial) {
	return {
		classification: partial.classification || "GENERAL_DISCUSSION",
		confidence: partial.confidence ?? 0.5,
		action: partial.action || "NONE",
		task_created: partial.task_created || false,
		task_updated: partial.task_updated || false,
		issue_created: partial.issue_created || false,
		issue_updated: partial.issue_updated || false,
		acknowledgement: partial.acknowledgement || false,
		sender: partial.sender || emptyUser(),
		owner: partial.owner || null,
		assigned_to: partial.assigned_to || null,
		assigned_by: partial.assigned_by || null,
		reporter: partial.reporter || null,
		mentioned_users: partial.mentioned_users || [],
		task: partial.task || null,
		issue: partial.issue || null,
		discussion: partial.discussion || null,
		updates: partial.updates || null,
		notifications: partial.notifications || [],
		dashboard_update: true,
		context: {
			channel: partial.channel || "",
			thread_id: partial.thread_id || "",
			workspace_id: partial.workspace_id || "",
			team: partial.team || "",
			message_ts: partial.message_ts || "",
		},
		meta: partial.meta || {},
	};
}

async function parseMessage(input) {
	const {
		text = "",
		sender = {},
		channel = "",
		thread_id = "",
		workspace_id = "",
		team = "",
		message_ts = "",
		is_edit = false,
		user_directory = {},
		existing_task = null,
		existing_issue = null,
		thread_context = [],
		now = new Date(),
	} = input;

	const senderUser = toUser(sender);
	const mentionedUsers = extractMentionedUsers(text, user_directory);
	const assignment = detectAssignee(text, senderUser, mentionedUsers);
	const priority = detectPriority(text);
	const status = detectStatus(text);
	const dueDate = extractDueDate(text, now);
	const dependencies = extractDependencies(text);
	const blockedReason = extractBlockedReason(text);
	const entities = extractEntities(text);
	const { classification, confidence, needs_human_review } =
		classifyMessage(text);
	const { watchers, reviewers } = detectWatchersAndReviewers(
		text,
		mentionedUsers,
		assignment.assigned_to,
	);

	const linkingTask =
		existing_task ||
		(thread_context.find((c) => c.task_id)
			? { task_id: thread_context.find((c) => c.task_id).task_id }
			: null);
	const linkingIssue =
		existing_issue ||
		(thread_context.find((c) => c.issue_id)
			? { issue_id: thread_context.find((c) => c.issue_id).issue_id }
			: null);

	if (isAcknowledgement(text) && (linkingTask || linkingIssue)) {
		return buildResponse({
			classification: "GENERAL_DISCUSSION",
			confidence: 0.99,
			action: "ACKNOWLEDGE_DEPENDENCY",
			sender: senderUser,
			mentioned_users: mentionedUsers,
			channel,
			thread_id,
			workspace_id,
			team,
			message_ts,
			acknowledgement: true,
			task: linkingTask
				? {
						id: linkingTask.task_id || linkingTask.id,
						title: linkingTask.title || "",
						description: linkingTask.description || "",
						priority: linkingTask.priority || "",
						status: linkingTask.status || "",
						due_date: linkingTask.due_date || "",
						dependencies: linkingTask.dependencies || [],
					}
				: null,
			issue: linkingIssue
				? {
						id: linkingIssue.issue_id || linkingIssue.id,
						title: linkingIssue.title || "",
						status: linkingIssue.status || "",
						priority: linkingIssue.priority || "",
						root_cause: linkingIssue.root_cause || "",
						blocked_reason: linkingIssue.blocked_reason || "",
					}
				: null,
			notifications: [],
			meta: { is_edit, needs_human_review: false },
		});
	}

if (
		(linkingTask || linkingIssue) &&
		classification === "GENERAL_DISCUSSION" &&
		thread_id
	) {
		const updates = {};

		if (dueDate && linkingTask) updates.due_date = dueDate;
        
        // 🟢 FIX 2: Ensure the extracted reason is passed into the update payload
		if (blockedReason && linkingTask) updates.blocked_reason = blockedReason;

		if (Object.keys(updates).length > 0 || text.trim()) {
			return buildResponse({
				classification: "GENERAL_DISCUSSION",
				confidence,
				action: Object.keys(updates).length
					? "UPDATE_LINKED_WORK"
					: "LINK_DISCUSSION",
				sender: senderUser,
				owner: assignment.owner,
				assigned_to: assignment.assigned_to,
				assigned_by: assignment.assigned_by,
				reporter: senderUser,
				mentioned_users: mentionedUsers,
				channel,
				thread_id,
				workspace_id,
				team,
				message_ts,
				discussion: {
					content: text,
					task_id: linkingTask
						? linkingTask.task_id || linkingTask.id
						: null,
					issue_id: linkingIssue
						? linkingIssue.issue_id || linkingIssue.id
						: null,
				},
				updates,
				notifications: [],
				meta: {
					is_edit,
					needs_human_review,
					watchers,
					reviewers,
					entities,
					needs_assignment: assignment.needs_assignment,
				},
			});
		}
	}

	if (classification === "TASK") {
		const title = generateTitle(text, "TASK");
		const action = existing_task ? "UPDATE_TASK" : "CREATE_TASK";

		return buildResponse({
			classification: "TASK",
			confidence,
			action,
			task_created: action === "CREATE_TASK",
			task_updated: action === "UPDATE_TASK",
			sender: senderUser,
			owner: assignment.owner,
			assigned_to: assignment.assigned_to,
			assigned_by: assignment.assigned_by,
			reporter: senderUser,
			mentioned_users: mentionedUsers,
			channel,
			thread_id,
			workspace_id,
			team,
			message_ts,
			task: {
				id: existing_task
					? existing_task.task_id || existing_task.id
					: "",
				title: existing_task?.title || title,
				description: text,
				priority,
				status: status !== "TODO" ? status : "TODO",
				due_date: dueDate || "",
				dependencies,
				blocked_reason: blockedReason,
				needs_assignment: assignment.needs_assignment,
				due_date_pending: !dueDate,
				block_reason_pending: status === "BLOCKED" && !blockedReason,
			},
			notifications: buildNotificationHints({
				classification: "TASK",
				title: existing_task?.title || title,
				owner: assignment.owner,
				dueDate,
				status,
				blockedReason,
				text,
				mentionedUsers,
			}),
			meta: {
				is_edit,
				needs_human_review,
				watchers,
				reviewers,
				entities,
				needs_assignment: assignment.needs_assignment,
			},
		});
	}

	if (classification === "ISSUE") {
		const title = generateTitle(text, "ISSUE");
		const action = existing_issue ? "UPDATE_ISSUE" : "CREATE_ISSUE";
		const issueStatus = status === "COMPLETED" ? "RESOLVED" : "HOLD";

		return buildResponse({
			classification: "ISSUE",
			confidence,
			action,
			issue_created: action === "CREATE_ISSUE",
			issue_updated: action === "UPDATE_ISSUE",
			sender: senderUser,
			owner: assignment.owner,
			assigned_to: assignment.assigned_to,
			assigned_by: assignment.assigned_by,
			reporter: senderUser,
			mentioned_users: mentionedUsers,
			channel,
			thread_id,
			workspace_id,
			team,
			message_ts,
			issue: {
				id: existing_issue
					? existing_issue.issue_id || existing_issue.id
					: "",
				title: existing_issue?.title || title,
				description: text,
				status: issueStatus,
				priority: priority === "MEDIUM" ? "HIGH" : priority,
				root_cause: "",
				blocked_reason: "",
				block_reason_pending: false,
				needs_assignment: assignment.needs_assignment,
				dependencies,
			},
			notifications: buildNotificationHints({
				classification: "ISSUE",
				title: existing_issue?.title || title,
				owner: assignment.owner,
				status: issueStatus,
				blockedReason,
				text,
				mentionedUsers,
			}),
			meta: {
				is_edit,
				needs_human_review,
				watchers,
				reviewers,
				entities,
				needs_assignment: assignment.needs_assignment,
			},
		});
	}

	return buildResponse({
		classification: "GENERAL_DISCUSSION",
		confidence,
		action:
			linkingTask || linkingIssue
				? "LINK_DISCUSSION"
				: "STORE_DISCUSSION",
		sender: senderUser,
		owner: assignment.needs_assignment
			? { id: "", name: "Unassigned" }
			: null,
		assigned_to: null,
		assigned_by: null,
		reporter: senderUser,
		mentioned_users: mentionedUsers,
		channel,
		thread_id,
		workspace_id,
		team,
		message_ts,
		discussion: {
			content: text,
			task_id: linkingTask ? linkingTask.task_id || linkingTask.id : null,
			issue_id: linkingIssue
				? linkingIssue.issue_id || linkingIssue.id
				: null,
			flagged_for_review: needs_human_review,
		},
		notifications: [],
		meta: { is_edit, needs_human_review, watchers, reviewers, entities },
	});
}

module.exports = {
	parseMessage,
	classifyMessage,
	extractDueDate,
	detectPriority,
	detectStatus,
	extractMentionedUsers,
	isAcknowledgement,
	normalizePersonName,
	toUser,
};
