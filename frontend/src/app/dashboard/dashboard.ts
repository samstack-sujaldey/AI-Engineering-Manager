import { Component, inject, OnInit, effect, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../shared/page-header';
import { DashboardService } from '../services/dashboard.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  providers: [DatePipe],
  template: `
    <app-page-header 
      title="Dashboard" 
      searchPlaceholder="Search tasks, teams, or summaries..."
      [searchQuery]="searchQuery()"
      [suggestions]="searchSuggestions"
      (searchChange)="onSearchChange($event)">
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
          <button
            class="clear-date-btn"
            *ngIf="dashService.selectedDate()"
            (click)="clearDate()"
            title="Show All Dates"
          >✕</button>
        </div>

        <div class="select-wrapper">
          <select
            [value]="dashService.selectedChannel() || 'all'"
            (change)="onChannelChange($event)"
            class="channel-select"
          >
            <option value="all">All Channels</option>
            <option
              *ngFor="let channel of dashService.channels()"
              [value]="channel.id"
            >
              {{ channel.name }}
            </option>
          </select>
        </div>

        <button class="connect-slack-btn" (click)="connectSlack()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 9h-4V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4h4a2 2 0 0 0 2-2V9z"></path>
          </svg>
          Connect Slack
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
            <div class="stat-value">{{ getFilteredTasks(data.tasks).length }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">In Progress</div>
            <div class="stat-value">{{ countStatus(data.tasks, ['PROCESSING', 'IN_PROGRESS', 'CURRENT', 'OPEN']) }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Blocked</div>
            <div class="stat-value critical">{{ countStatus(data.tasks, ['BLOCKED']) }}</div>
            <div class="stat-badge critical" *ngIf="countStatus(data.tasks, ['BLOCKED']) > 0">
              CRITICAL
            </div>
          </div>
          <div class="stat-card highlighted">
            <div class="stat-label">Issues</div>
            <div class="stat-value">{{ getFilteredIssues(data.issues).length }}</div>
            <a routerLink="/issues" class="view-list-link">View list</a>
          </div>
        </div>

        <!-- Middle Row -->
        <div class="middle-row">
          <div class="standup-card">
            <div class="card-header">
              <span class="card-title">Recent Discussion & Timeline</span>
            </div>
            <div class="standup-entry" *ngFor="let disc of getFilteredDiscussion(data.discussion_timeline).slice(0, 3)">
              <div class="standup-text">{{ disc.content }}</div>
              <div class="standup-meta">
                <span class="slack-badge">{{ displayName(disc.author) || 'User' }}</span>
                <span class="standup-time">{{ disc.timestamp | date: 'MMM d, y, h:mm a' }}</span>
              </div>
            </div>
            <div *ngIf="getFilteredDiscussion(data.discussion_timeline).length === 0" class="empty-text">
              No matching discussions found.
            </div>
          </div>

          <div class="activity-card">
            <div class="card-title">Recent Activity</div>
            <div class="activity-list">
              <div class="activity-item" *ngFor="let activity of getFilteredActivity(data.recent_activity).slice(0, 5)">
                <span class="activity-dot"></span>
                <div class="activity-content">
                  <div class="activity-text">{{ activity.summary }}</div>
                  <div class="activity-time">{{ activity.created_at | date: 'M/d/yy, h:mm a' }}</div>
                </div>
              </div>
              <div *ngIf="getFilteredActivity(data.recent_activity).length === 0" class="empty-text">
                No matching activity found.
              </div>
            </div>
          </div>
        </div>

        <!-- Team Overview -->
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
              <tr *ngFor="let w of getCleanWorkload(data.owner_workload)">
                <td class="member-cell">
                  <div class="avatar" [style.background]="getAvatarColor(w.name)">
                    {{ getInitials(w.name) }}
                  </div>
                  <div>
                    <div class="member-name">{{ displayName({ name: w.name }) || 'Unassigned' }}</div>
                    <div class="member-role">Developer</div>
                  </div>
                </td>
                <td>{{ w.tasks }}</td>
                <td>{{ w.issues }}</td>
                <td [class.critical-value]="w.blocked > 0">{{ w.blocked }}</td>
              </tr>
              <tr *ngIf="getCleanWorkload(data.owner_workload).length === 0">
                <td colspan="4" class="empty-text" style="padding: 16px 0;">No active human team members for this filter.</td>
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
      .dashboard-body { padding: 24px 32px; display: flex; flex-direction: column; gap: 20px; }
      .header-controls { display: flex; align-items: center; gap: 12px; }
      .date-picker-wrapper { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #333; font-weight: 500; }
      .date-input { border: 1px solid #5b4fcf; border-radius: 6px; padding: 6px 12px; font-size: 13px; color: #1a1a2e; outline: none; background: #fafafd; cursor: pointer; }
      .clear-date-btn { background: #f0f0f0; border: 1px solid #d0d0d0; border-radius: 6px; width: 28px; height: 32px; cursor: pointer; font-size: 12px; color: #555; display: flex; align-items: center; justify-content: center; }
      .clear-date-btn:hover { background: #e0e0e0; }

      /* Styled Channel Select Dropdown */
      .select-wrapper {
        position: relative;
        display: inline-block;
      }
      .channel-select {
        appearance: none;
        background-color: #fafafd;
        border: 1px solid #dcd6f7;
        border-radius: 6px;
        padding: 7px 32px 7px 12px;
        font-size: 13px;
        font-weight: 500;
        color: #333;
        outline: none;
        cursor: pointer;
        transition: all 0.2s ease;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235b4fcf' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 10px center;
      }
      .channel-select:hover {
        border-color: #5b4fcf;
        background-color: #ffffff;
      }
      .channel-select:focus {
        border-color: #5b4fcf;
        box-shadow: 0 0 0 3px rgba(91, 79, 207, 0.12);
        background-color: #ffffff;
      }

      /* Polished Connect Slack Button */
      .connect-slack-btn { 
        background: linear-gradient(135deg, #4A154B 0%, #611f69 100%);
        color: #ffffff; 
        border: none; 
        border-radius: 6px; 
        padding: 7px 16px; 
        font-size: 13px; 
        font-weight: 600; 
        cursor: pointer; 
        display: flex; 
        align-items: center; 
        gap: 8px; 
        box-shadow: 0 2px 4px rgba(74, 21, 75, 0.15);
        transition: all 0.2s ease;
      }
      .connect-slack-btn:hover { 
        background: linear-gradient(135deg, #3c113d 0%, #4a154b 100%);
        box-shadow: 0 4px 8px rgba(74, 21, 75, 0.25);
        transform: translateY(-1px);
      }
      .connect-slack-btn:active {
        transform: translateY(0);
        box-shadow: 0 1px 2px rgba(74, 21, 75, 0.2);
      }

      .error-banner { background: #ffeaea; color: #e53e3e; padding: 12px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
      .loading-state { color: #888; font-size: 14px; padding: 40px; text-align: center; background: white; border-radius: 8px; border: 1px solid #e9ecef; }
      .empty-text { color: #888; font-size: 13px; font-style: italic; }
      .stats-row { display: flex; gap: 16px; }
      .stat-card { flex: 1; background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 18px 20px; }
      .stat-label { font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
      .stat-value { font-size: 28px; font-weight: 700; color: #1a1a2e; margin: 4px 0; }
      .stat-value.critical { color: #e53e3e; }
      .stat-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 3px; }
      .stat-badge.critical { background: #fff0f0; color: #e53e3e; }
      .view-list-link { font-size: 12px; color: #5b4fcf; cursor: pointer; text-decoration: none; }
      .middle-row { display: flex; gap: 20px; }
      .standup-card { flex: 1.8; background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
      .activity-card { flex: 1; background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; }
      .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
      .card-title { font-size: 14px; font-weight: 600; color: #1a1a2e; margin-bottom: 12px; }
      .standup-entry { padding: 14px; border: 1px solid #e9ecef; border-radius: 6px; }
      .standup-text { font-size: 13.5px; color: #333; margin-bottom: 10px; line-height: 1.4; }
      .standup-meta { display: flex; align-items: center; gap: 10px; }
      .slack-badge { background: #f0f0f0; color: #555; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; text-transform: capitalize; }
      .standup-time { font-size: 11.5px; color: #999; }
      .activity-list { display: flex; flex-direction: column; gap: 12px; }
      .activity-item { display: flex; align-items: flex-start; gap: 10px; }
      .activity-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; margin-top: 4px; flex-shrink: 0; }
      .activity-text { font-size: 12.5px; color: #333; line-height: 1.4; }
      .activity-time { font-size: 11px; color: #aaa; margin-top: 2px; }
      .team-overview-card { background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; }
      .manage-team-link { font-size: 13px; color: #5b4fcf; text-decoration: none; font-weight: 500; }
      .team-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      .team-table th { text-align: left; font-size: 11px; color: #888; font-weight: 600; letter-spacing: 0.5px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
      .team-table td { padding: 14px 0; font-size: 13.5px; color: #333; border-bottom: 1px solid #f5f5f5; }
      .member-cell { display: flex; align-items: center; gap: 12px; }
      .avatar { width: 34px; height: 34px; border-radius: 50%; color: white; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; text-transform: uppercase; }
      .member-name { font-size: 13.5px; font-weight: 500; color: #1a1a2e; text-transform: capitalize; }
      .member-role { font-size: 11.5px; color: #888; }
      .critical-value { color: #e53e3e !important; font-weight: 600; }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  dashService = inject(DashboardService);
  
  // Signal to hold search query input
  searchQuery = signal<string>('');

  constructor() {
    effect(() => {
      this.dashService.load();
    });
  }

  ngOnInit() {
    this.dashService.load();
  }

  onSearchChange(query: string): void {
    this.searchQuery.set(query.toLowerCase().trim());
  }

  // Computed getter to feed matching tasks/issues as dropdown suggestions into the page header
  get searchSuggestions() {
    const q = this.searchQuery();
    if (!q) return [];
    
    const data = this.dashService.data();
    if (!data) return [];

    const taskResults = (data.tasks || [])
      .filter((t: any) => 
        (t.title && t.title.toLowerCase().includes(q)) || 
        (t.description && t.description.toLowerCase().includes(q))
      )
      .slice(0, 5)
      .map((t: any) => ({
        id: t.id || t._id,
        title: t.title || t.description,
        subtitle: `Task • Status: ${t.status || 'Open'}`,
        type: 'task' as const
      }));

    const issueResults = (data.issues || [])
      .filter((i: any) => 
        (i.title && i.title.toLowerCase().includes(q)) || 
        (i.description && i.description.toLowerCase().includes(q))
      )
      .slice(0, 5)
      .map((i: any) => ({
        id: i.id || i._id,
        title: i.title || i.description,
        subtitle: `Issue • Status: ${i.status || 'Open'}`,
        type: 'issue' as const
      }));

    return [...taskResults, ...issueResults];
  }
  
  onChannelChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const channelId = value === 'all' ? '' : value;
    this.dashService.setChannel(channelId);
  }

  connectSlack(): void {
    window.location.href = 'http://localhost:4200/api/slack/install';
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
      rawName.includes('aiem') ||
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

  private matchesSearch(item: any, fields: string[]): boolean {
    const q = this.searchQuery();
    if (!q) return true;
    return fields.some((field) => {
      const val = item[field];
      if (!val) return false;
      return String(val).toLowerCase().includes(q);
    });
  }

  getCleanTasks(tasks: any[]): any[] {
    if (!tasks) return [];
    const selectedDate = this.dashService.selectedDate();
    return tasks.filter((t) => {
      const assignee = t.assigned_to || t.owner || t.assignee;
      if (this.isBotUser(assignee)) return false;

      const taskDate = t.created_time || t.created_at || t.date || t.updated_time;
      return this.matchesSelectedDate(taskDate, selectedDate);
    });
  }

  getFilteredTasks(tasks: any[]): any[] {
    const clean = this.getCleanTasks(tasks);
    const q = this.searchQuery();
    if (!q) return clean;
    return clean.filter((t) => this.matchesSearch(t, ['title', 'description', 'status', 'assigned_to', 'owner', 'assignee']));
  }

  getCleanIssues(issues: any[]): any[] {
    if (!issues) return [];
    const selectedDate = this.dashService.selectedDate();
    return issues.filter((i) => {
      const assignee = i.assigned_to || i.owner || i.assignee;
      if (this.isBotUser(assignee)) return false;

      const issueDate = i.created_time || i.created_at || i.date || i.updated_time;
      return this.matchesSelectedDate(issueDate, selectedDate);
    });
  }

  getFilteredIssues(issues: any[]): any[] {
    const clean = this.getCleanIssues(issues);
    const q = this.searchQuery();
    if (!q) return clean;
    return clean.filter((i) => this.matchesSearch(i, ['title', 'description', 'status', 'assigned_to', 'owner', 'assignee']));
  }

  getCleanDiscussion(discussions: any[]): any[] {
    if (!discussions) return [];
    const selectedDate = this.dashService.selectedDate();
    return discussions.filter((disc) => {
      const discDate = disc.timestamp || disc.created_at || disc.date;
      return this.matchesSelectedDate(discDate, selectedDate);
    });
  }

  getFilteredDiscussion(discussions: any[]): any[] {
    const clean = this.getCleanDiscussion(discussions);
    const q = this.searchQuery();
    if (!q) return clean;
    return clean.filter((disc) => this.matchesSearch(disc, ['content', 'author', 'title']));
  }

  getCleanActivity(activities: any[]): any[] {
    if (!activities) return [];
    const selectedDate = this.dashService.selectedDate();
    return activities.filter((act) => {
      const actDate = act.created_at || act.timestamp || act.date;
      return this.matchesSelectedDate(actDate, selectedDate);
    });
  }

  getFilteredActivity(activities: any[]): any[] {
    const clean = this.getCleanActivity(activities);
    const q = this.searchQuery();
    if (!q) return clean;
    return clean.filter((act) => this.matchesSearch(act, ['summary', 'action', 'type']));
  }

  getCleanWorkload(workload: any[]): any[] {
    const tasks = this.getFilteredTasks(this.dashService.data()?.tasks || []);
    const issues = this.getFilteredIssues(this.dashService.data()?.issues || []);
    const memberMap = new Map<string, { name: string; tasks: number; issues: number; blocked: number }>();

    const rawWorkload = workload || [];
    rawWorkload.forEach((w) => {
      if (!this.isBotUser(w.name)) {
        const normalized = this.normalizeName(w.name);
        if (normalized && !memberMap.has(normalized)) {
          memberMap.set(normalized, { name: normalized, tasks: 0, issues: 0, blocked: 0 });
        }
      }
    });

    tasks.forEach((t) => {
      const assignee = t.assigned_to || t.owner || t.assignee;
      const name = this.normalizeName(this.displayName(assignee));
      if (name && name !== 'Unassigned' && !this.isBotUser(name)) {
        if (!memberMap.has(name)) {
          memberMap.set(name, { name, tasks: 0, issues: 0, blocked: 0 });
        }
        const m = memberMap.get(name)!;
        m.tasks++;
        if ((t.status || '').toUpperCase() === 'BLOCKED') {
          m.blocked++;
        }
      }
    });

    issues.forEach((i) => {
      const assignee = i.assigned_to || i.owner || i.assignee;
      const name = this.normalizeName(this.displayName(assignee));
      if (name && name !== 'Unassigned' && !this.isBotUser(name)) {
        if (!memberMap.has(name)) {
          memberMap.set(name, { name, tasks: 0, issues: 0, blocked: 0 });
        }
        const m = memberMap.get(name)!;
        m.issues++;
        if ((i.status || '').toUpperCase() === 'BLOCKED') {
          m.blocked++;
        }
      }
    });

    return Array.from(memberMap.values());
  }

  countStatus(tasks: any[], targetStatuses: string[]): number {
    const clean = this.getFilteredTasks(tasks);
    if (!clean) return 0;
    return clean.filter((t) => {
      const status = (t.status || '').toUpperCase();
      return targetStatuses.some((s) => status === s.toUpperCase());
    }).length;
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