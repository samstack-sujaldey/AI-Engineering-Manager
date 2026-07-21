import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { DashboardService } from '../services/dashboard.service';
import { HttpClient } from '@angular/common/http';

interface Channel {
  id: string;
  name: string;
  members: number;
  status: string;
}

interface SyncSummary {
  workspace: string;
  bot_user: string;
  channels_scanned: number;
  messages_seen: number;
  messages_processed: number;
  messages_skipped: number;
  created: { tasks: number; issues: number; discussions: number };
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
                <td class="channel-name">{{ channel.name }}</td>
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
            </tbody>
          </table>

          <div
            *ngIf="dashService.syncInfo()"
            style="margin-top: 15px; color: #27ae60; font-size: 13px;"
          >
            {{ dashService.syncInfo() }}
          </div>

          <div *ngIf="lastSyncSummary" class="pipeline-success-bar">
            <span class="green-dot"></span>
            <div>
              <strong>Pipeline completely run!</strong> Scanned {{ lastSyncSummary.channels_scanned }} channel(s), inspected <strong>{{ lastSyncSummary.messages_seen }}</strong> messages (Processed: {{ lastSyncSummary.messages_processed }}, Tasks created: {{ lastSyncSummary.created.tasks }}).
            </div>
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
        border-left: 4px solid #22c55e;
        border-radius: 4px;
        color: #166534;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: fadeIn 0.3s ease-in-out;
      }

      .green-dot {
        width: 8px;
        height: 8px;
        background-color: #22c55e;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
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

  channels: Channel[] = [];
  loadingChannelId: string | null = null;
  lastSyncSummary: SyncSummary | null = null;

  ngOnInit() {
    this.fetchSlackChannels();
  }

  async fetchSlackChannels() {
    try {
      const data: any = await this.http.get('/api/slack/channels').toPromise();
      this.channels = data || [];
    } catch (err) {
      console.error('Failed to fetch Slack channels:', err);
    }
  }

  async runPipeline(channel: Channel) {
    this.loadingChannelId = channel.id;
    try {
      const summary: any = await this.http.post(`/api/slack/pipeline/${channel.id}`, {}).toPromise();
      this.lastSyncSummary = summary;
    } catch (err) {
      console.error('Pipeline execution failed:', err);
    } finally {
      this.loadingChannelId = null;
    }
  }
}
