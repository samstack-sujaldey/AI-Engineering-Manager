import { Component, inject, OnInit, ChangeDetectorRef, effect, untracked } from '@angular/core';
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
      title="Tasks & Action Items"
      searchPlaceholder="Search tasks..."
    ></app-page-header>

    <div class="tasks-body">
      <div class="filters-row">
        <select class="filter-select" [(ngModel)]="statusFilter">
          <option value="all">Status: All</option>
          <option value="TODO">Todo</option>
          <option value="PROCESSING">Processing</option>
          <option value="BLOCKED">Blocked</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <select class="filter-select" [(ngModel)]="priorityFilter">
          <option value="all">Priority: All</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
        
        <!-- Date Filter with Clear Button -->
        <div class="date-filter-group">
          <input
            type="date"
            class="filter-select"
            [value]="dashService.selectedDate()"
            (change)="onDateChange($event)"
          />
          <button 
            class="clear-date-btn" 
            *ngIf="dashService.selectedDate()" 
            (click)="clearDateFilter()" 
            title="Show All Dates"
          >✕</button>
        </div>
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
          <tbody>
            <tr
              *ngFor="let task of filteredTasks()"
              class="clickable-row"
              (click)="openTaskModal(task)"
            >
              <td class="task-name-cell">
                <div class="task-name">{{ task.title || task.description || 'Untitled Task' }}</div>
                <div class="task-category">{{ task.channel_name ? '#' + task.channel_name : 'Click to view details...' }}</div>
              </td>
              <td class="assignee-cell">
                <div
                  class="avatar-sm"
                  [style.background]="getAvatarColor(task.assigneeName)"
                >
                  {{ getInitials(task.assigneeName) }}
                </div>
                <span class="assignee-name">{{ task.assigneeName }}</span>
              </td>
              <td>
                <span class="priority-badge" [ngClass]="(task.priority || 'low').toLowerCase()">{{
                  task.priority || 'Normal'
                }}</span>
              </td>
              <td>
                <span class="status-badge" [ngClass]="getStatusClass(task.status)">{{
                  task.status || 'Todo'
                }}</span>
              </td>
              <td class="due-date" [ngClass]="{ 'overdue-text': isOverdue(task) }">
                <span *ngIf="isOverdue(task)" class="alert-icon-small">⚠️</span>
                {{ task.due_date ? (task.due_date | date: 'MMM d, y, h:mm a') : '—' }}
              </td>
              <td class="due-date">
                {{ (task.created_time || task.created_at || task.date) ? ((task.created_time || task.created_at || task.date) | date: 'MMM d, y, h:mm a') : '—' }}
              </td>
            </tr>
            <tr *ngIf="filteredTasks().length === 0">
              <td colspan="6" class="empty-state">No human-assigned tasks found matching your filters.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TASK DETAILS MODAL OVERLAY -->
    <div class="modal-overlay" *ngIf="selectedTask && !taskToDelete" (click)="closeModal()">
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
            <h3 class="info-label">FULL TASK DESCRIPTION</h3>
            <p class="info-value" style="white-space: pre-wrap; word-break: break-word; line-height: 1.5;">
              {{ selectedTask.description || selectedTask.text || selectedTask.title }}
            </p>
          </div>

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

        <div class="modal-footer modal-footer-between">
          <button class="btn-danger-outline" (click)="confirmDelete(selectedTask)">
            🗑️ Delete Task
          </button>
          <button class="btn-primary" (click)="closeModal()">Close</button>
        </div>
      </div>
    </div>

    <!-- DELETE CONFIRMATION POPUP -->
    <div class="modal-overlay" *ngIf="taskToDelete" (click)="cancelDelete()">
      <div class="modal-content delete-modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title-wrapper">
            <span class="alert-icon">⚠️</span>
            <h2 class="modal-title">Confirm Deletion</h2>
          </div>
          <button class="close-btn" (click)="cancelDelete()">&times;</button>
        </div>

        <div class="modal-body">
          <p class="delete-msg">Are you sure you want to delete this task? This action cannot be undone.</p>
          <div class="preview-box">
            <strong>{{ taskToDelete.title || taskToDelete.description }}</strong>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" (click)="cancelDelete()">Cancel</button>
          <button class="btn-danger" (click)="executeDelete()">Yes, Delete</button>
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
        flex-wrap: wrap;
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
      .date-filter-group {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .clear-date-btn {
        background: #f0f0f0;
        border: 1px solid #d0d0d0;
        border-radius: 6px;
        width: 32px;
        height: 34px;
        cursor: pointer;
        font-size: 13px;
        color: #555;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .clear-date-btn:hover {
        background: #e0e0e0;
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
        background-color: #f8f9fa;
      }
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
      .assignee-cell {
        white-space: nowrap;
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
      .priority-badge.low { background: #f5f5f5; color: #666; }
      .priority-badge.medium { background: #fff8e1; color: #f59e0b; }
      .priority-badge.high { background: #fff3e0; color: #e67e22; }
      .priority-badge.urgent { background: #ffeaea; color: #e53e3e; }
      .status-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 600;
        text-transform: capitalize;
        white-space: nowrap;
      }
      .status-todo { background: #e8eeff; color: #5b4fcf; }
      .status-processing { background: #e3f2fd; color: #1976d2; }
      .status-resolved { background: #e8f5e9; color: #27ae60; }
      .status-blocked { background: #ffeaea; color: #e53e3e; }
      .due-date { color: #555; font-size: 13px; white-space: nowrap; }
      .overdue-text { color: #e53e3e; font-weight: 600; }
      .alert-icon-small { margin-right: 4px; }
      .empty-state { text-align: center; color: #888; padding: 30px !important; }

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
      .alert-icon { font-size: 18px; }
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
      .close-btn:hover { color: #333; }
      .modal-body { padding: 24px; }
      .info-group { margin-bottom: 20px; }
      .info-group:last-child { margin-bottom: 0; }
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
      .delete-msg {
        margin: 0 0 12px 0;
        font-size: 14px;
        color: #333;
      }
      .preview-box {
        background: #f8f9fa;
        border: 1px solid #e9ecef;
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 13px;
        color: #555;
      }
      .modal-footer {
        padding: 16px 24px;
        background: #fafafa;
        border-top: 1px solid #f0f0f0;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .modal-footer-between {
        justify-content: space-between;
        align-items: center;
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
      .btn-primary:hover { background: #2a2a4a; }
      .btn-secondary {
        background: #f0f0f0;
        color: #333;
        border: 1px solid #d0d0d0;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }
      .btn-secondary:hover { background: #e0e0e0; }
      .btn-danger-outline {
        background: transparent;
        color: #e53e3e;
        border: 1px solid #e53e3e;
        padding: 7px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .btn-danger-outline:hover {
        background: #ffeaea;
      }
      .btn-danger {
        background: #e53e3e;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }
      .btn-danger:hover { background: #c53030; }
    `,
  ],
})
export class TasksComponent implements OnInit {
  http = inject(HttpClient);
  dashService = inject(DashboardService);
  private cdr = inject(ChangeDetectorRef);

  tasks: any[] = [];
  statusFilter = 'all';
  priorityFilter = 'all';
  private isInitialized = false;

  selectedTask: any = null;
  taskToDelete: any = null;

  constructor() {
    effect(() => {
      const globalChannel = this.dashService.selectedChannel();
      const globalDate = this.dashService.selectedDate();
      
      untracked(() => {
        if (!this.isInitialized) return;
        this.loadTasks();
      });
    });
  }

  ngOnInit() {
    this.loadTasks();
    this.isInitialized = true;
  }

  onDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.dashService.setSelectedDate(input.value);
    this.loadTasks();
  }

  clearDateFilter(): void {
    this.dashService.setSelectedDate('');
    this.loadTasks();
  }

  async loadTasks() {
    try {
      const url = this.dashService.getFilteredUrl('/tasks');
      const response: any = await firstValueFrom(this.http.get(url)).catch(() => []);
      const rawList = Array.isArray(response) ? response : (response?.tasks || response?.data || []);

      this.tasks = rawList
        .map((item: any) => {
          const rawAssignee = item.assigned_to || item.owner || item.assignee;
          if (this.isBotUser(rawAssignee)) return null;

          let assigneeName = this.extractStringName(rawAssignee);
          if (assigneeName === 'Unassigned' || this.isBotUser(assigneeName)) return null;

          let cleanTitle = item.title || item.description || '';
          cleanTitle = cleanTitle.replace(/<@[A-Z0-9]+>/g, '').trim();

          return {
            ...item,
            title: cleanTitle,
            assigneeName
          };
        })
        .filter((item: boolean | Record<string, any>) => item !== null);

      this.cdr.detectChanges();
    } catch (err) {
      console.error('Failed to load tasks:', err);
      this.tasks = [];
      this.cdr.detectChanges();
    }
  }

  filteredTasks(): any[] {
    const selectedDate = this.dashService.selectedDate();
    return this.tasks.filter((task) => {
      const matchStatus = this.statusFilter === 'all' || (task.status || '').toLowerCase() === this.statusFilter.toLowerCase();
      const matchPriority = this.priorityFilter === 'all' || (task.priority || '').toLowerCase() === this.priorityFilter.toLowerCase();
      const taskDate = task.due_date || task.created_time || task.created_at;
      const matchDate = this.matchesSelectedDate(taskDate, selectedDate);
      return matchStatus && matchPriority && matchDate;
    });
  }

  isOverdue(task: any): boolean {
    if (!task.due_date) return false;
    const status = (task.status || '').toLowerCase();
    if (status === 'resolved') return false;
    return new Date(task.due_date).getTime() < Date.now();
  }

  private isBotUser(m: any): boolean {
    if (!m) return true;
    const rawId = (m.id || '').toLowerCase();
    const rawName = (
      typeof m === 'string'
        ? m
        : (m.real_name || m.display_name || m.name || '')
    ).toLowerCase();

    return (
      rawId === 'uslackbot' ||
      rawName.includes('github') ||
      rawName.includes('jira') ||
      rawName.includes('jirabot') ||
      rawName.includes('slackbot') ||
      rawName.includes('ai_engineering') ||
      rawName.includes('bot') ||
      rawName.includes('app') ||
      rawName === 'unknown'
    );
  }

  private extractStringName(input: any): string {
    if (!input || this.isBotUser(input)) return 'Unassigned';
    
    let raw = '';
    if (typeof input === 'string') raw = input;
    else if (typeof input === 'object') {
      raw = input.real_name || input.display_name || input.name || 'Unassigned';
    } else {
      raw = String(input);
    }

    raw = raw.trim();
    if (raw.startsWith('<@') && raw.endsWith('>')) {
      raw = raw.slice(2, -1);
    }
    if (raw.includes('@') && !raw.startsWith('<')) {
      raw = raw.split('@')[0].replace(/[._-]+/g, ' ').trim();
    } else {
      raw = raw.replace(/[._-]+/g, ' ').trim();
    }

    const normalized = raw || 'Unassigned';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private matchesSelectedDate(itemDate: any, targetDateStr: string): boolean {
    if (!targetDateStr) return true; 
    if (!itemDate) return false;
    if (typeof itemDate === 'string' && itemDate.startsWith(targetDateStr)) {
      return true;
    }
    let numericDate = Number(itemDate);
    let dateObj: Date;
    if (!isNaN(numericDate) && numericDate > 0) {
      if (numericDate < 10000000000) numericDate *= 1000;
      dateObj = new Date(numericDate);
    } else {
      dateObj = new Date(itemDate);
    }
    if (isNaN(dateObj.getTime())) return true;
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}` === targetDateStr;
  }

  getStatusClass(status: string): string {
    return status ? `status-${status.toLowerCase()}` : 'status-todo';
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

  openTaskModal(task: any) {
    this.selectedTask = task;
  }

  closeModal() {
    this.selectedTask = null;
  }

  confirmDelete(task: any) {
    this.taskToDelete = task;
  }

  cancelDelete() {
    this.taskToDelete = null;
  }

  async executeDelete() {
    if (!this.taskToDelete) return;
    const taskId = this.taskToDelete._id || this.taskToDelete.id;

    try {
      await firstValueFrom(this.http.delete(`/api/tasks/${taskId}`)).catch(() => {});
      
      this.tasks = this.tasks.filter(t => (t._id || t.id) !== taskId);
      this.taskToDelete = null;
      this.selectedTask = null;
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Failed to delete task:', err);
      this.tasks = this.tasks.filter(t => (t._id || t.id) !== taskId);
      this.taskToDelete = null;
      this.selectedTask = null;
      this.cdr.detectChanges();
    }
  }
}