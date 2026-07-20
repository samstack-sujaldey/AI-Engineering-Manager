import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';
import { DashboardService } from '../services/dashboard.service'; // Adjust path if needed

@Component({
  selector: 'app-issues',
  imports: [CommonModule, PageHeaderComponent, FormsModule],
  providers: [DatePipe, DashboardService],
  template: `
    <app-page-header title="Issues" searchPlaceholder="Search issues..."></app-page-header>

    <div class="issues-body">
      <!-- Filters -->
      <div class="filters-row">
        <select class="filter-select" [(ngModel)]="statusFilter">
          <option value="all">Status: All</option>
          <option value="HOLD">Hold</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <select class="filter-select" [(ngModel)]="priorityFilter">
          <option value="all">Priority: All</option>
          <option value="URGENT">Urgent</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </div>

      <div *ngIf="dashService.data()?.issues as issues">
        <!-- Stats -->
        <div class="issue-stats">
          <div class="issue-stat-card">
            <div class="stat-label">Total Issues</div>
            <div class="stat-value">{{ issues.length }}</div>
          </div>
          <div class="issue-stat-card">
            <div class="stat-label">Urgent / High</div>
            <div class="stat-value critical-color">
              {{ countByPriority(issues, ['URGENT', 'HIGH']) }}
            </div>
          </div>
          <div class="issue-stat-card">
            <div class="stat-label">On Hold</div>
            <div class="stat-value inprogress-color">{{ countByStatus(issues, 'HOLD') }}</div>
          </div>
          <div class="issue-stat-card">
            <div class="stat-label">Resolved</div>
            <div class="stat-value resolved-color">{{ countByStatus(issues, 'RESOLVED') }}</div>
          </div>
        </div>

        <!-- Issues Table (Due Date column removed) -->
        <div class="issues-table-card">
          <table class="issues-table">
            <thead>
              <tr>
                <th>ISSUE TITLE</th>
                <th>ASSIGNED TO</th>
                <th>REPORTER</th>
                <th>PRIORITY</th>
                <th>STATUS</th>
                <th>CREATED</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let issue of filteredIssues(issues)" class="issue-row">
                <td class="issue-title-cell">
                  <div class="issue-title">{{ issue.title }}</div>
                  <div class="issue-desc">
                    {{ issue.description || 'No description provided.' }}
                  </div>
                </td>
                <td class="assignee-cell">
                  <div class="avatar-sm" [style.background]="getAvatarColor(displayName(issue.owner))">
                    {{ getInitials(displayName(issue.owner)) }}
                  </div>
                  <span>{{ displayName(issue.owner) || 'Unassigned' }}</span>
                </td>
                <td>
                  <span style="font-size: 13px; color: #555; text-transform: capitalize;">{{
                    displayName(issue.reporter) || 'System'
                  }}</span>
                </td>
                <td>
                  <span class="priority-badge" [ngClass]="issue.priority.toLowerCase()">{{
                    issue.priority
                  }}</span>
                </td>
                <td>
                  <span class="status-badge" [ngClass]="getStatusClass(issue.status)">{{
                    issue.status
                  }}</span>
                </td>
                <td class="date-cell">
                  {{ issue.created_time ? (issue.created_time | date: 'mediumDate') : '—' }}
                </td>
              </tr>
            </tbody>
          </table>

          <div class="empty-state" *ngIf="filteredIssues(issues).length === 0">
            <div class="empty-icon">🎉</div>
            <div class="empty-title">No issues found</div>
            <div class="empty-desc">
              Try adjusting your filters or wait for a new issue to be reported.
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .issues-body {
        padding: 24px 32px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .filters-row {
        display: flex;
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

      /* Stats */
      .issue-stats {
        display: flex;
        gap: 16px;
        margin-bottom: 24px;
      }
      .issue-stat-card {
        flex: 1;
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 16px 20px;
      }
      .stat-label {
        font-size: 11px;
        color: #888;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }
      .stat-value {
        font-size: 26px;
        font-weight: 700;
        color: #1a1a2e;
      }
      .inprogress-color {
        color: #5b4fcf;
      }
      .critical-color {
        color: #e53e3e;
      }
      .resolved-color {
        color: #27ae60;
      }

      /* Table */
      .issues-table-card {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        overflow: hidden;
      }
      .issues-table {
        width: 100%;
        border-collapse: collapse;
      }
      .issues-table th {
        text-align: left;
        font-size: 11px;
        color: #888;
        font-weight: 600;
        letter-spacing: 0.5px;
        padding: 14px 16px;
        border-bottom: 1px solid #f0f0f0;
        background: #fafafa;
      }
      .issues-table td {
        padding: 14px 16px;
        font-size: 13px;
        color: #333;
        border-bottom: 1px solid #f5f5f5;
        vertical-align: middle;
      }
      .issue-row:last-child td {
        border-bottom: none;
      }
      .issue-row:hover {
        background: #fafafa;
      }
      .issue-title {
        font-weight: 500;
        color: #1a1a2e;
      }
      .issue-desc {
        font-size: 11.5px;
        color: #999;
        margin-top: 2px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .assignee-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        text-transform: capitalize;
      }
      .avatar-sm {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        color: white;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        text-transform: uppercase;
      }

      .priority-badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .priority-badge.urgent {
        background: #ffeaea;
        color: #e53e3e;
        font-weight: 700;
      }
      .priority-badge.high {
        background: #fff3e0;
        color: #e67e22;
        font-weight: 600;
      }
      .priority-badge.medium {
        background: #fff8e1;
        color: #f59e0b;
      }
      .priority-badge.low {
        background: #f5f5f5;
        color: #666;
      }

      /* Updated Badges */
      .status-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 600;
        text-transform: capitalize;
      }
      .status-hold {
        background: #fff3e0;
        color: #e07b39;
      }
      .status-resolved {
        background: #e8f5e9;
        color: #27ae60;
      }

      .date-cell {
        color: #999;
        font-size: 12px;
        white-space: nowrap;
      }

      /* Empty State */
      .empty-state {
        padding: 48px;
        text-align: center;
      }
      .empty-icon {
        font-size: 36px;
        margin-bottom: 12px;
      }
      .empty-title {
        font-size: 15px;
        font-weight: 600;
        color: #333;
        margin-bottom: 6px;
      }
      .empty-desc {
        font-size: 13px;
        color: #888;
      }
    `,
  ],
})
export class IssuesComponent implements OnInit {
  dashService = inject(DashboardService);

  constructor() {
    this.dashService.disableLive = true;
  }

  ngOnInit() {
    this.dashService.load();
  }

  statusFilter = 'all';
  priorityFilter = 'all';

  filteredIssues(issues: any[]): any[] {
    if (!issues) return [];
    return issues.filter((issue) => {
      const matchStatus = this.statusFilter === 'all' || issue.status === this.statusFilter;
      const matchPriority = this.priorityFilter === 'all' || issue.priority === this.priorityFilter;
      return matchStatus && matchPriority;
    });
  }

  countByStatus(issues: any[], status: string): number {
    if (!issues) return 0;
    return issues.filter((i) => i.status === status).length;
  }

  countByPriority(issues: any[], priorities: string[]): number {
    if (!issues) return 0;
    return issues.filter((i) => priorities.includes(i.priority)).length;
  }

  getStatusClass(status: string): string {
    return status ? `status-${status.toLowerCase()}` : '';
  }

  displayName(user?: { name?: string; display_name?: string; real_name?: string; email?: string } | null): string {
    if (!user) return '';
    const raw = user.display_name || user.real_name || user.name || (user.email ? user.email.split('@')[0] : '');
    return raw || 'Unassigned';
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
