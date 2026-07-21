const { Task, Issue, Discussion, Activity, Notification } = require('../models');
const { isOverdue } = require('../utils/helpers');
const { normalizePersonName } = require('../agent/parser');

async function getDashboard() {
  const now = new Date();

  const [
    tasks,
    issues,
    discussions,
    activities,
    pendingNotifications,
    taskStats,
    issueStats,
  ] = await Promise.all([
    Task.find().sort({ updated_time: -1 }).limit(200).lean(),
    Issue.find().sort({ updated_time: -1 }).limit(200).lean(),
    Discussion.find().sort({ timestamp: -1 }).limit(100).lean(),
    Activity.find().sort({ created_at: -1 }).limit(50).lean(),
    Notification.find({
      status: { $in: ['PENDING', 'SENT'] },
      type: {
        $in: [
          'MISSING_DUE_DATE',
          'DUE_DATE_REMINDER',
          'MISSING_BLOCK_REASON',
          'BLOCK_REASON_REMINDER',
          'DEPENDENT_USER',
          'ACKNOWLEDGEMENT_REMINDER',
        ],
      },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    Task.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Issue.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const overdue_tasks = tasks.filter((t) => t.status !== 'COMPLETED' && isOverdue(t.due_date, now));
  const blocked_tasks = tasks.filter((t) => t.status === 'BLOCKED');
  const urgent_tasks = tasks.filter((t) => t.priority === 'URGENT' && t.status !== 'COMPLETED');
  const waiting_due_date = tasks.filter((t) => t.due_date_pending && t.status !== 'COMPLETED');
  const waiting_block_reason = tasks.filter((t) => t.block_reason_pending);
  const waiting_acknowledgement = tasks.filter(
    (t) => t.awaiting_acknowledgement && t.awaiting_acknowledgement.user && !t.awaiting_acknowledgement.acknowledged
  );

  const ownerWorkload = {};
  for (const t of tasks) {
    if (t.status === 'COMPLETED') continue;
    const key = t.assigned_to?.id || t.assigned_to?.name || 'Unassigned';
    const label = t.assigned_to?.name || t.assigned_to?.display_name || 'Unassigned';
    if (!ownerWorkload[key]) {
      ownerWorkload[key] = { id: key, name: label, tasks: 0, issues: 0, blocked: 0, overdue: 0 };
    }
    ownerWorkload[key].tasks += 1;
    if (t.status === 'BLOCKED') ownerWorkload[key].blocked += 1;
    if (isOverdue(t.due_date, now)) ownerWorkload[key].overdue += 1;
  }
  for (const i of issues) {
    if (i.status === 'COMPLETED') continue;
    const key = i.assigned_to?.id || i.assigned_to?.name || 'Unassigned';
    const label = i.assigned_to?.name || i.assigned_to?.display_name || 'Unassigned';
    if (!ownerWorkload[key]) {
      ownerWorkload[key] = { id: key, name: label, tasks: 0, issues: 0, blocked: 0, overdue: 0 };
    }
    ownerWorkload[key].issues += 1;
  }

  const normalizeUserRef = (user) => {
    if (!user) return user;
    const name = normalizePersonName(user.name || user.display_name || user.real_name || '');
    const displayName = normalizePersonName(user.display_name || user.real_name || user.name || '');
    return {
      ...user,
      name: name || user.name || '',
      display_name: displayName || user.display_name || user.name || '',
    };
  };

  const toTaskView = (t) => ({
    id: t.task_id,
    title: t.title,
    description: t.description,
    assigned_to: normalizeUserRef(t.assigned_to),
    assigned_by: normalizeUserRef(t.assigned_by),
    reporter: normalizeUserRef(t.reporter),
    created_by: normalizeUserRef(t.created_by),
    last_updated_by: normalizeUserRef(t.last_updated_by),
    owner: normalizeUserRef(t.owner),
    mentioned_users: t.mentioned_users,
    priority: t.priority,
    status: t.status,
    due_date: t.due_date,
    overdue: isOverdue(t.due_date, now),
    due_date_pending: t.due_date_pending,
    block_reason_pending: t.block_reason_pending,
    blocked_reason: t.blocked_reason,
    needs_assignment: t.needs_assignment,
    dependencies: t.dependencies,
    related_issues: t.related_issues,
    related_discussions: t.related_discussions,
    channel: t.channel,
    thread: t.thread,
    confidence_score: t.confidence_score,
    created_time: t.created_time,
    updated_time: t.updated_time,
  });

  const toIssueView = (i) => ({
    id: i.issue_id,
    title: i.title,
    description: i.description,
    assigned_to: normalizeUserRef(i.assigned_to),
    assigned_by: normalizeUserRef(i.assigned_by),
    reporter: normalizeUserRef(i.reporter),
    created_by: normalizeUserRef(i.created_by),
    owner: normalizeUserRef(i.owner),
    mentioned_users: i.mentioned_users,
    priority: i.priority,
    status: i.status,
    due_date: i.due_date,
    root_cause: i.root_cause,
    blocked_reason: i.blocked_reason,
    related_task: i.related_task,
    dependencies: i.dependencies,
    channel: i.channel,
    thread: i.thread,
    created_time: i.created_time,
    updated_time: i.updated_time,
  });

  return {
    tasks: tasks.map(toTaskView),
    issues: issues.map(toIssueView),
    overdue_tasks: overdue_tasks.map(toTaskView),
    blocked_tasks: blocked_tasks.map(toTaskView),
    urgent_tasks: urgent_tasks.map(toTaskView),
    waiting_due_date: waiting_due_date.map(toTaskView),
    waiting_block_reason: waiting_block_reason.map(toTaskView),
    waiting_acknowledgement: waiting_acknowledgement.map(toTaskView),
    discussion_timeline: discussions.map((d) => ({
      id: d.discussion_id,
      content: d.content,
      author: normalizeUserRef(d.author),
      task_id: d.task_id,
      issue_id: d.issue_id,
      channel: d.channel,
      thread: d.thread,
      flagged_for_review: d.flagged_for_review,
      timestamp: d.timestamp,
    })),
    dependencies: tasks
      .filter((t) => t.dependencies?.length)
      .map((t) => ({
        task_id: t.task_id,
        title: t.title,
        dependencies: t.dependencies,
        owner: t.owner,
        status: t.status,
      })),
    recent_activity: activities,
    task_progress: Object.fromEntries(taskStats.map((s) => [s._id, s.count])),
    issue_progress: Object.fromEntries(issueStats.map((s) => [s._id, s.count])),
    owner_workload: Object.values(ownerWorkload),
    pending_notifications: pendingNotifications,
    generated_at: now.toISOString(),
  };
}

module.exports = { getDashboard };
