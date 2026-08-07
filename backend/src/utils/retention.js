const { Task, Issue } = require('../models');

async function cleanupCompletedWork({ daysToKeep = 14 } = {}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);

  const [taskResult, issueResult] = await Promise.all([
    Task.deleteMany({
      status: { $in: ['COMPLETED', 'completed', 'done', 'Done', 'COMPLETE', 'complete'] },
      updated_time: { $lt: cutoff },
    }),
    Issue.deleteMany({
      status: { $in: ['RESOLVED', 'resolved', 'closed', 'Closed', 'CLOSED'] },
      updated_time: { $lt: cutoff },
    }),
  ]);
  return {
    deletedTasks: taskResult.deletedCount || 0,
    deletedIssues: issueResult.deletedCount || 0,
  };
}

module.exports = { cleanupCompletedWork };
