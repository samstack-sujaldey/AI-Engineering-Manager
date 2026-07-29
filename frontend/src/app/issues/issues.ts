import { Component, inject, OnInit, ChangeDetectorRef, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DashboardService } from '../services/dashboard.service';

@Component({
  selector: 'app-issues',
  imports: [CommonModule, PageHeaderComponent, FormsModule],
  providers: [DatePipe],
  template: `
    <app-page-header title="Issues" searchPlaceholder="Search issues..."></app-page-header>

    <div class="issues-body">
      <!-- Filters -->
      <div class="filters-row">
        <select class="filter-select" [(ngModel)]="statusFilter" (change)="loadIssues()">
          <option value="all">Status: All</option>
          <option value="HOLD">Hold</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <select class="filter-select" [(ngModel)]="priorityFilter" (change)="loadIssues()">
          <option value="all">Priority: All</option>
          <option value="URGENT">Urgent</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <input
          type="date"
          class="filter-select"
          [value]="dashService.selectedDate()"
          (change)="onDateChange($event)"
        />
      </div>

      <div *ngIf="!loading">
        <!-- Stats -->
        <div class="issue-stats" *ngIf="issues.length > 0">
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

        <!-- Issues Table -->
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
                  <div class="avatar-sm" [style.background]="getAvatarColor(getPersonName(issue.owner))">
                    {{ getInitials(getPersonName(issue.owner)) }}
                  </div>
                  <span>{{ getPersonName(issue.owner) }}</span>
                </td>
                <td>
                  <span style="font-size: 13px; color: #555; text-transform: capitalize;">{{
                    getPersonName(issue.reporter) || 'System'
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
        -webkit-line-orient: vertical;
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
  http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  issues: any[] = [];
  statusFilter = 'all';
  priorityFilter = 'all';
  loading = false;

  constructor() {
    effect(() => {
      const globalDate = this.dashService.selectedDate();
      this.loadIssues();
    });
  }

  ngOnInit() {
    this.loadIssues();
  }

  onDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      this.dashService.setSelectedDate(input.value);
    }
  }

  async loadIssues() {
    this.loading = true;
    try {
      const params: any = {};
      if (this.statusFilter !== 'all') params.status = this.statusFilter;
      if (this.priorityFilter !== 'all') params.priority = this.priorityFilter;
      const activeChannel = this.dashService.activeChannelId();
      if (activeChannel) params.channel = activeChannel;
      
      const selectedDate = this.dashService.selectedDate();
      params.date = selectedDate;

      const response = (await firstValueFrom(this.http.get('/api/issues', { params }))) as any[] || [];
      
      // Strict frontend date filter: ensures both stats cards and table only show the selected date
      this.issues = response.filter(issue => 
        this.matchesSelectedDate(issue.created_time, selectedDate)
      );

      this.cdr.detectChanges();
    } catch (err) {
      console.error('Failed to load issues:', err);
      this.issues = [];
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  filteredIssues(issues: any[]): any[] {
    if (!issues) return [];
    return issues.filter((issue) => {
      const matchStatus = this.statusFilter === 'all' || issue.status === this.statusFilter;
      const matchPriority = this.priorityFilter === 'all' || issue.priority === this.priorityFilter;
      return matchStatus && matchPriority;
    });
  }

  /**
   * Robust date matcher that handles ISO strings, Unix timestamps (seconds/ms),
   * and Slack timestamp formats.
   */
  private matchesSelectedDate(issueDate: any, targetDateStr: string): boolean {
    if (!issueDate || !targetDateStr) return false;

    // Direct string match if ISO format (e.g. "2026-07-29T10:00:00Z")
    if (typeof issueDate === 'string' && issueDate.startsWith(targetDateStr)) {
      return true;
    }

    let numericDate = Number(issueDate);
    let dateObj: Date;

    if (!isNaN(numericDate) && numericDate > 0) {
      // If timestamp is in seconds (10 digits like Slack timestamps), convert to milliseconds
      if (numericDate < 10000000000) {
        numericDate *= 1000;
      }
      dateObj = new Date(numericDate);
    } else {
      dateObj = new Date(issueDate);
    }

    if (isNaN(dateObj.getTime())) return false;

    // Convert to YYYY-MM-DD
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const formattedDate = `${yyyy}-${mm}-${dd}`;

    return formattedDate === targetDateStr;
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