import Task from '../models/Task.js';

// ─────────────────────────────────────────────
// GET /api/tasks
// Returns every task with its owning Member populated,
// newest first. Feeds the dashboard's Member | Status |
// Priority | Task table.
// ─────────────────────────────────────────────
export const getTasks = async (req, res) => {
  try {
    const tasks = await Task.find()
      .populate('memberId', 'name email role')
      .sort({ createdAt: -1 });

    const formatted = tasks.map((t) => ({
      id: t._id,
      title: t.title,
      description: t.description || null,
      status: t.status,
      priority: t.priority,
      workflowStage: t.workflowStage,
      createdAt: t.createdAt,
      member: t.memberId
        ? { name: t.memberId.name, email: t.memberId.email, role: t.memberId.role }
        : null,
    }));

    res.status(200).json({ count: formatted.length, tasks: formatted });
  } catch (err) {
    console.error('❌ getTasks error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
