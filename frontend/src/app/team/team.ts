import { Component, inject, OnInit, ChangeDetectorRef, effect, untracked } from '@angular/core';
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
  tasks: any[];
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

        <div class="team-controls">
          <div class="date-picker-wrapper">
            <label for="teamDate">Date:</label>
            <input
              type="date"
              id="teamDate"
              [value]="dashService.selectedDate()"
              (change)="onDateChange($event)"
              class="team-date-input"
            />
          </div>
          <div class="select-wrapper">
            <svg
              class="select-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <select
              class="team-filter-select"
              [(ngModel)]="selectedChannelId"
              (change)="onChannelChange()"
            >
              <option value="all">All Channels</option>
              <option *ngFor="let ch of channels" [value]="ch.id">#{{ ch.name }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Members Grid -->
      <div class="members-grid">
        <div
          class="member-card clickable-card"
          *ngFor="let member of members"
          (click)="openMemberModal(member)"
        >
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
              <div class="stat-num" [class.blocked-red]="member.blocked > 0">
                {{ member.blocked }}
              </div>
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
          <p class="no-members-title">No team activity found for this specific date</p>
          <p class="no-members-desc">
            Try selecting a different date or channel from the dropdown above.
          </p>
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
              [title]="
                day.dayName +
                ' Breakdown: In Progress ' +
                getDayPercentage(day, 'current') +
                '%, Blocked ' +
                getDayPercentage(day, 'blocked') +
                '%, Completed ' +
                getDayPercentage(day, 'completed') +
                '%'
              "
            >
              <div
                class="stack-segment bg-done"
                [style.height.%]="getDayPercentageNumber(day, 'completed')"
              >
                <span class="segment-label" *ngIf="getDayPercentageNumber(day, 'completed') >= 14">
                  {{ getDayPercentage(day, 'completed') }}%
                </span>
              </div>
              <div
                class="stack-segment bg-blocked"
                [style.height.%]="getDayPercentageNumber(day, 'blocked')"
              >
                <span class="segment-label" *ngIf="getDayPercentageNumber(day, 'blocked') >= 14">
                  {{ getDayPercentage(day, 'blocked') }}%
                </span>
              </div>
              <div
                class="stack-segment bg-current"
                [style.height.%]="getDayPercentageNumber(day, 'current')"
              >
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

    <!-- Member Task Details Modal -->
    <div class="modal-overlay" *ngIf="selectedMember" (click)="closeMemberModal()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-header-info">
            <div
              class="avatar-lg"
              [style.background]="selectedMember.color"
              style="width: 36px; height: 36px; font-size: 13px;"
            >
              {{ selectedMember.initials }}
            </div>
            <div>
              <h3 style="margin: 0; font-size: 18px; color: #0f172a;">
                {{ selectedMember.name }}'s Workspace
              </h3>
              <p style="margin: 0; font-size: 13px; color: #64748b;">
                Task activity for selected date
              </p>
            </div>
          </div>
          <button class="close-btn" (click)="closeMemberModal()">&times;</button>
        </div>

        <div class="modal-body">
          <div *ngIf="selectedMember.tasks.length === 0" class="no-tasks-msg">
            No tasks found in the database for this member on this date.
          </div>

          <div class="task-list" *ngIf="selectedMember.tasks.length > 0">
            <div class="task-detail-card" *ngFor="let task of selectedMember.tasks">
              <div class="task-header-row">
                <div class="task-title-main">{{ task.title || 'Untitled Task' }}</div>
                <div class="task-badges">
                  <span class="badge" [attr.data-status]="(task.status || '').toLowerCase()">
                    {{ task.status || 'TODO' }}
                  </span>
                  <span
                    class="badge badge-priority"
                    [attr.data-priority]="(task.priority || '').toLowerCase()"
                  >
                    {{ task.priority || 'MEDIUM' }}
                  </span>
                </div>
              </div>

              <div class="task-description" *ngIf="task.description">
                {{ task.description }}
              </div>

              <div
                class="task-block-reason"
                *ngIf="
                  task.blocked_reason ||
                  task.block_reason_pending ||
                  (task.status || '').toLowerCase().includes('block') ||
                  (task.status || '').toLowerCase() === 'hold'
                "
              >
                <strong>🚨 Blocker:</strong> {{ task.blocked_reason || 'Waiting for reason...' }}
              </div>

              <!-- 🟢 NEW: Added Created and Due Dates -->
              <div class="task-dates">
                <div
                  class="date-item"
                  *ngIf="task.created_time || task.created_at || task.updated_time"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <strong>Created:</strong>
                  {{
                    task.created_time || task.created_at || task.updated_time
                      | date: 'MMM d, yyyy, h:mm a'
                  }}
                </div>
                <div class="date-item" *ngIf="task.due_date">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    style="color: #f59e0b;"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <strong>Due:</strong> {{ task.due_date | date: 'MMM d, yyyy, h:mm a' }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
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
      .team-controls {
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
      .team-date-input {
        border: 1px solid #5b4fcf;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 13px;
        color: #1a1a2e;
        outline: none;
        background: #fafafd;
        cursor: pointer;
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

      /* 🟢 NEW: Styles for the date footer */
      .task-dates {
        display: flex;
        gap: 20px;
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px dashed #e2e8f0;
        font-size: 12px;
        color: #64748b;
      }
      .date-item {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .date-item svg {
        width: 14px;
        height: 14px;
        color: #94a3b8;
      }
      .date-item strong {
        color: #475569;
        font-weight: 600;
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

      .clickable-card {
        cursor: pointer;
      }

      .member-card {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 20px;
        width: 260px;
        min-width: 240px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
        transition:
          transform 0.2s ease,
          box-shadow 0.2s ease,
          border-color 0.2s ease;
      }
      .member-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 12px -2px rgba(0, 0, 0, 0.05);
        border-color: #cbd5e1;
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
      .stat-num.blocked-red {
        color: #dc2626;
      }
      .text-success {
        color: #16a34a;
      }

      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 20px;
      }
      .modal-content {
        background: white;
        border-radius: 16px;
        width: 100%;
        max-width: 650px;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        box-shadow:
          0 20px 25px -5px rgba(0, 0, 0, 0.1),
          0 10px 10px -5px rgba(0, 0, 0, 0.04);
        animation: modalSlideIn 0.3s ease-out;
      }
      @keyframes modalSlideIn {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .modal-header {
        padding: 20px 24px;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #f8fafc;
        border-radius: 16px 16px 0 0;
      }
      .modal-header-info {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        color: #64748b;
        cursor: pointer;
        padding: 4px;
        line-height: 1;
        border-radius: 4px;
      }
      .close-btn:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      .modal-body {
        padding: 24px;
        overflow-y: auto;
        flex: 1;
      }
      .no-tasks-msg {
        text-align: center;
        color: #64748b;
        padding: 40px 0;
        font-size: 14px;
      }
      .task-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .task-detail-card {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 16px;
        background: #fff;
      }
      .task-header-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 8px;
      }
      .task-title-main {
        font-size: 15px;
        font-weight: 600;
        color: #1e293b;
        line-height: 1.4;
      }
      .task-description {
        font-size: 13px;
        color: #64748b;
        margin-bottom: 12px;
        line-height: 1.5;
      }
      .task-badges {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .badge {
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .badge[data-status='blocked'],
      .badge[data-status='hold'] {
        background: #fee2e2;
        color: #b91c1c;
      }
      .badge[data-status='processing'],
      .badge[data-status='wip'] {
        background: #e0e7ff;
        color: #4338ca;
      }
      .badge[data-status='completed'],
      .badge[data-status='done'],
      .badge[data-status='resolved'] {
        background: #d1fae5;
        color: #047857;
      }
      .badge[data-status='todo'],
      .badge[data-status='open'] {
        background: #f1f5f9;
        color: #475569;
      }

      .badge-priority {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        color: #64748b;
      }
      .badge-priority[data-priority='urgent'],
      .badge-priority[data-priority='high'] {
        border-color: #fca5a5;
        color: #ef4444;
      }

      .task-block-reason {
        margin-top: 12px;
        padding: 10px 12px;
        background: #fef2f2;
        border-left: 3px solid #ef4444;
        border-radius: 0 6px 6px 0;
        font-size: 13px;
        color: #991b1b;
      }

      /* Weekly Chart Analytics */
      .weekly-analytics-container {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
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
      .bg-current {
        background-color: #6366f1;
      }
      .bg-blocked {
        background-color: #ef4444;
      }
      .bg-done {
        background-color: #10b981;
      }

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
    `,
  ],
})
export class TeamComponent implements OnInit {
  http = inject(HttpClient);
  dashService = inject(DashboardService);
  private cdr = inject(ChangeDetectorRef);

  selectedChannelId = 'all';
  selectedChannelName = 'All Channels';
  channels: Channel[] = [];
  members: TeamMember[] = [];
  allTasks: any[] = [];
  weeklyActivity: DayActivity[] = [];
  teams: any[] = [];
  private isInitialized = false;

  selectedMember: TeamMember | null = null;

  constructor() {
    effect(() => {
      const globalChannel = this.dashService.selectedChannel();
      const globalDate = this.dashService.selectedDate();

      untracked(() => {
        if (!this.isInitialized) return;
        if (!globalChannel) {
          this.selectedChannelId = 'all';
          this.selectedChannelName = 'All Channels';
        } else {
          const found = this.channels.find(
            (c) => c.id === globalChannel || c.name.toLowerCase() === globalChannel.toLowerCase(),
          );
          this.selectedChannelId = found ? found.id : globalChannel;
          this.selectedChannelName = found ? `#${found.name}` : `#${globalChannel}`;
        }
        this.loadTeamData();
      });
    });
  }

  async ngOnInit() {
    await this.fetchChannels();
    await this.loadTeamData();
    this.isInitialized = true;
  }

  openMemberModal(member: TeamMember) {
    this.selectedMember = member;
  }

  closeMemberModal() {
    this.selectedMember = null;
  }

  async fetchChannels() {
    try {
      const res: any = await firstValueFrom(this.http.get('/api/slack/channels'));
      const rawChannels = res?.channels || (Array.isArray(res) ? res : res?.data || []);

      this.channels = rawChannels.map((c: any) => ({
        id: c.id || c.channel_id,
        name: (c.name || c.channel_name || 'channel').replace(/^#/, '').trim(),
      }));
    } catch (err) {
      console.error('Failed to load channels API:', err);
    }
  }

  async loadTeamData() {
    try {
      this.updateSelectedChannelName();

      const teamsRes: any = await firstValueFrom(this.http.get('/api/teams')).catch(() => []);
      this.teams = Array.isArray(teamsRes) ? teamsRes : teamsRes?.teams || teamsRes?.data || [];

      await this.loadTasksForChannel();
    } catch (err) {
      console.error('Failed to load team data:', err);
    }
  }

  async loadTasksForChannel() {
    try {
      let url = this.dashService.getFilteredUrl('/tasks');
      // Strip the ?date filter to securely download the ENTIRE DB backlog
      url = url.replace(/([?&])date=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');

      const res: any = await firstValueFrom(this.http.get(url));
      this.allTasks = Array.isArray(res) ? res : res?.data || res?.tasks || [];

      this.processTasksIntoMembers();
    } catch (err) {
      console.error('Failed to load tasks for team workload:', err);
      this.allTasks = [];
      this.processTasksIntoMembers();
    }
  }

  onChannelChange() {
    if (this.selectedChannelId === 'all') {
      this.dashService.setChannel(null);
    } else {
      // 🟢 FIX 1: Send the strict Channel ID to the backend instead of the channel name
      this.dashService.setChannel(this.selectedChannelId);
    }

    this.updateSelectedChannelName();

    // 🟢 FIX 2: Removed this.loadTeamData() from here!
    // The dashService signal update will automatically trigger the constructor's effect to reload safely.
  }

  onDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      this.dashService.setSelectedDate(input.value);

      // 🟢 FIX 2: Removed this.loadTeamData() to prevent double-fetching race conditions
    }
  }

  private updateSelectedChannelName() {
    if (this.selectedChannelId === 'all') {
      this.selectedChannelName = 'All Channels';
    } else {
      const found = this.channels.find((c) => c.id === this.selectedChannelId);
      this.selectedChannelName = found ? `#${found.name}` : 'Channel';
    }
  }

  private resolveTeamMemberName(input: any): string {
    if (!input) return 'Unassigned';

    let raw = '';
    if (typeof input === 'string') {
      raw = input;
    } else if (typeof input === 'object') {
      raw =
        input.real_name ||
        input.display_name ||
        input.profile?.real_name ||
        input.profile?.display_name ||
        input.name ||
        input.email ||
        'Unassigned';
    } else {
      raw = String(input);
    }

    raw = raw.trim();

    if (raw.startsWith('<@') && raw.endsWith('>')) {
      raw = raw.slice(2, -1);
    }

    if (raw.includes('@') && !raw.startsWith('<')) {
      raw = raw.split('@')[0].trim();
    }

    raw = raw.replace(/[._-]+/g, ' ').trim();

    if (!raw || raw === 'Unassigned') return 'Unassigned';

    return raw
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private isBotOrAgentUser(m: any): boolean {
    if (!m) return true;

    const rawId = (m.id || m.userId || m.user_id || '').toLowerCase();
    const rawName = (
      typeof m === 'string' ? m : m.real_name || m.display_name || m.name || m.email || ''
    ).toLowerCase();

    const botKeywords = [
      'bot',
      'app',
      'github',
      'jira',
      'jirabot',
      'slackbot',
      'ai_engineering',
      'agent',
      'claude',
      'gpt',
      'assistant',
      'automation',
      'notif',
      'system',
      'aiem',
    ];

    return (
      rawId === 'uslackbot' ||
      rawId.includes('bot') ||
      rawId.includes('app') ||
      rawName === 'unknown' ||
      rawName === '' ||
      botKeywords.some((kw) => rawName.includes(kw))
    );
  }

  processTasksIntoMembers() {
    const memberMap = new Map<string, TeamMember>();
    const colorPalette = [
      '#6366f1',
      '#f59e0b',
      '#ef4444',
      '#10b981',
      '#8b5cf6',
      '#3b82f6',
      '#ec4899',
    ];
    let colorIndex = 0;

    // Load initial members from API baseline
    for (const m of this.members) {
      memberMap.set(m.name, { ...m, current: 0, blocked: 0, doneToday: 0, tasks: [] });
    }

    const selectedChanObj = this.channels.find((c) => c.id === this.selectedChannelId);
    const targetId = this.selectedChannelId;
    const targetName = selectedChanObj ? selectedChanObj.name.toLowerCase() : '';

    const filteredTasks =
      this.selectedChannelId === 'all'
        ? this.allTasks
        : this.allTasks.filter((t) => {
            const chanId =
              t.channel_id ||
              t.slack_channel_id ||
              t.channelId ||
              (typeof t.channel === 'object' ? t.channel?.id : t.channel);
            let chanName =
              typeof t.channel === 'string' ? t.channel : t.channel_name || t.channel?.name || '';
            chanName = chanName.replace(/^#/, '').trim().toLowerCase();

            return (
              (chanId && chanId === targetId) ||
              (targetName && chanName === targetName) ||
              (chanName && chanName === targetId.toLowerCase())
            );
          });

    const getEffectiveAssignee = (task: any) => {
      let rawAssignee =
        task.assigned_to?.name ||
        task.assigned_to ||
        task.owner?.name ||
        task.owner ||
        task.assignee;
      if (this.isBotOrAgentUser(rawAssignee)) {
        rawAssignee =
          task.user ||
          task.sender ||
          task.author ||
          task.created_by ||
          task.user_name ||
          task.user_id;
      }
      return rawAssignee;
    };

    // Auto-discover human team members directly from the full DB backlog
    for (const task of filteredTasks) {
      const effectiveAssignee = getEffectiveAssignee(task);
      if (this.isBotOrAgentUser(effectiveAssignee)) continue;

      const assigneeName = this.resolveTeamMemberName(effectiveAssignee);
      if (assigneeName && assigneeName !== 'Unassigned' && !memberMap.has(assigneeName)) {
        const nameParts = assigneeName.trim().split(/\s+/);
        const initials =
          nameParts.length > 1
            ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
            : assigneeName.substring(0, 2).toUpperCase();

        memberMap.set(assigneeName, {
          name: assigneeName,
          role: 'Developer',
          initials: initials || 'UN',
          color: colorPalette[colorIndex++ % colorPalette.length],
          current: 0,
          blocked: 0,
          doneToday: 0,
          tasks: [],
        });
      }
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weeklyDataMap = new Map<
      string,
      { dayName: string; current: number; blocked: number; completed: number }
    >();

    const selectedDateStr = this.dashService.selectedDate();
    const selectedDate = selectedDateStr ? new Date(selectedDateStr + 'T00:00:00') : new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - i);
      weeklyDataMap.set(d.toDateString(), {
        dayName: dayNames[d.getDay()],
        current: 0,
        blocked: 0,
        completed: 0,
      });
    }

    // Process tasks and distribute into member modals and daily counts
    for (const task of filteredTasks) {
      const effectiveAssignee = getEffectiveAssignee(task);
      if (this.isBotOrAgentUser(effectiveAssignee)) continue;

      const assigneeName = this.resolveTeamMemberName(effectiveAssignee);
      const data = memberMap.get(assigneeName);
      if (!data) continue;

      const status = (task.status || '').toLowerCase();
      const hasBlockedReason = !!task.blocked_reason || !!task.block_reason_pending;
      const isCompleted = status === 'done' || status === 'completed' || status === 'resolved';

      const taskUpdateDate = new Date(
        task.updated_time || task.updatedAt || task.created_at || Date.now(),
      );
      const taskDueDate = task.due_date ? new Date(task.due_date) : null;

      // 🟢 THE NEW STRICT DUE-DATE FILTERING LOGIC
      const isTaskRelevantForDate = (checkDate: Date) => {
        const checkStr = checkDate.toDateString();
        const updateStr = taskUpdateDate.toDateString();
        const dueStr = taskDueDate ? taskDueDate.toDateString() : null;

        // Rule 1: Task was completed exactly on this day
        if (isCompleted && updateStr === checkStr) return true;

        // Rule 2: Active task is DUE exactly on this day
        if (!isCompleted && dueStr === checkStr) return true;

        // Rule 3: Active task has NO due date, but was actively worked on (updated) this day
        if (!isCompleted && !taskDueDate && updateStr === checkStr) return true;

        return false;
      };

      // Apply to Selected Date (Cards & Modal)
      if (isTaskRelevantForDate(selectedDate)) {
        data.tasks.push(task); // ONLY feeds the modal if it belongs to this date!

        if (hasBlockedReason || status.includes('block') || status === 'hold') data.blocked++;
        else if (isCompleted) data.doneToday++;
        else data.current++;
      }

      // Apply to Weekly Chart
      for (let i = 0; i < 7; i++) {
        const loopDate = new Date(selectedDate);
        loopDate.setDate(loopDate.getDate() - i);

        if (isTaskRelevantForDate(loopDate)) {
          const dayStats = weeklyDataMap.get(loopDate.toDateString());
          if (dayStats) {
            if (hasBlockedReason || status.includes('block') || status === 'hold')
              dayStats.blocked++;
            else if (isCompleted) dayStats.completed++;
            else dayStats.current++;
          }
        }
      }
    }

    // Filter out team members completely if they did zero work on the selected date (0/0/0)
    this.members = Array.from(memberMap.values())
      .filter((m) => m.current > 0 || m.blocked > 0 || m.doneToday > 0)
      .map((m) => {
        m.tasks.sort((a, b) => {
          const aStat = (a.status || '').toLowerCase();
          const bStat = (b.status || '').toLowerCase();
          if (aStat.includes('block') && !bStat.includes('block')) return -1;
          if (!aStat.includes('block') && bStat.includes('block')) return 1;
          if (
            (aStat === 'completed' || aStat === 'resolved') &&
            bStat !== 'completed' &&
            bStat !== 'resolved'
          )
            return 1;
          if (
            aStat !== 'completed' &&
            aStat !== 'resolved' &&
            (bStat === 'completed' || bStat === 'resolved')
          )
            return -1;
          return 0;
        });
        return m;
      });

    this.weeklyActivity = Array.from(weeklyDataMap.values()).map((stats) => ({
      dayName: stats.dayName,
      current: stats.current,
      blocked: stats.blocked,
      completed: stats.completed,
    }));

    this.cdr.detectChanges();
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
