const { Task, Issue } = require('../models');

async function cleanupCompletedWork({ daysToKeep = 7 } = {}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);

  const [taskResult, issueResult] = await Promise.all([
    Task.deleteMany({
      status: 'COMPLETED',
      updated_time: { $lt: cutoff },
    }),
    Issue.deleteMany({
      status: 'RESOLVED',
      updated_time: { $lt: cutoff },
    }),
  ]);

  return {
    deletedTasks: taskResult.deletedCount || 0,
    deletedIssues: issueResult.deletedCount || 0,
  };
}

module.exports = { cleanupCompletedWork };
