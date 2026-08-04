import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { DashboardService } from '../services/dashboard.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface Channel {
  id: string;
  name: string;
  members: number;
  status: string;
}

interface SyncSummary {
  workspace?: string;
  bot_user?: string;
  channels_scanned?: number;
  messages_seen?: number;
  messages_processed?: number;
  messagesProcessed?: number;
  messages_skipped?: number;
  messagesCount?: number;
  created?: { tasks: number; issues: number; discussions: number };
  tasksExtracted?: number;
  issuesExtracted?: number;
  tasks_count?: number;
  tasksCount?: number;
  issues_count?: number;
  issuesCount?: number;
  tasks?: any[];
  issues?: any[];
  messages?: any[];
  data?: {
    tasks?: any[];
    issues?: any[];
    messages?: any[];
  };
  summary?: any;
  result?: any;
  results?: any;
  [key: string]: any;
}

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent],
  template: `
    <app-page-header
      title="Integrations"
      searchPlaceholder="Search integrations..."
    ></app-page-header>

    <div class="integrations-body">
      <div class="integration-card">
        <div class="integration-header">
          <div>
            <h3 class="integration-name">Slack</h3>
            <p class="integration-desc">
              Connect a workspace so daily stand-ups posted to a channel are pulled in and parsed
              automatically.
            </p>
          </div>
        </div>

        <div class="channels-section">
          <div class="channels-header">
            <span class="channels-title">Channels</span>
            <button class="refresh-btn" (click)="fetchSlackChannels()">Refresh</button>
          </div>

          <table class="channels-table">
            <thead>
              <tr>
                <th>CHANNEL</th>
                <th>MEMBERS</th>
                <th>STATUS</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let channel of channels">
                <td class="channel-name">#{{ channel.name ? channel.name.replace('#', '') : channel.id }}</td>
                <td>{{ channel.members }}</td>
                <td class="channel-status">{{ channel.status }}</td>
                <td class="action-cell">
                  <button
                    class="run-pipeline-btn"
                    (click)="runPipeline(channel)"
                    [disabled]="loadingChannelId === channel.id"
                  >
                    {{ loadingChannelId === channel.id ? 'Syncing...' : 'Run Pipeline' }}
                  </button>
                </td>
              </tr>

              <tr *ngIf="channels.length === 0">
                <td colspan="4" style="text-align: center; color: #888; padding: 20px;">
                  No channels found. Click "Refresh" to load channels.
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Legacy / Global Sync Info -->
          <div *ngIf="dashService.syncInfo()" style="margin-top: 15px; color: #27ae60; font-size: 13px;">
            {{ dashService.syncInfo() }}
          </div>

          <!-- 🟢 Success Extraction Summary Banner -->
          <div *ngIf="lastSyncSummary" class="pipeline-success-bar">
              <span class="green-dot"></span>
              <div class="summary-text">
                <strong>Pipeline completed for {{ lastSyncedChannelName ? '#' + lastSyncedChannelName : 'channel' }}!</strong>
                <span>
                  Extracted 
                  <strong>{{ getTaskCount() }} tasks</strong> and 
                  <strong>{{ getIssueCount() }} issues</strong>. 
                  ({{ getProcessedMessagesCount() }} messages processed).
                </span>
              </div>
              <button class="close-summary-btn" (click)="lastSyncSummary = null">✕</button>
          </div>

          <!-- ⚠️ Error Banner (If API Fails) -->
          <div *ngIf="errorMessage" class="pipeline-error-bar">
              <span>⚠️ <strong>Error for #{{ lastSyncedChannelName }}:</strong> {{ errorMessage }}</span>
              <button class="close-summary-btn" (click)="errorMessage = null">✕</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .integrations-body {
        padding: 24px 32px;
      }

      .integration-card {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        overflow: hidden;
      }

      .integration-header {
        padding: 20px 24px;
        border-bottom: 1px solid #f0f0f0;
      }

      .integration-name {
        font-size: 15px;
        font-weight: 700;
        color: #1a1a2e;
        margin: 0 0 6px;
      }

      .integration-desc {
        font-size: 12.5px;
        color: #888;
        margin: 0;
        max-width: 440px;
      }

      .channels-section {
        padding: 20px 24px;
      }

      .channels-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .channels-title {
        font-size: 14px;
        font-weight: 600;
        color: #1a1a2e;
      }

      .refresh-btn {
        background: transparent;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 13px;
        color: #333;
        cursor: pointer;
      }

      .channels-table {
        width: 100%;
        border-collapse: collapse;
      }

      .channels-table th {
        text-align: left;
        font-size: 11px;
        color: #888;
        font-weight: 600;
        letter-spacing: 0.4px;
        padding: 10px 0;
        border-bottom: 1px solid #f0f0f0;
      }

      .channels-table td {
        padding: 16px 0;
        font-size: 13.5px;
        color: #333;
        border-bottom: 1px solid #f5f5f5;
      }

      .channels-table tr:last-child td {
        border-bottom: none;
      }

      .channel-name {
        font-weight: 500;
      }

      .channel-status {
        color: #555;
      }

      .action-cell {
        text-align: right;
      }

      .run-pipeline-btn {
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

      .run-pipeline-btn:hover {
        background: #4c3fb8;
      }

      .run-pipeline-btn:disabled {
        background: #a29bfe;
        cursor: not-allowed;
      }

      .pipeline-success-bar {
        margin-top: 20px;
        padding: 12px 16px;
        background-color: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-left: 4px solid #22c55e;
        border-radius: 6px;
        color: #166534;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        animation: fadeIn 0.3s ease-in-out;
      }

      .pipeline-error-bar {
        margin-top: 20px;
        padding: 12px 16px;
        background-color: #fef2f2;
        border: 1px solid #fecaca;
        border-left: 4px solid #ef4444;
        border-radius: 6px;
        color: #991b1b;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        animation: fadeIn 0.3s ease-in-out;
      }

      .summary-text {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .green-dot {
        width: 8px;
        height: 8px;
        background-color: #22c55e;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
      }

      .close-summary-btn {
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 14px;
        opacity: 0.6;
      }

      .close-summary-btn:hover {
        opacity: 1;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `,
  ],
})
export class IntegrationsComponent implements OnInit {
  http = inject(HttpClient);
  dashService = inject(DashboardService);
  cdr = inject(ChangeDetectorRef);

  channels: Channel[] = [];
  loadingChannelId: string | null = null;
  lastSyncSummary: SyncSummary | null = null;
  lastSyncedChannelName: string | null = null;
  errorMessage: string | null = null;

  ngOnInit() {
    this.fetchSlackChannels();
  }

  async fetchSlackChannels() {
    try {
      const data: any = await firstValueFrom(this.http.get('/api/slack/channels'));
      this.channels = Array.isArray(data) ? data : (data?.channels || []);
      this.cdr.detectChanges();
    } catch (err) {
      console.error('Failed to fetch Slack channels:', err);
    }
  }

  async runPipeline(channel: Channel) {
    this.loadingChannelId = channel.id;
    this.lastSyncSummary = null;
    this.errorMessage = null;

    const cleanName = channel.name ? channel.name.replace(/^#+/, '') : channel.id;
    this.lastSyncedChannelName = cleanName;

    this.cdr.detectChanges();

    try {
      const summary: any = await firstValueFrom(
        this.http.post(`/api/slack/pipeline/${encodeURIComponent(channel.id)}`, {
          channel_id: channel.id,
          channel_name: cleanName,
          fetch_all: true,
          all: true,
          limit: 200
        })
      );

      console.log('=== SLACK PIPELINE RAW RESPONSE ===', summary);

      this.lastSyncSummary = summary;
      this.dashService.setActiveChannel(channel.id);

      try {
        await this.dashService.load();
      } catch (err) {
        console.error('Failed to reload dashboard after pipeline:', err);
      }

    } catch (err: any) {
      console.error('Pipeline execution failed:', err);

      this.errorMessage =
        err?.error?.message ||
        err?.error?.error ||
        err?.message ||
        'Failed to complete sync process. Please check Slack bot permissions.';
    } finally {
      this.loadingChannelId = null;
      this.cdr.detectChanges();
    }
  }

  getTaskCount(): number {
    if (!this.lastSyncSummary) return 0;
    const s: any = this.lastSyncSummary;

    // 1. Check array length first
    const taskArray =
      s.tasks ||
      s.extracted_tasks ||
      s.parsed_tasks ||
      s.tasks_created ||
      s.data?.tasks ||
      s.data?.extracted_tasks ||
      s.result?.tasks ||
      s.results?.tasks ||
      s.summary?.tasks;

    if (Array.isArray(taskArray) && taskArray.length > 0) {
      return taskArray.length;
    }

    // 2. Fall back to numerical count properties
    return (
      s.created?.tasks ??
      s.tasksExtracted ??
      s.tasks_count ??
      s.tasksCount ??
      s.task_count ??
      s.extracted_tasks_count ??
      s.summary?.tasks ??
      s.summary?.tasks_count ??
      s.result?.tasks_count ??
      s.results?.tasks_count ??
      0
    );
  }

  getIssueCount(): number {
    if (!this.lastSyncSummary) return 0;
    const s: any = this.lastSyncSummary;

    // 1. Check array length first to ensure actual list items take precedence over summary counts
    const issueArray =
      s.issues ||
      s.extracted_issues ||
      s.parsed_issues ||
      s.issues_created ||
      s.all_issues ||
      s.data?.issues ||
      s.data?.extracted_issues ||
      s.result?.issues ||
      s.results?.issues ||
      s.summary?.issues;

    if (Array.isArray(issueArray) && issueArray.length > 0) {
      return issueArray.length;
    }

    // 2. Fall back to numerical count properties if no array is found
    return (
      s.created?.issues ??
      s.issuesExtracted ??
      s.issues_count ??
      s.issuesCount ??
      s.issue_count ??
      s.extracted_issues_count ??
      s.total_issues ??
      s.summary?.issues ??
      s.summary?.issues_count ??
      s.result?.issues_count ??
      s.results?.issues_count ??
      0
    );
  }

  getProcessedMessagesCount(): number {
    if (!this.lastSyncSummary) return 0;
    const s: any = this.lastSyncSummary;

    const msgArray =
      s.messages ||
      s.raw_messages ||
      s.slack_messages ||
      s.data?.messages ||
      s.result?.messages ||
      s.results?.messages;

    if (Array.isArray(msgArray) && msgArray.length > 0) {
      return msgArray.length;
    }

    return (
      s.messages_processed ??
      s.messagesProcessed ??
      s.messages_seen ??
      s.messagesSeen ??
      s.messages_scanned ??
      s.messagesCount ??
      s.total_messages ??
      s.messages_analyzed ??
      s.summary?.messages_processed ??
      s.summary?.total_messages ??
      s.result?.messages_processed ??
      s.results?.messages_processed ??
      0
    );
  }
}