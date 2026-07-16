/**
 * Lightweight parser self-test (no Mongo required).
 * Run: node src/agent/parser.test.js
 */
const { parseMessage, extractDueDate, detectPriority, detectStatus } = require('./parser');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  // Self-assign
  let r = parseMessage({
    text: "I'll finish the login API tomorrow.",
    sender: { id: 'U1', name: 'john', display_name: 'John' },
  });
  assert(r.classification === 'TASK', 'self-assign should be TASK');
  assert(r.owner.name === 'john' || r.owner.display_name === 'John', 'owner should be John');
  assert(r.assigned_to.id === 'U1', 'assigned_to should be John');
  assert(!!r.task.due_date, 'tomorrow should set due date');

  // Explicit assign
  r = parseMessage({
    text: '<@U2> please finish the payment API.',
    sender: { id: 'U1', name: 'john', display_name: 'John' },
    user_directory: { U2: { id: 'U2', name: 'sarah', display_name: 'Sarah' } },
  });
  assert(r.classification === 'TASK', 'assign message should be TASK');
  assert(r.owner.id === 'U2', 'owner should be Sarah');
  assert(r.assigned_by.id === 'U1', 'assigned_by should be John');

  // Unassigned
  r = parseMessage({
    text: 'Can someone update the documentation?',
    sender: { id: 'U3', name: 'david', display_name: 'David' },
  });
  assert(r.classification === 'TASK', 'can someone should be TASK');
  assert(r.owner.name === 'Unassigned', 'owner Unassigned');
  assert(r.task.needs_assignment === true, 'needs_assignment');

  // Issue
  r = parseMessage({
    text: 'Login isn\'t working. Critical production incident.',
    sender: { id: 'U1', name: 'john', display_name: 'John' },
  });
  assert(r.classification === 'ISSUE', 'should classify ISSUE');
  assert(r.issue.priority === 'URGENT' || r.issue.priority === 'HIGH', 'high/urgent priority');

  // Status
  assert(detectStatus('This is done') === 'COMPLETED', 'completed');
  assert(detectStatus('I am working on it') === 'PROCESSING', 'processing');
  assert(detectStatus('Blocked waiting for review') === 'BLOCKED', 'blocked');

  // Priority
  assert(detectPriority('hotfix ASAP') === 'URGENT', 'urgent');
  assert(detectPriority('minor later') === 'LOW', 'low');

  // Due date
  const due = extractDueDate('finish by Friday');
  assert(!!due, 'friday due date');

  // Discussion with low confidence → flagged
  r = parseMessage({
    text: 'Hmm interesting.',
    sender: { id: 'U1', name: 'john' },
  });
  assert(r.classification === 'GENERAL_DISCUSSION', 'discussion');

  // Acknowledgement
  r = parseMessage({
    text: 'OK',
    sender: { id: 'U2', name: 'sarah' },
    existing_task: { task_id: 'tsk_1', title: 'Payment API', status: 'BLOCKED' },
    thread_id: '123.456',
  });
  assert(r.action === 'ACKNOWLEDGE_DEPENDENCY', 'ack action');

  // Blocked missing reason notification
  r = parseMessage({
    text: 'Deploy the backend. Currently blocked.',
    sender: { id: 'U1', name: 'john', display_name: 'John' },
  });
  assert(r.classification === 'TASK', 'blocked deploy is task');
  assert(r.task.status === 'BLOCKED', 'status blocked');
  assert(
    r.notifications.some((n) => n.type === 'MISSING_BLOCK_REASON'),
    'missing block reason notification'
  );
  assert(
    r.notifications.some((n) => n.type === 'MISSING_DUE_DATE'),
    'missing due date notification'
  );

  console.log('All parser tests passed.');
}

run();
