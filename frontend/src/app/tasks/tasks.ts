import { Component, inject, OnInit, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DashboardService } from '../services/dashboard.service';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, FormsModule],
  providers: [DatePipe],
  template: `
    <app-page-header
      title="Tasks"
      searchPlaceholder="Search tasks, PRs, or team..."
    ></app-page-header>

    <div class="tasks-body">
      <div class="filters-row">
        <select class="filter-select" [(ngModel)]="statusFilter" (change)="loadTasks()">
          <option value="all">Status: All</option>
          <option value="TODO">To Do</option>
          <option value="PROCESSING">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="BLOCKED">Blocked</option>
        </select>
        
        <select class="filter-select" [(ngModel)]="priorityFilter" (change)="loadTasks()">
          <option value="all">Priority: All</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>

        <select class="filter-select" [(ngModel)]="dateFilterType" (change)="loadTasks()">
          <option value="all">Date: Any Match</option>
          <option value="due">Date: Due Only</option>
          <option value="created">Date: Created Only</option>
        </select>
        
        <input
          type="date"
          class="filter-select"
          [value]="dashService.selectedDate()"
          (change)="onDateChange($event)"
        />
      </div>

      <div class="tasks-table-card">
        <table class="tasks-table">
          <thead>
            <tr>
              <th style="width: 30%;">TASK NAME</th>
              <th style="width: 20%;">ASSIGNED TO</th>
              <th style="width: 10%;">PRIORITY</th>
              <th style="width: 10%;">STATUS</th>
              <th style="width: 15%;">DUE DATE</th>
              <th style="width: 15%;">CREATED AT</th>
            </tr>
          </thead>
          <tbody *ngIf="dashService.data()?.tasks || [] as tasks">
            <tr
              *ngFor="let task of filteredTasks(tasks)"
              class="clickable-row"
              (click)="openTaskModal(task)"
            >
              <td class="task-name-cell">
                <div class="task-name">{{ task.title || 'Untitled Task' }}</div>
                <div class="task-category">{{ task.description || 'Click to view details...' }}</div>
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
              <td class="due-date" [ngClass]="{ 'overdue-text': isOverdue(task) }">
                <span *ngIf="isOverdue(task)" class="alert-icon-small">⚠️</span>
                {{ task.due_date ? (task.due_date | date: 'MMM d, y, h:mm a') : '—' }}
              </td>
              <td class="due-date">
                {{ (task.created_time || task.created_at || task.date || task.updated_time) | date: 'MMM d, y, h:mm a' }}
              </td>
            </tr>
            <tr *ngIf="filteredTasks(tasks).length === 0">
              <td colspan="6" class="empty-state">No tasks found matching your filters.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TASK DETAILS MODAL OVERLAY -->
    <div class="modal-overlay" *ngIf="selectedTask" (click)="closeModal()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title-wrapper">
            <span class="alert-icon" *ngIf="selectedTask.status === 'BLOCKED'">🚨</span>
            <span class="alert-icon" *ngIf="selectedTask.status !== 'BLOCKED'">📋</span>
            <h2 class="modal-title">Task Details</h2>
          </div>
          <button class="close-btn" (click)="closeModal()">&times;</button>
        </div>

        <div class="modal-body">
          <div class="info-group">
            <h3 class="info-label">Full Task Description</h3>
            <p class="info-value" style="white-space: pre-wrap; word-break: break-word; line-height: 1.5;">
              {{ selectedTask.description || selectedTask.text || selectedTask.title }}
            </p>
          </div>

          <!-- ONLY show if the task is BLOCKED -->
          <div class="info-group" *ngIf="selectedTask.status === 'BLOCKED'">
            <h3 class="info-label">Blocker Reason</h3>
            <div class="reason-box">
              <p class="reason-text">
                {{
                  selectedTask.blocked_reason ||
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
        table-layout: fixed; /* Forces strict widths for truncation */
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
      
      /* STRICT TRUNCATION (COLLAPSED BLOCKS) */
      .task-name-cell {
        padding-right: 16px;
        overflow: hidden;
      }
      .task-name {
        font-size: 13.5px;
        color: #1a1a2e;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .task-category {
        font-size: 12px;
        color: #888;
        margin-top: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* END TRUNCATION */

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
        vertical-align: middle;
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
      .overdue-text {
        color: #e53e3e !important;
        font-weight: 600;
      }
      .alert-icon-small {
        font-size: 11px;
        margin-right: 4px;
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
  private cdr = inject(ChangeDetectorRef);

  tasks: any[] | null = null;
  statusFilter = 'all';
  priorityFilter = 'all';
  dateFilterType = 'all';

  selectedTask: any = null;

  constructor() {
    effect(() => {
      this.loadTasks();
    });
  }

  ngOnInit() {
    this.loadTasks();
  }

  onDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      this.dashService.setSelectedDate(input.value);
      this.loadTasks();
    }
  }

  async loadTasks() {
    try {
      const params: any = {};
      const activeChannel = this.dashService.activeChannelId();
      if (activeChannel) params.channel = activeChannel;

      const selectedDate = this.dashService.selectedDate();
      params.date = selectedDate;

      const response: any = (await firstValueFrom(this.http.get('/api/tasks', { params }))) || [];

      this.tasks = (Array.isArray(response) ? response : []).filter((t: any) => {
        if (!selectedDate) return true;
        
        if (this.dateFilterType === 'due') {
          return this.matchesSelectedDate(t.due_date, selectedDate);
        } else if (this.dateFilterType === 'created') {
          return this.matchesSelectedDate(t.updated_time, selectedDate) || 
                 this.matchesSelectedDate(t.created_time, selectedDate);
        }
        
        return this.matchesSelectedDate(t.updated_time, selectedDate) ||
               this.matchesSelectedDate(t.created_time, selectedDate) ||
               this.matchesSelectedDate(t.due_date, selectedDate);
      });
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Failed to load tasks:', err);
      this.tasks = [];
      this.cdr.detectChanges();
    }
  }

  filteredTasks(tasks: any[]): any[] {
    const list = this.tasks !== null ? this.tasks : tasks || [];
    if (!list) return [];

    const selectedDate = this.dashService.selectedDate();
    return list.filter((task) => {
      const matchStatus = this.statusFilter === 'all' || task.status === this.statusFilter;
      const matchPriority = this.priorityFilter === 'all' || task.priority === this.priorityFilter;
      
      let matchDate = true;
      if (selectedDate) {
        if (this.dateFilterType === 'due') {
          matchDate = this.matchesSelectedDate(task.due_date, selectedDate);
        } else if (this.dateFilterType === 'created') {
          const taskDate = task.created_time || task.created_at || task.date || task.updated_time;
          matchDate = this.matchesSelectedDate(taskDate, selectedDate);
        } else {
          const taskDate = task.created_time || task.created_at || task.date || task.updated_time;
          matchDate = this.matchesSelectedDate(taskDate, selectedDate) || 
                      this.matchesSelectedDate(task.due_date, selectedDate);
        }
      }
      
      return matchStatus && matchPriority && matchDate;
    });
  }

  private matchesSelectedDate(itemDate: any, targetDateStr: string): boolean {
    if (!itemDate || !targetDateStr) return false;

    if (typeof itemDate === 'string' && itemDate.startsWith(targetDateStr)) {
      return true;
    }

    let numericDate = Number(itemDate);
    let dateObj: Date;

    if (!isNaN(numericDate) && numericDate > 0) {
      if (numericDate < 10000000000) {
        numericDate *= 1000;
      }
      dateObj = new Date(numericDate);
    } else {
      dateObj = new Date(itemDate);
    }

    if (isNaN(dateObj.getTime())) return false;

    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const formattedDate = `${yyyy}-${mm}-${dd}`;

    return formattedDate === targetDateStr;
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

  isOverdue(task: any): boolean {
    if (!task.due_date || task.status === 'COMPLETED' || task.status === 'RESOLVED') {
      return false;
    }
    const due = new Date(task.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0); 
    return due < today;
  }

  openTaskModal(task: any) {
    this.selectedTask = task;
  }

  closeModal() {
    this.selectedTask = null;
  }
}