export type TaskStatus = 'PROCESSING' | 'COMPLETED' | 'BLOCKED';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type WorkflowStage = 'DEVELOPMENT' | 'QA' | 'REVIEW' | 'PRODUCTION';

export interface TaskMember {
  name: string;
  email?: string;
  role?: string;
}

export interface StandupTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  workflowStage: WorkflowStage;
  createdAt: string;
  member: TaskMember | null;
}

export interface TasksResponse {
  count: number;
  tasks: StandupTask[];
}
