import { Component, inject, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DashboardService } from '../services/dashboard.service'; // Adjust path

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
          <input
            type="date"
            class="filter-select"
            [(ngModel)]="dateFilter"
            (change)="loadTasks()"
          />
        </div>

      <div class="tasks-table-card">
        <table class="tasks-table">
          <thead>
            <tr>
              <th style="width: 35%;">TASK NAME</th>
              <th style="width: 25%;">ASSIGNED TO</th>
              <th style="width: 15%;">PRIORITY</th>
              <th style="width: 10%;">STATUS</th>
              <th style="width: 15%;">DUE DATE</th>
            </tr>
          </thead>
          <tbody *ngIf="dashService.data()?.tasks as tasks">
            <tr
              *ngFor="let task of filteredTasks(tasks)"
              [ngClass]="{ 'clickable-row': task.status === 'BLOCKED' }"
              (click)="openBlockedReason(task)"
            >
              <td class="task-name-cell">
                <div class="task-name">{{ task.title }}</div>
                <div class="task-category">{{ task.description || 'General Task' }}</div>
              </td>
              <td class="assignee-cell">
                <div
                  class="avatar-sm"
                  [style.background]="getAvatarColor(getPersonName(task.owner))"
                >
                  {{ getInitials(getPersonName(task.owner)) }}
                </div>
                <span class="assignee-name">{{ getPersonName(task.owner) }}</span>
              </td>
              <td>
                <span class="priority-badge" [ngClass]="task.priority?.toLowerCase()">{{
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

    <!-- BLOCKED REASON MODAL OVERLAY -->
    <div class="modal-overlay" *ngIf="selectedBlockedTask" (click)="closeModal()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title-wrapper">
            <span class="alert-icon">🚨</span>
            <h2 class="modal-title">Blocked Task Details</h2>
          </div>
          <button class="close-btn" (click)="closeModal()">&times;</button>
        </div>

        <div class="modal-body">
          <div class="info-group">
            <h3 class="info-label">Task Title</h3>
            <p class="info-value">{{ selectedBlockedTask.title }}</p>
          </div>

          <div class="info-group">
            <h3 class="info-label">Blocker Reason</h3>
            <div class="reason-box">
              <p class="reason-text">
                {{
                  selectedBlockedTask.blocked_reason ||
                    'No reason provided yet. Awaiting reply in Slack.'
                }}
              </p>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-primary" (click)="closeModal()">Close</button>
        </div>
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
        table-layout: fixed;
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
        border-bottom: 1px solid #f0f0f0;
        vertical-align: middle;
        text-align: left;
      }
      .tasks-table tr {
        transition: background-color 0.2s ease;
      }
      .tasks-table tr:last-child td {
        border-bottom: none;
      }
      .clickable-row {
        cursor: pointer;
      }
      .clickable-row:hover td {
        background-color: #fff9f9;
      }
      .task-name-cell {
        padding-right: 16px;
      }
      .task-name {
        font-size: 13.5px;
        color: #1a1a2e;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
        align-items: center;
        white-space: nowrap;
        gap: 8px;
      }
      .avatar-sm {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        color: white;
        font-size: 11px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        text-transform: uppercase;
        vertical-align: middle; /* Aligns with text */
        margin-right: 8px;
      }
      .assignee-name {
        font-size: 13px;
        color: #333;
        text-transform: capitalize;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
        white-space: nowrap;
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
        white-space: nowrap;
      }
      .empty-state {
        text-align: center;
        color: #888;
        padding: 30px !important;
      }

      /* Modal Styles */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(2px);
      }
      .modal-content {
        background: #ffffff;
        border-radius: 10px;
        width: 100%;
        max-width: 450px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        overflow: hidden;
        animation: slideIn 0.2s ease-out forwards;
      }
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(15px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 18px 24px;
        border-bottom: 1px solid #f0f0f0;
      }
      .modal-title-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .alert-icon {
        font-size: 18px;
      }
      .modal-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: #1a1a2e;
      }
      .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        color: #999;
        cursor: pointer;
        line-height: 1;
        transition: color 0.2s;
      }
      .close-btn:hover {
        color: #333;
      }
      .modal-body {
        padding: 24px;
      }
      .info-group {
        margin-bottom: 20px;
      }
      .info-group:last-child {
        margin-bottom: 0;
      }
      .info-label {
        font-size: 11px;
        font-weight: 600;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0 0 6px 0;
      }
      .info-value {
        margin: 0;
        font-size: 14px;
        color: #333;
        font-weight: 500;
      }
      .reason-box {
        background: #fff9f9;
        border: 1px solid #ffeaea;
        border-radius: 6px;
        padding: 12px 16px;
      }
      .reason-text {
        margin: 0;
        color: #c0392b;
        font-size: 13.5px;
        line-height: 1.5;
      }
      .modal-footer {
        padding: 16px 24px;
        background: #fafafa;
        border-top: 1px solid #f0f0f0;
        display: flex;
        justify-content: flex-end;
      }
      .btn-primary {
        background: #1a1a2e;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }
      .btn-primary:hover {
        background: #2a2a4a;
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
  dateFilter = '';

  selectedBlockedTask: any = null;

  ngOnInit() {
    this.setDefaultDate();
    this.loadTasks();
  }

  private setDefaultDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    this.dateFilter = `${year}-${month}-${day}`;
  }

  async loadTasks() {
    try {
      const params: any = {};
      const activeChannel = this.dashService.activeChannelId();
      if (activeChannel) params.channel = activeChannel;
      if (this.dateFilter) params.date = this.dateFilter;

      const tasks: any = (await this.http.get('/api/tasks', { params }).toPromise()) || [];

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
      return trimmed
        .split('@')[0]
        .replace(/[._-]+/g, ' ')
        .trim();
    }
    return trimmed.replace(/[._-]+/g, ' ').trim();
  }

  getInitials(name?: string): string {
    if (!name || name === 'Unassigned') return '??';
    const parts = name.trim().split(' ');
    return parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase();
  }

  getAvatarColor(name?: string): string {
    if (!name || name === 'Unassigned') return '#888';
    const colors = ['#e07b39', '#e05050', '#1abaab', '#5b4fcf', '#27ae60'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  openBlockedReason(task: any) {
    if (task.status === 'BLOCKED') {
      this.selectedBlockedTask = task;
    }
  }

  closeModal() {
    this.selectedBlockedTask = null;
  }
}
