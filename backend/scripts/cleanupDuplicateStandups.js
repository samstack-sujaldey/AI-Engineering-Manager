/**
 * cleanupDuplicateStandups.js
 *
 * One-off cleanup for duplicate Slack-sourced Standups (and their child
 * StandupMessage / Task / Activity records) created BEFORE the de-dup fix
 * was applied — i.e. from hitting /process on the same channel repeatedly.
 *
 * A "duplicate" here means: same submittedBy (Member) + same message text +
 * source 'Slack'. We keep the OLDEST one and remove the rest, along with any
 * Task/Activity that was generated from the duplicates.
 *
 * SAFE BY DEFAULT: runs as a dry run and only prints what it WOULD delete.
 * Pass --confirm to actually delete.
 *
 * Usage:
 *   node scripts/cleanupDuplicateStandups.js            (dry run)
 *   node scripts/cleanupDuplicateStandups.js --confirm   (actually deletes)
 *
 * ⚠️  Back up your database before running with --confirm.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Standup from '../models/Standup.js';
import StandupMessage from '../models/StandupMessage.js';
import Task from '../models/Task.js';
import Activity from '../models/Activity.js';

dotenv.config();

const CONFIRM = process.argv.includes('--confirm');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. Mode: ${CONFIRM ? 'DELETE (--confirm)' : 'DRY RUN (no changes)'}\n`);

  const duplicateGroups = await Standup.aggregate([
    { $match: { source: 'Slack' } },
    {
      $group: {
        _id: { submittedBy: '$submittedBy', message: '$message' },
        ids: { $push: '$_id' },
        createdAts: { $push: '$createdAt' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicateGroups.length === 0) {
    console.log('No duplicate standups found. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  let totalStandupsToDelete = 0;
  let totalTasksToDelete = 0;

  for (const group of duplicateGroups) {
    // Pair ids with their createdAt, sort oldest first, keep the oldest.
    const paired = group.ids
      .map((id, i) => ({ id, createdAt: group.createdAts[i] }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const [keep, ...remove] = paired;

    console.log(`Member ${group._id.submittedBy}: "${(group._id.message || '').slice(0, 60)}..."`);
    console.log(`  keeping standup ${keep.id} (oldest)`);

    for (const dup of remove) {
      const tasksForDup = await Task.find({ standupId: dup.id });
      totalStandupsToDelete++;
      totalTasksToDelete += tasksForDup.length;

      console.log(`  → would remove standup ${dup.id} + ${tasksForDup.length} task(s) + its StandupMessage`);

      if (CONFIRM) {
        const taskIds = tasksForDup.map((t) => t._id);
        await Activity.deleteMany({ taskId: { $in: taskIds } });
        await Task.deleteMany({ _id: { $in: taskIds } });
        await StandupMessage.deleteMany({ standupId: dup.id });
        await Standup.deleteOne({ _id: dup.id });
      }
    }
    console.log('');
  }

  console.log(`Summary: ${duplicateGroups.length} duplicate group(s), ${totalStandupsToDelete} standup(s), ${totalTasksToDelete} task(s) ${CONFIRM ? 'deleted' : 'would be deleted'}.`);

  if (!CONFIRM) {
    console.log('\nThis was a dry run. Re-run with --confirm to actually delete.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Cleanup script error:', err);
  process.exit(1);
});
