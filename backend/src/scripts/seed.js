/**
 * Seed sample messages through the processor (requires MongoDB).
 * Run: node src/scripts/seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const { MessageProcessor } = require('../services/messageProcessor');
const { NotificationService } = require('../services/notifications');

const samples = [
  {
    text: "I'll finish the login API tomorrow.",
    sender: { id: 'U_JOHN', name: 'john', display_name: 'John', email: 'john@acme.com' },
  },
  {
    text: '<@U_SARAH> please finish the payment API by Friday. High priority.',
    sender: { id: 'U_JOHN', name: 'john', display_name: 'John' },
    user_directory: { U_SARAH: { id: 'U_SARAH', name: 'sarah', display_name: 'Sarah' } },
  },
  {
    text: 'Can someone update the documentation?',
    sender: { id: 'U_DAVID', name: 'david', display_name: 'David' },
  },
  {
    text: "Login isn't working. Critical production incident ASAP.",
    sender: { id: 'U_MIKE', name: 'mike', display_name: 'Mike' },
  },
  {
    text: 'Deploy the backend. Currently blocked waiting for <@U_ALEX> review.',
    sender: { id: 'U_RAHUL', name: 'rahul', display_name: 'Rahul' },
    user_directory: { U_ALEX: { id: 'U_ALEX', name: 'alex', display_name: 'Alex' } },
  },
  {
    text: 'What if we move auth to a separate service?',
    sender: { id: 'U_JOHN', name: 'john', display_name: 'John' },
  },
];

async function run() {
  await mongoose.connect(config.mongodbUri);
  const notifications = new NotificationService();
  const processor = new MessageProcessor({ notificationService: notifications });

  for (const sample of samples) {
    const result = await processor.process({
      ...sample,
      channel: 'C_ENGINEERING',
      workspace_id: 'T_ACME',
      team: 'Engineering',
      message_ts: `${Date.now()}.${Math.floor(Math.random() * 1000)}`,
      user_directory: sample.user_directory || {},
    });
    console.log(`${result.action.padEnd(22)} ${result.classification.padEnd(20)} ${result.task?.title || result.issue?.title || result.discussion?.content?.slice(0, 40)}`);
  }

  await mongoose.disconnect();
  console.log('Seed complete.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
