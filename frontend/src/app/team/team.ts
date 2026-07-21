import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DashboardService } from '../services/dashboard.service';

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
  members: number;
  status: string;
}

interface DayActivity {
  dayName: string;
  current: number;
  blocked: number;
  completed: number;
}

@Component({
  selector: 'app-team',
  imports: [CommonModule, PageHeaderComponent, FormsModule],
  template: `
    <app-page-header title="Team" searchPlaceholder="Find a team member..."></app-page-header>

    <div class="team-body">
      <div class="team-section-header">
        <div>
          <h2 class="squad-title">{{ selectedChannelName }} Team</h2>
          <p class="squad-subtitle">Channel-specific workload and task breakdown overview.</p>
        </div>
        <select class="team-filter-select" [(ngModel)]="selectedChannelId" (change)="onChannelChange()">
          <option value="all">All Channels</option>
          <option *ngFor="let ch of channels" [value]="ch.id">{{ ch.name }}</option>
        </select>
      </div>

      <!-- Members Grid (Cleaned: removed individual bar charts underneath) -->
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

        <div *ngIf="members.length === 0" class="no-members">
          No team members or tasks found for this channel. Try running a pipeline sync from the Integrations page!
        </div>
      </div>

      <!-- Weekly Activity Stacked Bar Graph Section with Percentages -->
      <div class="weekly-analytics-container" *ngIf="weeklyActivity.length > 0">
        <div class="weekly-analytics-header">
          <div>
            <h3 class="weekly-title">Weekly Task Progress & Breakdown (Last 7 Days)</h3>
            <p class="weekly-subtitle">Dynamic weekly tracking with segment percentage distribution.</p>
          </div>
          <div class="weekly-legend">
            <span class="legend-item"><span class="dot bg-current"></span> In Progress</span>
            <span class="legend-item"><span class="dot bg-blocked"></span> Blocked</span>
            <span class="legend-item"><span class="dot bg-done"></span> Completed</span>
          </div>
        </div>

        <div class="weekly-chart-body">
          <div class="weekly-bar-column" *ngFor="let day of weeklyActivity">
            <div class="weekly-stacked-wrapper" [title]="day.dayName + ' - In Progress: ' + day.current + ' (' + getDayPercentage(day, 'current') + '%), Blocked: ' + day.blocked + ' (' + getDayPercentage(day, 'blocked') + '%), Completed: ' + day.completed + ' (' + getDayPercentage(day, 'completed') + '%)'">
              
              <!-- Stacked percentage bars with inner text labels if height is sufficient -->
              <div class="stack-segment bg-done" [style.height.%]="getDayPercentageNumber(day, 'completed')">
                <span class="segment-label" *ngIf="getDayPercentageNumber(day, 'completed') >= 12">
                  {{ getDayPercentage(day, 'completed') }}%
                </span>
              </div>
              <div class="stack-segment bg-blocked" [style.height.%]="getDayPercentageNumber(day, 'blocked')">
                <span class="segment-label" *ngIf="getDayPercentageNumber(day, 'blocked') >= 12">
                  {{ getDayPercentage(day, 'blocked') }}%
                </span>
              </div>
              <div class="stack-segment bg-current" [style.height.%]="getDayPercentageNumber(day, 'current')">
                <span class="segment-label" *ngIf="getDayPercentageNumber(day, 'current') >= 12">
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
      align-items: flex-start;
      justify-content: space-between;
    }

    .squad-title {
      font-size: 17px;
      font-weight: 700;
      color: #1a1a2e;
      margin: 0 0 4px;
    }

    .squad-subtitle {
      font-size: 12.5px;
      color: #888;
      margin: 0;
    }

    .team-filter-select {
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 13px;
      color: #333;
      background: white;
      cursor: pointer;
      outline: none;
    }

    .members-grid {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .member-card {
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      padding: 20px;
      width: 260px;
      min-width: 240px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }

    .member-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }

    .avatar-lg {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      color: white;
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .member-name {
      font-size: 13.5px;
      font-weight: 600;
      color: #1a1a2e;
    }

    .member-role {
      font-size: 11.5px;
      color: #888;
      margin-top: 2px;
    }

    .member-stats {
      display: flex;
      gap: 12px;
      background: #f8f9fa;
      padding: 10px;
      border-radius: 6px;
    }

    .stat-block {
      flex: 1;
      text-align: center;
    }

    .stat-label {
      font-size: 9.5px;
      color: #777;
      font-weight: 600;
      letter-spacing: 0.4px;
      margin-bottom: 3px;
    }

    .stat-num {
      font-size: 16px;
      font-weight: 700;
      color: #1a1a2e;
    }

    .stat-num.blocked-red { color: #e53e3e; }
    .text-success { color: #27ae60; }

    /* Weekly Analytics Stacked Bar Graph Styles */
    .weekly-analytics-container {
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 8px;
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
      color: #1a1a2e;
      margin: 0 0 4px;
    }

    .weekly-subtitle {
      font-size: 12px;
      color: #888;
      margin: 0;
    }

    .weekly-legend {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: #555;
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
      border-bottom: 2px solid #f0f2f5;
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
      width: 48px;
      height: 160px;
      display: flex;
      flex-direction: column-reverse; /* Stacks upwards from bottom */
      background: #f8f9fa;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #edf2f7;
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
      font-size: 9.5px;
      font-weight: 700;
      color: white;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      white-space: nowrap;
    }

    .bg-current { background-color: #5b4fcf; }
    .bg-blocked { background-color: #e53e3e; }
    .bg-done { background-color: #27ae60; }

    .weekly-bar-label {
      font-size: 11.5px;
      color: #6b7280;
      margin-top: 8px;
      font-weight: 500;
    }

    .no-members {
      width: 100%;
      text-align: center;
      padding: 40px;
      color: #888;
      background: white;
      border-radius: 8px;
      border: 1px dashed #ddd;
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

  ngOnInit() {
    this.fetchChannels();
    this.loadTeamData();
  }

  async fetchChannels() {
    try {
      const res: any = await this.http.get('/api/slack/channels').toPromise();
      if (res && res.channels) {
        this.channels = res.channels;
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  }

  async loadTeamData() {
    try {
      const tasks: any = await this.http.get('/api/tasks').toPromise() || [];
      this.allTasks = tasks;
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
      this.selectedChannelName = found ? found.name : 'Channel';
    }
    this.processTasksIntoMembers();
  }

  processTasksIntoMembers() {
    const memberMap = new Map<string, { current: number; blocked: number; doneToday: number; role: string }>();
    const colorPalette = ['#e07b39', '#e05050', '#1abaab', '#5b4fcf', '#27ae60', '#3b82f6'];
    let colorIndex = 0;

    // Filter tasks based on selected channel dropdown
    const filteredTasks = this.selectedChannelId === 'all' 
      ? this.allTasks 
      : this.allTasks.filter(t => 
          t.channel_id === this.selectedChannelId || 
          t.channel === this.selectedChannelName ||
          t.slack_channel_id === this.selectedChannelId
        );

    // Setup weekly tracking for the last 7 days
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyDataMap = new Map<string, { current: number; blocked: number; completed: number; total: number }>();

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = dayNames[d.getDay()];
      weeklyDataMap.set(label, { current: 0, blocked: 0, completed: 0, total: 0 });
    }

    for (const task of filteredTasks) {
      const assigneeName = task.assigned_to?.name || task.owner || task.assignee || 'Unassigned';
      
      if (!memberMap.has(assigneeName)) {
        memberMap.set(assigneeName, {
          current: 0,
          blocked: 0,
          doneToday: 0,
          role: task.assigned_to?.role || 'Developer'
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

    // Build members array
    this.members = Array.from(memberMap.entries()).map(([name, stats]) => {
      const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

      const memberObj: TeamMember = {
        name,
        role: stats.role,
        initials: initials || 'UN',
        color: colorPalette[colorIndex % colorPalette.length],
        current: stats.current,
        blocked: stats.blocked,
        doneToday: stats.doneToday
      };
      colorIndex++;
      return memberObj;
    });

    // Build weekly activity data array for percentage-based stacked bars
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
