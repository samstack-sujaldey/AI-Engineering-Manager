import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';

interface StandupEntry {
  id: number;
  source: string;
  date: string;
  time: string;
  status: 'Completed' | 'Failed';
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
  template: `
    <app-page-header title="Stand-up Summary" searchPlaceholder="Search summaries..."></app-page-header>

    <div class="standup-body">
      <div class="standup-layout">
        <!-- Left Panel: Recent Stand-ups -->
        <div class="recent-panel">
          <div class="panel-header">
            <span class="panel-title">Recent Stand-ups</span>
            <button class="paste-new-btn">+ Paste New</button>
          </div>
          <div class="standup-list">
            <div
              class="standup-item"
              *ngFor="let entry of standupEntries"
              [class.selected]="entry.isSelected"
              (click)="selectEntry(entry)"
            >
              <div class="source-badge">{{ entry.source }}</div>
              <div class="entry-datetime">{{ entry.date }} · {{ entry.time }}</div>
              <div class="entry-status" [ngClass]="entry.status.toLowerCase()">{{ entry.status }}</div>
            </div>
          </div>
        </div>

        <!-- Right Panel: Extracted Tasks -->
        <div class="detail-panel" *ngIf="selectedEntry">
          <div class="extracted-header">
            <span class="section-title">Extracted Tasks</span>
            <span class="task-count">{{ extractedTasks.length }} task(s)</span>
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
              <tr *ngFor="let task of extractedTasks">
                <td>{{ task.name }}</td>
                <td>{{ task.assignedTo }}</td>
                <td><span class="priority-badge low">{{ task.priority }}</span></td>
                <td><span class="processing-badge">{{ task.status }}</span></td>
              </tr>
            </tbody>
          </table>

          <div class="original-message-section">
            <div class="om-header">
              <span class="section-title">Original Message</span>
              <span class="submitted-by">Submitted by sujal dey</span>
            </div>
            <div class="original-message-box">
              working on categorization parser service
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
export class StandupSummaryComponent {
  selectedEntry: StandupEntry | null = null;

  standupEntries: StandupEntry[] = [
    { id: 1, source: 'Slack', date: 'Jul 15, 2026', time: '1:02 PM', status: 'Completed', isSelected: true },
    { id: 2, source: 'Slack', date: 'Jul 15, 2026', time: '10:27 AM', status: 'Failed' },
    { id: 3, source: 'Slack', date: 'Jul 15, 2026', time: '10:27 AM', status: 'Failed' },
    { id: 4, source: 'Slack', date: 'Jul 15, 2026', time: '10:27 AM', status: 'Failed' },
    { id: 5, source: 'Slack', date: 'Jul 15, 2026', time: '10:27 AM', status: 'Failed' },
    { id: 6, source: 'Slack', date: 'Jul 15, 2026', time: '10:27 AM', status: 'Failed' },
    { id: 7, source: 'Slack', date: 'Jul 15, 2026', time: '10:27 AM', status: 'Completed' },
  ];

  extractedTasks: ExtractedTask[] = [
    { name: 'Work on categorization parser service', assignedTo: 'sujal dey', priority: 'Low', status: 'PROCESSING' }
  ];

  constructor() {
    this.selectedEntry = this.standupEntries[0];
  }

  selectEntry(entry: StandupEntry) {
    this.standupEntries.forEach(e => e.isSelected = false);
    entry.isSelected = true;
    this.selectedEntry = entry;
  }
}
