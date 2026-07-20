import { Component, OnInit, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { DashboardService } from '../services/dashboard.service';

interface StandupEntry {
  id: number;
  source: string;
  date: string;
  time: string;
  status: 'Completed' | 'Failed';
  content: string;
  isSelected?: boolean;
}

interface ExtractedTask {
  name: string;
  assignedTo: string;
  priority: string;
  status: string;
}

@Component({
  selector: 'app-standup-summary',
  imports: [CommonModule, PageHeaderComponent],
  providers: [DashboardService],
  template: `
    <app-page-header title="Stand-up Summary" searchPlaceholder="Search summaries..."></app-page-header>

    <div class="standup-body">
      <div class="standup-layout">
        <div class="recent-panel">
          <div class="panel-header">
            <span class="panel-title">Recent Stand-ups</span>
            <button class="paste-new-btn" (click)="dashService.load()">Refresh</button>
          </div>
          <div class="standup-list">
            <div
              class="standup-item"
              *ngFor="let entry of entries()"
              [class.selected]="entry.isSelected"
              (click)="selectEntry(entry)"
            >
              <div class="source-badge">{{ entry.source }}</div>
              <div class="entry-datetime">{{ entry.date }} · {{ entry.time }}</div>
              <div class="entry-status" [ngClass]="entry.status.toLowerCase()">{{ entry.status }}</div>
            </div>
            <div *ngIf="entries().length === 0" class="empty-text" style="padding: 20px;">
              No stand-up messages synced yet.
            </div>
          </div>
        </div>

        <div class="detail-panel" *ngIf="selectedEntry">
          <div class="extracted-header">
            <span class="section-title">Extracted Tasks</span>
            <span class="task-count">{{ extractedTasks().length }} task(s)</span>
          </div>
          <table class="extracted-table">
            <thead>
              <tr>
                <th>TASK NAME</th>
                <th>ASSIGNED</th>
                <th>PRIORITY</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let task of extractedTasks()">
                <td>{{ task.name }}</td>
                <td>{{ task.assignedTo }}</td>
                <td><span class="priority-badge low">{{ task.priority }}</span></td>
                <td><span class="processing-badge">{{ task.status }}</span></td>
              </tr>
              <tr *ngIf="extractedTasks().length === 0">
                <td colspan="4" class="empty-text">No tasks extracted.</td>
              </tr>
            </tbody>
          </table>

          <div class="original-message-section">
            <div class="om-header">
              <span class="section-title">Original Message</span>
            </div>
            <div class="original-message-box">
              {{ selectedEntry.content }}
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .standup-body {
      padding: 24px 32px;
    }

    .standup-layout {
      display: flex;
      gap: 0;
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      overflow: hidden;
      min-height: 600px;
    }

    /* Left panel */
    .recent-panel {
      width: 280px;
      min-width: 280px;
      border-right: 1px solid #e9ecef;
      display: flex;
      flex-direction: column;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 20px;
      border-bottom: 1px solid #f0f0f0;
    }

    .panel-title {
      font-size: 14px;
      font-weight: 600;
      color: #1a1a2e;
    }

    .paste-new-btn {
      background: transparent;
      border: none;
      color: #5b4fcf;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      padding: 0;
    }

    .standup-list {
      flex: 1;
      overflow-y: auto;
    }

    .standup-item {
      padding: 14px 20px;
      border-bottom: 1px solid #f5f5f5;
      cursor: pointer;
      transition: background 0.1s;
    }

    .standup-item:hover { background: #fafafa; }

    .standup-item.selected {
      background: #f5f3ff;
      border-left: 3px solid #5b4fcf;
      padding-left: 17px;
    }

    .source-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      color: #5b4fcf;
      margin-bottom: 4px;
    }

    .entry-datetime {
      font-size: 12px;
      color: #666;
      margin-bottom: 4px;
    }

    .entry-status {
      font-size: 12px;
      font-weight: 600;
    }

    .entry-status.completed { color: #27ae60; }
    .entry-status.failed { color: #e53e3e; }

    /* Right panel */
    .detail-panel {
      flex: 1;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .extracted-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: #1a1a2e;
    }

    .task-count {
      font-size: 12.5px;
      color: #888;
    }

    .extracted-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #f0f0f0;
      border-radius: 6px;
      overflow: hidden;
    }

    .extracted-table th {
      text-align: left;
      font-size: 11px;
      color: #888;
      font-weight: 600;
      letter-spacing: 0.4px;
      padding: 12px 16px;
      background: #fafafa;
      border-bottom: 1px solid #f0f0f0;
    }

    .extracted-table td {
      padding: 14px 16px;
      font-size: 13.5px;
      color: #333;
    }

    .priority-badge {
      background: #f5f5f5;
      color: #666;
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 4px;
    }

    .processing-badge {
      background: #e8f4fd;
      color: #2980b9;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 4px;
    }

    /* Original Message */
    .om-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .submitted-by {
      font-size: 12px;
      color: #888;
    }

    .original-message-box {
      border: 1px solid #f0f0f0;
      border-radius: 6px;
      padding: 16px;
      font-size: 13.5px;
      color: #333;
      background: #fafafa;
    }
  `]
})
export class StandupSummaryComponent implements OnInit {
  dashService = inject(DashboardService);
  selectedEntry: StandupEntry | null = null;

  constructor() {
    this.dashService.disableLive = true;
  }

  ngOnInit() {
    this.dashService.load();
  }

  // Recent stand-ups derived from the MongoDB-backed discussion timeline.
  readonly entries = computed<StandupEntry[]>(() => {
    const discs = this.dashService.data()?.discussion_timeline || [];
    const list = discs.slice(0, 20).map((d: any, idx: number) => {
      const ts = d.timestamp ? new Date(d.timestamp) : new Date();
      return {
        id: idx + 1,
        source: 'Slack',
        date: ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        status: 'Completed' as const,
        content: d.content || '',
        isSelected: false,
      };
    });
    if (list.length) list[0].isSelected = true;
    if (!this.selectedEntry && list.length) this.selectedEntry = list[0];
    return list;
  });

  // Extracted tasks derived from the MongoDB-backed tasks list.
  readonly extractedTasks = computed<ExtractedTask[]>(() => {
    const tasks = this.dashService.data()?.tasks || [];
    return tasks
      .filter((t: any) => this.selectedEntry && t.title)
      .map((t: any) => ({
        name: t.title,
        assignedTo:
          t.assigned_to?.display_name ||
          t.assigned_to?.real_name ||
          t.assigned_to?.name ||
          (t.assigned_to?.email ? t.assigned_to.email.split('@')[0] : 'Unassigned'),
        priority: (t.priority || 'MEDIUM').toLowerCase(),
        status: (t.status || 'TODO').toUpperCase(),
      }));
  });

  selectEntry(entry: StandupEntry) {
    this.entries().forEach(e => (e.isSelected = false));
    entry.isSelected = true;
    this.selectedEntry = entry;
  }
}
