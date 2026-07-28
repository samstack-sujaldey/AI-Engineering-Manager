const mongoose = require("mongoose");

const UserRefSchema = new mongoose.Schema(
	{
		id: { type: String, default: "" },
		name: { type: String, default: "" },
		display_name: { type: String, default: "" },
		email: { type: String, default: "" },
	},
	{ _id: false },
);

const IssueSchema = new mongoose.Schema(
	{
		issue_id: { type: String, required: true, unique: true, index: true },
		title: { type: String, required: true },
		description: { type: String, default: "" },
		reporter: { type: UserRefSchema, default: () => ({}) },
		owner: {
			type: UserRefSchema,
			default: () => ({ id: "", name: "Unassigned" }),
		},
		assigned_to: {
			type: UserRefSchema,
			default: () => ({ id: "", name: "Unassigned" }),
		},
		assigned_by: { type: UserRefSchema, default: () => ({}) },
		created_by: { type: UserRefSchema, default: () => ({}) },
		last_updated_by: { type: UserRefSchema, default: () => ({}) },
		mentioned_users: { type: [UserRefSchema], default: [] },
		priority: {
			type: String,
			enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
			default: "HIGH",
		},
		status: {
			type: String,
			enum: ["OPEN", "HOLD", "RESOLVED"],
			default: "HOLD", // <--- Default is now HOLD
		},
		root_cause: { type: String, default: "" },
		blocked_reason: { type: String, default: "" },
		block_reason_pending: { type: Boolean, default: false },
		related_task: { type: String, default: "" },
		dependencies: { type: [String], default: [] },
		related_discussions: { type: [String], default: [] },
		tags: { type: [String], default: [] },
		confidence_score: { type: Number, default: 0 },
		channel: { type: String, default: "" },
		thread: { type: String, default: "" },
		workspace_id: { type: String, default: "" },
		team: { type: String, default: "" },
		slack_message_ts: { type: String, default: "" },
		awaiting_acknowledgement: {
			user: { type: UserRefSchema, default: null },
			acknowledged: { type: Boolean, default: false },
			notification_at: { type: Date, default: null },
		},
		entities: {
			repository: { type: String, default: "" },
			branch: { type: String, default: "" },
			commit: { type: String, default: "" },
			pull_request: { type: String, default: "" },
			ticket: { type: String, default: "" },
			sprint: { type: String, default: "" },
			urls: { type: [String], default: [] },
			files: { type: [String], default: [] },
		},
		// Snapshot of Slack attachment descriptors captured at create/update
		// time, since the underlying temp files get deleted shortly after by
		// slackSync's cleanup step.
		local_file_logs: { type: [mongoose.Schema.Types.Mixed], default: [] },
		history: [
			{
				event: String,
				by: UserRefSchema,
				at: { type: Date, default: Date.now },
				details: mongoose.Schema.Types.Mixed,
			},
		],
	},
	{ timestamps: { createdAt: "created_time", updatedAt: "updated_time" } },
);

IssueSchema.index({ title: "text", description: "text" });

module.exports = mongoose.model("Issue", IssueSchema);