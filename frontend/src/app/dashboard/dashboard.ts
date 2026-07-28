import { Component, inject, OnInit, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../shared/page-header';
import { DashboardService } from '../services/dashboard.service'; // Adjust path

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  providers: [DatePipe],
  template: `
    <app-page-header title="Dashboard" searchPlaceholder="Search tasks, teams, or summaries...">
      <div class="header-controls">
        <div class="date-picker-wrapper">
          <label for="dashboardDate">Date:</label>
          <input
            type="date"
            id="dashboardDate"
            [value]="dashService.selectedDate()"
            (change)="onDateChange($event)"
            class="date-input"
          />
        </div>
        <button
          class="refresh-btn"
          (click)="dashService.refresh()"
          [disabled]="dashService.loading()"
        >
          {{ dashService.loading() ? 'Refreshing...' : 'Refresh Data' }}
        </button>
      </div>
    </app-page-header>

    <div class="dashboard-body">
      <div *ngIf="dashService.error()" class="error-banner">
        {{ dashService.error() }}
      </div>

      <div *ngIf="dashService.data() as data; else loadingTpl">
        <!-- Stats Row -->
        <div class="stats-row">
          <div class="stat-card">
            <div class="stat-label">Total Tasks</div>
            <div class="stat-value">{{ data.tasks.length }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">In Progress</div>
            <div class="stat-value">{{ countStatus(data.tasks, 'PROCESSING') }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Blocked</div>
            <div class="stat-value critical">{{ countStatus(data.tasks, 'BLOCKED') }}</div>
            <div class="stat-badge critical" *ngIf="countStatus(data.tasks, 'BLOCKED') > 0">
              CRITICAL
            </div>
          </div>
          <div class="stat-card highlighted">
            <div class="stat-label">Issues</div>
            <div class="stat-value">{{ data.issues.length }}</div>
            <a routerLink="/issues" class="view-list-link">View list</a>
          </div>
        </div>

        <!-- Middle Row -->
        <div class="middle-row">
          <!-- Stand-up Timeline / Discussions -->
          <div class="standup-card">
            <div class="card-header">
              <span class="card-title">Recent Discussion & Timeline</span>
            </div>

            <div class="standup-entry" *ngFor="let disc of data.discussion_timeline.slice(0, 3)">
              <div class="standup-text">{{ disc.content }}</div>
               <div class="standup-meta">
                 <span class="slack-badge">{{ displayName(disc.author) || 'User' }}</span>
                 <span class="standup-time">{{ disc.timestamp | date: 'MMM d, y, h:mm a' }}</span>
               </div>
            </div>

            <div
              *ngIf="!data.discussion_timeline || data.discussion_timeline.length === 0"
              class="empty-text"
            >
              No recent discussions.
            </div>
          </div>

          <!-- Recent Activity -->
          <div class="activity-card">
            <div class="card-title">Recent Activity</div>
            <div class="activity-list">
              <div class="activity-item" *ngFor="let activity of data.recent_activity.slice(0, 5)">
                <span class="activity-dot"></span>
                <div class="activity-content">
                  <div class="activity-text">{{ activity.summary }}</div>
                  <div class="activity-time">
                    {{ activity.created_at | date: 'M/d/yy, h:mm a' }}
                  </div>
                </div>
              </div>
              <div
                *ngIf="!data.recent_activity || data.recent_activity.length === 0"
                class="empty-text"
              >
                No recent activity.
              </div>
            </div>
          </div>
        </div>

        <!-- Team Overview (Owner Workload) -->
        <div class="team-overview-card">
          <div class="card-header">
            <span class="card-title">Team Overview</span>
            <a routerLink="/team" class="manage-team-link">Manage Team →</a>
          </div>
          <table class="team-table">
            <thead>
              <tr>
                <th>MEMBER</th>
                <th>ACTIVE TASKS</th>
                <th>ISSUES</th>
                <th>BLOCKED</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let w of data.owner_workload">
                <td class="member-cell">
                  <div class="avatar" [style.background]="getAvatarColor(w.name)">
                    {{ getInitials(w.name) }}
                  </div>
                  <div>
                    <div class="member-name">{{ displayName({name: w.name}) || 'Unassigned' }}</div>
                    <div class="member-role">Developer</div>
                  </div>
                </td>
                <td>{{ w.tasks }}</td>
                <td>{{ w.issues }}</td>
                <td [class.critical-value]="w.blocked > 0">{{ w.blocked }}</td>
              </tr>
              <tr *ngIf="!data.owner_workload || data.owner_workload.length === 0">
                <td colspan="4" class="empty-text" style="padding: 16px 0;">
                  No active team members.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ng-template #loadingTpl>
        <div class="loading-state">Loading dashboard data...</div>
      </ng-template>
    </div>
  `,
  styles: [
    `
      .dashboard-body {
        padding: 24px 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .header-controls {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .date-picker-wrapper {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: #333;
        font-weight: 500;
      }
      .date-picker-wrapper label {
        white-space: nowrap;
      }
      .date-input {
        border: 1px solid #5b4fcf;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 13px;
        color: #1a1a2e;
        outline: none;
        background: #fafafd;
        cursor: pointer;
      }
      .refresh-btn {
        background: #5b4fcf;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }
      .refresh-btn:hover:not(:disabled) {
        background: #4a3ebc;
      }
      .refresh-btn:disabled {
        background: #a5a0d8;
        cursor: not-allowed;
      }
      .error-banner {
        background: #ffeaea;
        color: #e53e3e;
        padding: 12px 16px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 4px;
      }
      .loading-state {
        color: #888;
        font-size: 14px;
        padding: 40px;
        text-align: center;
        background: white;
        border-radius: 8px;
        border: 1px solid #e9ecef;
      }
      .empty-text {
        color: #888;
        font-size: 13px;
        font-style: italic;
      }

      /* Stats */
      .stats-row {
        display: flex;
        gap: 16px;
      }
      .stat-card {
        flex: 1;
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 18px 20px;
      }
      .stat-card.highlighted {
        border: 2px solid #5b4fcf;
      }
      .stat-label {
        font-size: 11px;
        color: #888;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .stat-value {
        font-size: 28px;
        font-weight: 700;
        color: #1a1a2e;
        margin: 4px 0;
      }
      .stat-value.critical {
        color: #e53e3e;
      }
      .stat-badge {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 3px;
      }
      .stat-badge.critical {
        background: #fff0f0;
        color: #e53e3e;
      }
      .view-list-link {
        font-size: 12px;
        color: #5b4fcf;
        cursor: pointer;
        text-decoration: none;
      }

      /* Middle Row */
      .middle-row {
        display: flex;
        gap: 20px;
      }
      .standup-card {
        flex: 1.8;
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .activity-card {
        flex: 1;
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 20px;
      }
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;
      }
      .card-title {
        font-size: 14px;
        font-weight: 600;
        color: #1a1a2e;
        margin-bottom: 12px;
      }
      .standup-entry {
        padding: 14px;
        border: 1px solid #e9ecef;
        border-radius: 6px;
      }
      .standup-text {
        font-size: 13.5px;
        color: #333;
        margin-bottom: 10px;
        line-height: 1.4;
      }
      .standup-meta {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .slack-badge {
        background: #f0f0f0;
        color: #555;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 4px;
        text-transform: capitalize;
      }
      .standup-time {
        font-size: 11.5px;
        color: #999;
      }

      /* Activity */
      .activity-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .activity-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }
      .activity-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #22c55e;
        margin-top: 4px;
        flex-shrink: 0;
      }
      .activity-text {
        font-size: 12.5px;
        color: #333;
        line-height: 1.4;
      }
      .activity-time {
        font-size: 11px;
        color: #aaa;
        margin-top: 2px;
      }

      /* Team Overview */
      .team-overview-card {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 20px;
      }
      .manage-team-link {
        font-size: 13px;
        color: #5b4fcf;
        text-decoration: none;
        font-weight: 500;
      }
      .team-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
      }
      .team-table th {
        text-align: left;
        font-size: 11px;
        color: #888;
        font-weight: 600;
        letter-spacing: 0.5px;
        padding: 8px 0;
        border-bottom: 1px solid #f0f0f0;
      }
      .team-table td {
        padding: 14px 0;
        font-size: 13.5px;
        color: #333;
        border-bottom: 1px solid #f5f5f5;
      }
      .member-cell {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        color: white;
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        text-transform: uppercase;
      }
      .member-name {
        font-size: 13.5px;
        font-weight: 500;
        color: #1a1a2e;
        text-transform: capitalize;
      }
      .member-role {
        font-size: 11.5px;
        color: #888;
      }
      .critical-value {
        color: #e53e3e !important;
        font-weight: 600;
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  dashService = inject(DashboardService);

  constructor() {
    effect(() => {
      this.dashService.load();
    });
  }

  ngOnInit() {
    this.dashService.load();
  }

  onDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      this.dashService.setSelectedDate(input.value);
      this.dashService.load();
    }
  }

  countStatus(tasks: any[], status: string): number {
    if (!tasks) return 0;
    return tasks.filter((t) => t.status === status).length;
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
