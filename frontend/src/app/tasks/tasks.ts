import { Component, inject , OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';
import { DashboardService } from '../services/dashboard.service'; // Adjust path
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-tasks',
  imports: [CommonModule, PageHeaderComponent, FormsModule],
  providers: [DatePipe],
  template: `
    <app-page-header
      title="Tasks"
      searchPlaceholder="Search tasks, PRs, or team..."
    ></app-page-header>

    <div class="tasks-body">
      <div class="filters-row">
        <select class="filter-select" [(ngModel)]="statusFilter">
          <option value="all">Status: All</option>
          <option value="TODO">To Do</option>
          <option value="PROCESSING">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="BLOCKED">Blocked</option>
        </select>
        <select class="filter-select" [(ngModel)]="priorityFilter">
          <option value="all">Priority: All</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </div>

      <div class="tasks-table-card">
        <table class="tasks-table">
          <thead>
            <tr>
              <th>TASK NAME</th>
              <th>ASSIGNED TO</th>
              <th>PRIORITY</th>
              <th>STATUS</th>
              <th>DUE DATE</th>
            </tr>
          </thead>
          <tbody *ngIf="dashService.data()?.tasks as tasks">
            <tr *ngFor="let task of filteredTasks(tasks)">
              <td class="task-name-cell">
                <div class="task-name">{{ task.title }}</div>
                <div class="task-category">{{ task.description || 'General Task' }}</div>
              </td>
              <td class="assignee-cell">
                <div class="avatar-sm" [style.background]="getAvatarColor(getPersonName(task.owner))">
                  {{ getInitials(getPersonName(task.owner)) }}
                </div>
                <span class="assignee-name">{{ getPersonName(task.owner) }}</span>
              </td>
              <td>
                <span class="priority-badge" [ngClass]="task.priority.toLowerCase()">{{
                  task.priority
                }}</span>
              </td>
              <td>
                <span class="status-badge" [ngClass]="getStatusClass(task.status)">{{
                  task.status
                }}</span>
              </td>
              <td class="due-date">
                {{ task.due_date ? (task.due_date | date: 'mediumDate') : '—' }}
              </td>
            </tr>
            <tr *ngIf="filteredTasks(tasks).length === 0">
              <td colspan="5" class="empty-state">No tasks found matching your filters.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [
    `
      .tasks-body {
        padding: 24px 32px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .filters-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .filter-select {
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 7px 12px;
        font-size: 13px;
        color: #333;
        background: white;
        cursor: pointer;
        outline: none;
      }
      .tasks-table-card {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        overflow: hidden;
      }
      .tasks-table {
        width: 100%;
        border-collapse: collapse;
      }
      .tasks-table th {
        text-align: left;
        font-size: 11px;
        color: #888;
        font-weight: 600;
        letter-spacing: 0.5px;
        padding: 14px 20px;
        border-bottom: 1px solid #f0f0f0;
        background: #fafafa;
      }
      .tasks-table td {
        padding: 14px 20px;
        font-size: 13.5px;
        color: #333;
        border-bottom: 1px solid #f5f5f5;
        vertical-align: middle;
      }
      .tasks-table tr:last-child td {
        border-bottom: none;
      }
      .task-name {
        font-size: 13.5px;
        color: #1a1a2e;
        font-weight: 500;
      }
      .task-category {
        font-size: 11px;
        color: #999;
        margin-top: 2px;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .assignee-cell {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .avatar-sm {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        color: white;
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        text-transform: uppercase;
      }
      .assignee-name {
        font-size: 13px;
        color: #333;
        text-transform: capitalize;
      }

      .priority-badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .priority-badge.low {
        background: #f5f5f5;
        color: #666;
      }
      .priority-badge.medium {
        background: #fff8e1;
        color: #f59e0b;
      }
      .priority-badge.high {
        background: #fff3e0;
        color: #e67e22;
      }
      .priority-badge.urgent {
        background: #ffeaea;
        color: #e53e3e;
      }

      .status-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 600;
        text-transform: capitalize;
      }
      .status-todo {
        background: #f5f5f5;
        color: #666;
      }
      .status-completed {
        background: #e8f5e9;
        color: #27ae60;
      }
      .status-processing {
        background: #e8eeff;
        color: #5b4fcf;
      }
      .status-blocked {
        background: #ffeaea;
        color: #e53e3e;
      }

      .due-date {
        color: #999;
        font-size: 13px;
      }
      .empty-state {
        text-align: center;
        color: #888;
        padding: 30px !important;
      }
    `,
  ],
})
export class TasksComponent implements OnInit {
  http = inject(HttpClient);
  dashService = inject(DashboardService);

  tasks: any[] = [];
  statusFilter = 'all';
  priorityFilter = 'all';

  ngOnInit() {
    this.loadTasks();
  }

  // Inside your task loading method with completed tasks filtered out
  async loadTasks() {
    try {
      const tasks: any = await this.http.get('/api/tasks').toPromise() || [];
      
      // Filter out completed tasks so they never show up on the Task page view
      this.tasks = tasks.filter((t: any) => {
        const status = (t.status || '').toLowerCase();
        return status !== 'done' && status !== 'completed';
      });
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
  }

  filteredTasks(tasks: any[]): any[] {
    const list = tasks || this.tasks;
    if (!list) return [];
    return list.filter((task) => {
      const matchStatus = this.statusFilter === 'all' || task.status === this.statusFilter;
      const matchPriority = this.priorityFilter === 'all' || task.priority === this.priorityFilter;
      return matchStatus && matchPriority;
    });
  }

  getStatusClass(status: string): string {
    return status ? `status-${status.toLowerCase()}` : '';
  }

  getPersonName(user?: any): string {
    if (!user) return 'Unassigned';
    const candidate = user.display_name || user.real_name || user.name || '';
    return this.normalizeName(candidate) || 'Unassigned';
  }

  private normalizeName(value?: string): string {
    if (!value) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    if (trimmed.includes('@')) {
      return trimmed.split('@')[0].replace(/[._-]+/g, ' ').trim();
    }
    return trimmed.replace(/[._-]+/g, ' ').trim();
  }

  getInitials(name?: string): string {
    if (!name) return '??';
    const parts = name.trim().split(' ');
    return parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase();
  }

  getAvatarColor(name?: string): string {
    if (!name) return '#888';
    const colors = ['#e07b39', '#e05050', '#1abaab', '#5b4fcf', '#27ae60'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }
}
