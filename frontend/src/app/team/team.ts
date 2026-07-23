import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DashboardService } from '../services/dashboard.service';
import { firstValueFrom } from 'rxjs';

interface TeamMember {
  name: string;
  role: string;
  initials: string;
  color: string;
  current: number;
  blocked: number;
  doneToday: number;
}

interface Channel {
  id: string;
  name: string;
}

interface DayActivity {
  dayName: string;
  current: number;
  blocked: number;
  completed: number;
}

@Component({
  selector: 'app-team',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, FormsModule],
  template: `
    <app-page-header title="Team" searchPlaceholder="Find a team member..."></app-page-header>

    <div class="team-body">
      <div class="team-section-header">
        <div>
          <h2 class="squad-title">{{ selectedChannelName }} Team</h2>
          <p class="squad-subtitle">Channel-specific workload and task breakdown overview.</p>
        </div>

        <div class="select-wrapper">
          <svg class="select-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <select class="team-filter-select" [(ngModel)]="selectedChannelId" (change)="onChannelChange()">
            <option value="all">All Channels</option>
            <option *ngFor="let ch of channels" [value]="ch.id">#{{ ch.name }}</option>
          </select>
        </div>
      </div>

      <!-- Members Grid -->
      <div class="members-grid">
        <div class="member-card" *ngFor="let member of members">
          <div class="member-card-header">
            <div class="avatar-lg" [style.background]="member.color">{{ member.initials }}</div>
            <div class="member-info">
              <div class="member-name">{{ member.name }}</div>
              <div class="member-role">{{ member.role }}</div>
            </div>
          </div>

          <div class="member-stats">
            <div class="stat-block">
              <div class="stat-label">CURRENT</div>
              <div class="stat-num">{{ member.current }}</div>
            </div>
            <div class="stat-block">
              <div class="stat-label">BLOCKED</div>
              <div class="stat-num" [class.blocked-red]="member.blocked > 0">{{ member.blocked }}</div>
            </div>
            <div class="stat-block">
              <div class="stat-label">DONE TODAY</div>
              <div class="stat-num text-success">{{ member.doneToday }}</div>
            </div>
          </div>
        </div>

        <!-- Empty State Graphic -->
        <div *ngIf="members.length === 0" class="no-members-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 00-2-2H8a4 4 0 00-2 2v2M12 11a4 4 0 100-8 4 4 0 000 8z"></path>
          </svg>
          <p class="no-members-title">No team activity found for this channel</p>
          <p class="no-members-desc">Select "All Channels" or choose another channel from the dropdown above.</p>
        </div>
      </div>

      <!-- Weekly Activity Chart -->
      <div class="weekly-analytics-container" *ngIf="weeklyActivity.length > 0">
        <div class="weekly-analytics-header">
          <div>
            <h3 class="weekly-title">Weekly Task Distribution (Last 7 Days)</h3>
            <p class="weekly-subtitle">Proportional breakdown of daily workloads.</p>
          </div>
          <div class="weekly-legend">
            <span class="legend-item"><span class="dot bg-current"></span> In Progress</span>
            <span class="legend-item"><span class="dot bg-blocked"></span> Blocked</span>
            <span class="legend-item"><span class="dot bg-done"></span> Completed</span>
          </div>
        </div>

        <div class="weekly-chart-body">
          <div class="weekly-bar-column" *ngFor="let day of weeklyActivity">
            <div
              class="weekly-stacked-wrapper"
              [title]="day.dayName + ' Breakdown: In Progress ' + getDayPercentage(day, 'current') + '%, Blocked ' + getDayPercentage(day, 'blocked') + '%, Completed ' + getDayPercentage(day, 'completed') + '%'"
            >
              <div class="stack-segment bg-done" [style.height.%]="getDayPercentageNumber(day, 'completed')">
                <span class="segment-label" *ngIf="getDayPercentageNumber(day, 'completed') >= 14">
                  {{ getDayPercentage(day, 'completed') }}%
                </span>
              </div>
              <div class="stack-segment bg-blocked" [style.height.%]="getDayPercentageNumber(day, 'blocked')">
                <span class="segment-label" *ngIf="getDayPercentageNumber(day, 'blocked') >= 14">
                  {{ getDayPercentage(day, 'blocked') }}%
                </span>
              </div>
              <div class="stack-segment bg-current" [style.height.%]="getDayPercentageNumber(day, 'current')">
                <span class="segment-label" *ngIf="getDayPercentageNumber(day, 'current') >= 14">
                  {{ getDayPercentage(day, 'current') }}%
                </span>
              </div>
            </div>
            <span class="weekly-bar-label">{{ day.dayName }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .team-body {
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .team-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .squad-title {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px;
    }
    .squad-subtitle {
      font-size: 12.5px;
      color: #64748b;
      margin: 0;
    }
    .select-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .select-icon {
      position: absolute;
      left: 12px;
      width: 14px;
      height: 14px;
      color: #64748b;
      pointer-events: none;
    }
    .team-filter-select {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 14px 8px 34px;
      font-size: 13px;
      color: #334155;
      background: white;
      cursor: pointer;
      outline: none;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      transition: all 0.2s ease;
    }
    .team-filter-select:hover {
      border-color: #cbd5e1;
    }
    .members-grid {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .member-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      width: 260px;
      min-width: 240px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .member-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 12px -2px rgba(0, 0, 0, 0.05);
    }
    .member-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }
    .avatar-lg {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      color: white;
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .member-name {
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
    }
    .member-role {
      font-size: 11.5px;
      color: #64748b;
      margin-top: 2px;
    }
    .member-stats {
      display: flex;
      gap: 8px;
      background: #f8fafc;
      padding: 10px;
      border-radius: 8px;
      border: 1px solid #f1f5f9;
    }
    .stat-block {
      flex: 1;
      text-align: center;
    }
    .stat-label {
      font-size: 9.5px;
      color: #64748b;
      font-weight: 700;
      letter-spacing: 0.4px;
      margin-bottom: 2px;
    }
    .stat-num {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }
    .stat-num.blocked-red { color: #dc2626; }
    .text-success { color: #16a34a; }

    .weekly-analytics-container {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }
    .weekly-analytics-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .weekly-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px;
    }
    .weekly-subtitle {
      font-size: 12px;
      color: #64748b;
      margin: 0;
    }
    .weekly-legend {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: #475569;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .weekly-chart-body {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      height: 200px;
      padding: 0 20px 10px 20px;
      border-bottom: 2px solid #f1f5f9;
    }
    .weekly-bar-column {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      height: 100%;
      justify-content: flex-end;
    }
    .weekly-stacked-wrapper {
      width: 44px;
      height: 160px;
      display: flex;
      flex-direction: column-reverse;
      background: #f8fafc;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .stack-segment {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: height 0.4s ease;
      overflow: hidden;
    }
    .segment-label {
      font-size: 9px;
      font-weight: 700;
      color: white;
    }
    .bg-current { background-color: #6366f1; }
    .bg-blocked { background-color: #ef4444; }
    .bg-done { background-color: #10b981; }

    .weekly-bar-label {
      font-size: 11.5px;
      color: #64748b;
      margin-top: 8px;
      font-weight: 600;
    }
    .no-members-card {
      width: 100%;
      text-align: center;
      padding: 48px;
      background: white;
      border-radius: 12px;
      border: 1px dashed #cbd5e1;
      color: #64748b;
    }
    .no-members-card svg {
      width: 40px;
      height: 40px;
      color: #cbd5e1;
      margin-bottom: 8px;
    }
    .no-members-title {
      font-weight: 600;
      color: #334155;
      margin: 0;
    }
    .no-members-desc {
      font-size: 12.5px;
      margin: 4px 0 0;
    }
  `]
})
export class TeamComponent implements OnInit {
  http = inject(HttpClient);
  dashService = inject(DashboardService);

  selectedChannelId = 'all';
  selectedChannelName = 'All Channels';
  channels: Channel[] = [];
  members: TeamMember[] = [];
  allTasks: any[] = [];
  weeklyActivity: DayActivity[] = [];

  async ngOnInit() {
    // Synchronous execution ensures channels load first so initial channel mapping works
    await this.fetchChannels();
    await this.loadTeamData();
  }

  async fetchChannels() {
    try {
      const res: any = await firstValueFrom(this.http.get('/api/slack/channels'));
      const rawChannels = res?.channels || (Array.isArray(res) ? res : []);
      this.channels = rawChannels.map((c: any) => ({
        id: c.id || c.channel_id,
        name: (c.name || c.channel_name || 'channel').replace(/^#/, '')
      }));
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  }

  async loadTeamData() {
    try {
      const tasks: any = (await firstValueFrom(this.http.get('/api/tasks'))) || [];
      this.allTasks = Array.isArray(tasks) ? tasks : [];
      this.processTasksIntoMembers();
    } catch (err) {
      console.error('Failed to load tasks for team:', err);
    }
  }

  onChannelChange() {
    if (this.selectedChannelId === 'all') {
      this.selectedChannelName = 'All Channels';
    } else {
      const found = this.channels.find(c => c.id === this.selectedChannelId);
      this.selectedChannelName = found ? `#${found.name}` : 'Channel';
    }
    this.processTasksIntoMembers();
  }

  private extractStringName(input: any): string {
    if (!input) return 'Unassigned';
    if (typeof input === 'string') return input.trim();
    if (typeof input === 'object') {
      return (input.name || input.display_name || input.real_name || 'Unassigned').trim();
    }
    return String(input).trim();
  }

  processTasksIntoMembers() {
    const memberMap = new Map<string, { current: number; blocked: number; doneToday: number; role: string }>();
    const colorPalette = ['#f59e0b', '#ef4444', '#10b981', '#6366f1', '#8b5cf6', '#3b82f6'];
    let colorIndex = 0;

    const rawSearchName = this.selectedChannelName.replace(/^#/, '');

    // Filter tasks accurately across all channel fields
    const filteredTasks = this.selectedChannelId === 'all'
      ? this.allTasks
      : this.allTasks.filter(t => {
          const chanId = t.channel_id || t.slack_channel_id;
          const chanName = (t.channel || t.channel_name || '').replace(/^#/, '');
          return chanId === this.selectedChannelId || chanName === rawSearchName;
        });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyDataMap = new Map<string, { current: number; blocked: number; completed: number; total: number }>();

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = dayNames[d.getDay()];
      weeklyDataMap.set(label, { current: 0, blocked: 0, completed: 0, total: 0 });
    }

    for (const task of filteredTasks) {
      const rawAssignee = task.assigned_to?.name || task.assigned_to || task.owner?.name || task.owner || task.assignee;
      const assigneeName = this.extractStringName(rawAssignee);

      if (!memberMap.has(assigneeName)) {
        memberMap.set(assigneeName, {
          current: 0,
          blocked: 0,
          doneToday: 0,
          role: (typeof task.assigned_to === 'object' && task.assigned_to?.role) ? task.assigned_to.role : 'Developer'
        });
      }

      const data = memberMap.get(assigneeName)!;
      const status = (task.status || '').toLowerCase();
      const hasBlockedReason = !!task.blocked_reason || !!task.block_reason_pending;

      const taskDate = new Date(task.updated_time || task.updatedAt || task.created_at || Date.now());
      const dayLabel = dayNames[taskDate.getDay()];
      const dayStats = weeklyDataMap.get(dayLabel);

      if (hasBlockedReason || status.includes('block')) {
        data.blocked++;
        if (dayStats) { dayStats.blocked++; dayStats.total++; }
      } else if (status === 'done' || status === 'completed') {
        const today = new Date();
        if (taskDate.toDateString() === today.toDateString()) {
          data.doneToday++;
        }
        if (dayStats) { dayStats.completed++; dayStats.total++; }
      } else {
        data.current++;
        if (dayStats) { dayStats.current++; dayStats.total++; }
      }
    }

    this.members = Array.from(memberMap.entries()).map(([name, stats]) => {
      const nameParts = name.trim().split(/\s+/);
      const initials = nameParts.length > 1
        ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
        : name.substring(0, 2).toUpperCase();

      return {
        name,
        role: stats.role,
        initials: initials || 'UN',
        color: colorPalette[colorIndex++ % colorPalette.length],
        current: stats.current,
        blocked: stats.blocked,
        doneToday: stats.doneToday
      };
    });

    this.weeklyActivity = Array.from(weeklyDataMap.entries()).map(([dayName, stats]) => ({
      dayName,
      current: stats.current,
      blocked: stats.blocked,
      completed: stats.completed
    }));
  }

  getDayPercentageNumber(day: DayActivity, type: 'current' | 'blocked' | 'completed'): number {
    const total = day.current + day.blocked + day.completed;
    if (total === 0) return 0;
    if (type === 'current') return Math.round((day.current / total) * 100);
    if (type === 'blocked') return Math.round((day.blocked / total) * 100);
    return Math.round((day.completed / total) * 100);
  }

  getDayPercentage(day: DayActivity, type: 'current' | 'blocked' | 'completed'): number {
    return this.getDayPercentageNumber(day, type);
  }
}