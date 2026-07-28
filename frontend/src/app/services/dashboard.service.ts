import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';

export interface DashboardData {
  tasks: any[];
  issues: any[];
  overdue_tasks: any[];
  blocked_tasks: any[];
  urgent_tasks: any[];
  waiting_due_date: any[];
  waiting_block_reason: any[];
  waiting_acknowledgement: any[];
  discussion_timeline: any[];
  dependencies: any[];
  recent_activity: any[];
  task_progress: Record<string, number>;
  issue_progress: Record<string, number>;
  owner_workload: any[];
  pending_notifications: any[];
  generated_at: string;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private socket: Socket | null = null;

  readonly data = signal<DashboardData | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly live = signal(false);
  readonly syncInfo = signal<string | null>(null);
  readonly activeChannelId = signal<string | null>(null);
  readonly selectedChannel = signal<string | null>(null);

  constructor() {
    const stored = localStorage.getItem('active_channel_id');
    if (stored) {
      this.activeChannelId.set(stored);
      this.selectedChannel.set(stored);
    }
  }

  // 🟢 Helper used by TeamComponent and other views to format channel-filtered URLs
  getFilteredUrl(path: string): string {
    const baseUrl = `${environment.apiUrl}${path.startsWith('/') ? path : '/' + path}`;
    const channel = this.activeChannelId();
    if (!channel || channel === 'all') {
      return baseUrl;
    }
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}channel=${encodeURIComponent(channel)}`;
  }

  // 🟢 Synchronize both channel signals
  setChannel(channel: string | null): void {
    const cleanChan = channel === 'all' ? null : channel;
    this.selectedChannel.set(cleanChan);
    this.setActiveChannel(cleanChan);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const channel = this.activeChannelId();
      const url = channel && channel !== 'all'
        ? `${environment.apiUrl}/dashboard?channel=${encodeURIComponent(channel)}`
        : `${environment.apiUrl}/dashboard`;
      const data = await firstValueFrom(this.http.get<DashboardData>(url));
      this.data.set(data);
    } catch (err: any) {
      this.error.set(err.message || 'Failed to load dashboard data from backend.');
    } finally {
      this.loading.set(false);
    }
  }

  setActiveChannel(channelId: string | null) {
    const cleanId = channelId === 'all' ? null : channelId;
    this.activeChannelId.set(cleanId);
    this.selectedChannel.set(cleanId);

    if (cleanId) {
      localStorage.setItem('active_channel_id', cleanId);
    } else {
      localStorage.removeItem('active_channel_id');
    }
  }

  clearActiveChannel() {
    this.activeChannelId.set(null);
    this.selectedChannel.set(null);
    localStorage.removeItem('active_channel_id');
  }

  async refresh(channels?: string[]): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.syncInfo.set(null);
    try {
      const result = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/slack/sync`, {
          channels: channels?.filter(Boolean) || [],
        }),
      );
      this.data.set(result.dashboard);
      const s = result.sync;
      const created =
        (s.created?.tasks || 0) + (s.created?.issues || 0) + (s.created?.discussions || 0);

      this.syncInfo.set(
        `Synced ${s.channels_scanned} channel(s): ${s.messages_processed} new, ${s.messages_skipped} skipped, ${created} items created.`,
      );
    } catch (err: any) {
      this.error.set(err.error?.error || 'Failed to trigger Slack sync pipeline.');
      try {
        const data = await firstValueFrom(
          this.http.get<DashboardData>(`${environment.apiUrl}/dashboard`),
        );
        this.data.set(data);
      } catch {}
    } finally {
      this.loading.set(false);
    }
  }

  connectLive(): void {
    if (this.socket) return;
    this.socket = io(environment.socketUrl, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => this.live.set(true));
    this.socket.on('disconnect', () => this.live.set(false));

    // Auto-fetch data whenever the backend processes a new message
    this.socket.on('dashboard:update', (payload: any) => {
      if (payload?.action === 'SLACK_SYNC') return;
      this.load();
    });
  }

  disconnectLive(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.live.set(false);
  }
}