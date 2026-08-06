import { Component, inject, OnInit, ChangeDetectorRef, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DashboardService } from '../services/dashboard.service';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-issues',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, FormsModule],
  providers: [DatePipe],
  template: `
    <app-page-header
      title="Issues & Tickets"
      searchPlaceholder="Search issues..."
      (searchChange)="onSearchQueryChange($event)"
    ></app-page-header>

    <div class="issues-body">
      <div class="filters-row">
        <select class="filter-select" [(ngModel)]="statusFilter">
          <option value="all">Status: All</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
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

      <div class="issues-table-card">
        <table class="issues-table">
          <thead>
            <tr>
              <th style="width: 35%;">ISSUE NAME</th>
              <th style="width: 25%;">ASSIGNED TO</th>
              <th style="width: 15%;">PRIORITY</th>
              <th style="width: 15%;">STATUS</th>
              <th style="width: 20%;">CREATED AT</th>
            </tr>
          </thead>
          <tbody>
            <tr
              *ngFor="let issue of dropdownFilteredIssues()"
              class="clickable-row"
              [class.highlighted-row]="isHighlighted(issue)"
              [id]="'issue-' + getIssueId(issue)"
              (click)="openIssueModal(issue)"
            >
              <td class="issue-name-cell">
                <div class="issue-name">{{ issue.title || issue.description || 'Untitled Issue' }}</div>
                <div class="issue-category">{{ issue.channel_name ? '#' + issue.channel_name : 'Click to view details...' }}</div>
              </td>
              <td class="assignee-cell">
                <div
                  class="avatar-sm"
                  [style.background]="getAvatarColor(issue.assigneeName)"
                >
                  {{ getInitials(issue.assigneeName) }}
                </div>
                <span class="assignee-name">{{ issue.assigneeName }}</span>
              </td>
              <td>
                <span class="priority-badge" [ngClass]="(issue.priority || 'low').toLowerCase()">{{
                  issue.priority || 'Normal'
                }}</span>
              </td>
              <td>
                <span class="status-badge" [ngClass]="getStatusClass(issue.status)">{{
                  issue.status || 'Open'
                }}</span>
              </td>
              <td class="due-date">
                {{ (issue.created_time || issue.created_at || issue.date) ? ((issue.created_time || issue.created_at || issue.date) | date: 'MMM d, y, h:mm a') : '—' }}
              </td>
            </tr>
            <tr *ngIf="dropdownFilteredIssues().length === 0">
              <td colspan="5" class="empty-state">No issues found matching your filters.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ISSUE DETAILS MODAL OVERLAY -->
    <div class="modal-overlay" *ngIf="selectedIssue && !issueToDelete" (click)="closeModal()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title-wrapper">
            <span class="alert-icon">🐛</span>
            <h2 class="modal-title">Issue Details</h2>
          </div>
          <button class="close-btn" (click)="closeModal()">&times;</button>
        </div>

        <div class="modal-body">
          <div class="info-group">
            <h3 class="info-label">FULL ISSUE DESCRIPTION</h3>
            <p class="info-value" style="white-space: pre-wrap; word-break: break-word; line-height: 1.5;">
              {{ selectedIssue.description || selectedIssue.text || selectedIssue.title }}
            </p>
          </div>
        </div>

        <div class="modal-footer modal-footer-between">
          <button *ngIf="auth.isAdmin()" class="btn-danger-outline" (click)="confirmDelete(selectedIssue)">
            🗑️ Delete Issue
          </button>
          <button class="btn-primary" (click)="closeModal()">Close</button>
        </div>
      </div>
    </div>

    <!-- DELETE CONFIRMATION POPUP -->
    <div class="modal-overlay" *ngIf="issueToDelete" (click)="cancelDelete()">
      <div class="modal-content delete-modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title-wrapper">
            <span class="alert-icon">⚠️</span>
            <h2 class="modal-title">Confirm Deletion</h2>
          </div>
          <button class="close-btn" (click)="cancelDelete()">&times;</button>
        </div>

        <div class="modal-body">
          <p class="delete-msg">Are you sure you want to delete this issue? This action cannot be undone.</p>
          <div class="preview-box">
            <strong>{{ issueToDelete.title || issueToDelete.description }}</strong>
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
      .issues-body {
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
      .issues-table-card {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        overflow: hidden;
      }
      .issues-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .issues-table th {
        text-align: left;
        font-size: 11px;
        color: #888;
        font-weight: 600;
        letter-spacing: 0.5px;
        padding: 14px 20px;
        border-bottom: 1px solid #f0f0f0;
        background: #fafafa;
      }
      .issues-table td {
        padding: 14px 20px;
        font-size: 13.5px;
        color: #333;
        border-bottom: 1px solid #f0f0f0;
        vertical-align: middle;
        text-align: left;
      }
      .issues-table tr {
        transition: background-color 0.2s ease, border-color 0.2s ease;
      }
      .issues-table tr:last-child td {
        border-bottom: none;
      }
      .clickable-row {
        cursor: pointer;
      }
      .clickable-row:hover td {
        background-color: #f8f9fa !important;
      }

      .highlighted-row td {
        background-color: #f3f0ff !important;
      }

      .issue-name-cell {
        padding-right: 16px;
        overflow: hidden;
      }
      .issue-name {
        font-size: 13.5px;
        color: #1a1a2e;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .issue-category {
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
      .status-open { background: #e8eeff; color: #5b4fcf; }
      .status-in_progress { background: #e3f2fd; color: #1976d2; }
      .status-resolved { background: #e8f5e9; color: #27ae60; }
      .status-closed { background: #f1f3f5; color: #495057; }
      .due-date { color: #555; font-size: 13px; white-space: nowrap; }
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
export class IssuesComponent implements OnInit {
  http = inject(HttpClient);
  dashService = inject(DashboardService);
  private cdr = inject(ChangeDetectorRef);
  auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  issues: any[] = [];
  statusFilter = 'all';
  priorityFilter = 'all';
  searchQuery = signal('');
  highlightedId: string | null = null;

  selectedIssue: any = null;
  issueToDelete: any = null;

  ngOnInit() {
    this.route.queryParamMap.subscribe(params => {
      const highlightId = params.get('highlight') || params.get('id') || params.get('issueId');
      if (highlightId) {
        this.highlightedId = String(highlightId);
        this.statusFilter = 'all';
        this.priorityFilter = 'all';
        this.searchQuery.set('');
        this.dashService.setSelectedDate('');
      } else {
        this.highlightedId = null;
      }

      this.loadIssues().then(() => {
        if (this.highlightedId) {
          setTimeout(() => this.scrollToHighlightedIssue(), 300);
        }
      });
    });
  }

  getIssueId(issue: any): string {
    if (!issue) return '';
    if (typeof issue === 'string') return issue;
    const rawId = issue.issue_id || issue.id || issue._id?.$oid || issue._id || '';
    return typeof rawId === 'object' ? String(rawId.$oid || JSON.stringify(rawId)) : String(rawId);
  }

  isHighlighted(issue: any): boolean {
    if (!this.highlightedId || !issue) return false;
    const currentId = this.getIssueId(issue);
    return currentId === String(this.highlightedId);
  }

  onSearchQueryChange(query: string): void {
    this.searchQuery.set(query);
  }

  onDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.dashService.setSelectedDate(input.value);
    this.loadIssues();
  }

  clearDateFilter(): void {
    this.dashService.setSelectedDate('');
    this.loadIssues();
  }

  async loadIssues() {
    try {
      const url = this.dashService.getFilteredUrl('/issues');
      const response: any = await firstValueFrom(this.http.get(url)).catch(() => []);
      const rawList = Array.isArray(response) ? response : (response?.issues || response?.data || []);

      this.issues = rawList
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
      console.error('Failed to load issues:', err);
      this.issues = [];
      this.cdr.detectChanges();
    }
  }

  scrollToHighlightedIssue() {
    if (!this.highlightedId) return;
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const el = document.getElementById('issue-' + this.highlightedId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearInterval(interval);
      } else if (attempts > 30) {
        clearInterval(interval);
      }
    }, 100);
  }

  filteredIssues(): any[] {
    const selectedDate = this.dashService.selectedDate();
    const q = this.searchQuery().toLowerCase().trim();
    
    const filtered = this.issues.filter((issue) => {
      const matchStatus = this.statusFilter === 'all' || (issue.status || '').toLowerCase() === this.statusFilter.toLowerCase();
      const matchPriority = this.priorityFilter === 'all' || (issue.priority || '').toLowerCase() === this.priorityFilter.toLowerCase();
      const issueDate = issue.created_time || issue.created_at;
      const matchDate = this.matchesSelectedDate(issueDate, selectedDate, issue.status);

      const titleMatch = (issue.title || issue.description || '').toLowerCase().includes(q);
      const assigneeMatch = (issue.assigneeName || '').toLowerCase().includes(q);
      const matchSearch = !q || titleMatch || assigneeMatch;

      return matchStatus && matchPriority && matchDate && matchSearch;
    });

    return filtered.sort((a, b) => {
      const dateA = new Date(a.created_at || a.created_time || 0).getTime();
      const dateB = new Date(b.created_at || b.created_time || 0).getTime();
      return dateB - dateA;
    });
  }

  dropdownFilteredIssues(): any[] {
    const baseIssues = [...this.filteredIssues()];

    if (this.highlightedId) {
      const targetIssue = this.issues.find(issue => this.getIssueId(issue) === String(this.highlightedId));
      if (targetIssue) {
        const index = baseIssues.findIndex(issue => this.getIssueId(issue) === String(this.highlightedId));
        if (index > -1) {
          baseIssues.splice(index, 1);
        }
        baseIssues.unshift(targetIssue);
      }
    }

    return baseIssues;
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
      rawName.includes('aiem') ||
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

  private isCompletedStatus(status: any): boolean {
    const s = String(status || '').toLowerCase();
    return s === 'resolved' || s === 'closed' || s === 'done';
  }

  private matchesSelectedDate(itemDate: any, targetDateStr: string, status?: any): boolean {
    if (!targetDateStr) return true;
    if (!itemDate) return false;

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
    const itemDateStr = `${yyyy}-${mm}-${dd}`;

    if (itemDateStr === targetDateStr) return true;

    if (!this.isCompletedStatus(status)) {
      const [ty, tm, td] = targetDateStr.split('-').map(Number);
      if (ty && tm && td) {
        const targetEnd = new Date(ty, tm - 1, td, 23, 59, 59, 999);
        if (dateObj.getTime() <= targetEnd.getTime()) return true;
      }
    }

    return false;
  }

  getStatusClass(status: string): string {
    return status ? `status-${status.toLowerCase()}` : 'status-open';
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

  openIssueModal(issue: any) {
    this.selectedIssue = issue;
  }

  closeModal() {
    this.selectedIssue = null;
  }

  confirmDelete(issue: any) {
    this.issueToDelete = issue;
  }

  cancelDelete() {
    this.issueToDelete = null;
  }

  async executeDelete() {
    if (!this.issueToDelete) return;
    const issueId = this.getIssueId(this.issueToDelete);

    try {
      const token = localStorage.getItem('auth_token');
      const headers = new HttpHeaders({
        'Authorization': `Bearer ${token}`
      });

      await firstValueFrom(
        this.http.delete(`${environment.apiUrl}/issues/${issueId}`, { headers })
      );

      this.issues = this.issues.filter(i => this.getIssueId(i) !== issueId);
      this.issueToDelete = null;
      this.selectedIssue = null;
      this.cdr.detectChanges();
      
    } catch (err) {
      console.error('Failed to delete issue:', err);
      this.issueToDelete = null; 
      this.cdr.detectChanges();
      alert('Failed to delete issue. You might not have permission.');
    }
  }
}
