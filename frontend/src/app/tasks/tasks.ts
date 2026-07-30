import { Component, inject, OnInit, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../shared/page-header';
import { DashboardService } from '../services/dashboard.service';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  providers: [DatePipe],
  template: `
    <app-page-header title="Tasks Management" searchPlaceholder="Search tasks or assignees...">
      <div class="header-controls">
        <div class="date-picker-wrapper">
          <label for="taskDate">Date:</label>
          <input
            type="date"
            id="taskDate"
            [value]="dashService.selectedDate()"
            (change)="onDateChange($event)"
            class="date-input"
          />
          <button 
            class="clear-date-btn" 
            *ngIf="dashService.selectedDate()" 
            (click)="clearDate()" 
            title="Show All Dates"
          >✕</button>
        </div>

        <button class="refresh-btn" (click)="refreshAll()" [disabled]="dashService.loading()">
          {{ dashService.loading() ? 'Refreshing...' : 'Refresh Data' }}
        </button>
      </div>
    </app-page-header>

    <div class="tasks-body">
      <div *ngIf="dashService.error()" class="error-banner">
        {{ dashService.error() }}
      </div>

      <div *ngIf="dashService.data() as data; else loadingTpl">
        <div class="task-table-card">
          <div class="card-header">
            <span class="card-title">All Tasks ({{ getCleanTasks(data.tasks).length }})</span>
          </div>
          <table class="team-table">
            <thead>
              <tr>
                <th>TASK</th>
                <th>ASSIGNEE</th>
                <th>STATUS</th>
                <th>DUE DATE</th>
                <th>CREATED AT</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let task of getCleanTasks(data.tasks)">
                <td class="task-title-cell">{{ task.title || task.summary || task.name || 'Untitled Task' }}</td>
                <td class="member-cell">
                  <div class="avatar" [style.background]="getAvatarColor(displayName(task.assigned_to || task.owner || task.assignee))">
                    {{ getInitials(displayName(task.assigned_to || task.owner || task.assignee)) }}
                  </div>
                  <div>
                    <div class="member-name">{{ displayName(task.assigned_to || task.owner || task.assignee) }}</div>
                  </div>
                </td>
                <td>
                  <span class="status-pill" [class.blocked-pill]="(task.status || '').toUpperCase() === 'BLOCKED'">
                    {{ task.status || 'OPEN' }}
                  </span>
                </td>
                <td class="timestamp-cell">
                  {{ (task.due_date || task.duedate || task.due || task.deadline) ? ((task.due_date || task.duedate || task.due || task.deadline) | date: 'MMM d, y') : '-' }}
                </td>
                <td class="timestamp-cell">
                  {{ (task.created_time || task.created_at || task.date || task.updated_time) | date: 'MMM d, y, h:mm:ss a' }}
                </td>
              </tr>
              <tr *ngIf="getCleanTasks(data.tasks).length === 0">
                <td colspan="5" class="empty-text" style="padding: 24px 0; text-align: center;">
                  No tasks found for the selected date.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ng-template #loadingTpl>
        <div class="loading-state">Loading tasks data...</div>
      </ng-template>
    </div>
  `,
  styles: [
    `
      .tasks-body { padding: 24px 32px; display: flex; flex-direction: column; gap: 20px; }
      .header-controls { display: flex; align-items: center; gap: 12px; }
      .date-picker-wrapper { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #333; font-weight: 500; }
      .date-input { border: 1px solid #5b4fcf; border-radius: 6px; padding: 6px 12px; font-size: 13px; color: #1a1a2e; outline: none; background: #fafafd; cursor: pointer; }
      .clear-date-btn { background: #f0f0f0; border: 1px solid #d0d0d0; border-radius: 6px; width: 28px; height: 32px; cursor: pointer; font-size: 12px; color: #555; display: flex; align-items: center; justify-content: center; }
      .clear-date-btn:hover { background: #e0e0e0; }
      .refresh-btn { background: #5b4fcf; color: white; border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; }
      .refresh-btn:hover:not(:disabled) { background: #4a3ebc; }
      .error-banner { background: #ffeaea; color: #e53e3e; padding: 12px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
      .loading-state { color: #888; font-size: 14px; padding: 40px; text-align: center; background: white; border-radius: 8px; border: 1px solid #e9ecef; }
      .empty-text { color: #888; font-size: 13px; font-style: italic; }
      
      .task-table-card { background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; }
      .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
      .card-title { font-size: 14px; font-weight: 600; color: #1a1a2e; margin-bottom: 12px; }
      .task-title-cell { font-weight: 500; color: #1a1a2e; }
      .timestamp-cell { color: #555; font-size: 13px; }
      .status-pill { background: #eef2ff; color: #5b4fcf; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; }
      .blocked-pill { background: #fff0f0; color: #e53e3e; }

      .team-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      .team-table th { text-align: left; font-size: 11px; color: #888; font-weight: 600; letter-spacing: 0.5px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
      .team-table td { padding: 14px 0; font-size: 13.5px; color: #333; border-bottom: 1px solid #f5f5f5; }
      .member-cell { display: flex; align-items: center; gap: 12px; }
      .avatar { width: 34px; height: 34px; border-radius: 50%; color: white; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; text-transform: uppercase; }
      .member-name { font-size: 13.5px; font-weight: 500; color: #1a1a2e; text-transform: capitalize; }
    `,
  ],
})
export class TasksComponent implements OnInit {
  dashService = inject(DashboardService);

  constructor() {
    effect(() => {
      this.dashService.load();
    });
  }

  ngOnInit() {
    this.dashService.load();
  }

  refreshAll(): void {
    this.dashService.refresh();
  }

  onDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.dashService.setSelectedDate(input.value);
    this.dashService.load();
  }

  clearDate(): void {
    this.dashService.setSelectedDate('');
    this.dashService.load();
  }

  isBotUser(m: any): boolean {
    if (!m) return true;
    const rawId = (typeof m === 'object' && m?.id ? m.id : '').toLowerCase();
    const rawName = (typeof m === 'string' ? m : (m.real_name || m.display_name || m.name || '')).toLowerCase();

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

  private removeDuplicates(items: any[]): any[] {
    if (!items) return [];
    const seen = new Map();
    return items.filter(item => {
      const key = item.id || item._id;
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.set(key, true);
      return true;
    });
  }

  getCleanTasks(tasks: any[]): any[] {
    if (!tasks) return [];
    const uniqueTasks = this.removeDuplicates(tasks);
    const selectedDate = this.dashService.selectedDate();
    
    const filtered = uniqueTasks.filter((t) => {
      const assignee = t.assigned_to || t.owner || t.assignee;
      if (this.isBotUser(assignee)) return false;

      const taskDate = t.created_time || t.created_at || t.date || t.updated_time;
      return this.matchesSelectedDate(taskDate, selectedDate);
    });

    // Sort descending by creation timestamp (newest first)
    return filtered.sort((a, b) => {
      const timeA = new Date(a.created_time || a.created_at || a.date || a.updated_time || 0).getTime();
      const timeB = new Date(b.created_time || b.created_at || b.date || b.updated_time || 0).getTime();
      return timeB - timeA;
    });
  }

  displayName(user: any): string {
    if (!user) return 'Unassigned';
    const candidate = user.display_name || user.real_name || user.name || '';
    return this.normalizeName(candidate) || 'Unassigned';
  }

  private normalizeName(value: string): string {
    if (!value) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    if (trimmed.includes('@')) {
      return trimmed.split('@')[0].replace(/[._-]+/g, ' ').trim();
    }
    return trimmed.replace(/[._-]+/g, ' ').trim();
  }

  getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.trim().split(' ');
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  getAvatarColor(name: string): string {
    if (!name) return '#888';
    const colors = ['#e07b39', '#e05050', '#1abaab', '#5b4fcf', '#27ae60', '#e67e22'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }
}