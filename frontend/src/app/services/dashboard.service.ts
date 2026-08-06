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
  date?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
}

function getTodayStr(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  readonly selectedDate = signal<string>(getTodayStr());
  readonly channels = signal<SlackChannel[]>([]);

  constructor() {
    const storedChannel = localStorage.getItem('active_channel_id');
    if (storedChannel) {
      this.activeChannelId.set(storedChannel);
      this.selectedChannel.set(storedChannel);
    }
    const storedDate = localStorage.getItem('selected_date');
    if (storedDate) {
      this.selectedDate.set(storedDate);
    }
    this.loadChannels();
  }

  setSelectedDate(date: string): void {
    this.selectedDate.set(date);
    if (date) {
      localStorage.setItem('selected_date', date);
    } else {
      localStorage.removeItem('selected_date');
    }
    this.load();
  }

  setSelectedChannel(channel: string | null): void {
    this.setChannel(channel);
  }

  getFilteredUrl(path: string): string {
    const baseUrl = `${environment.apiUrl}${path.startsWith('/') ? path : '/' + path}`;
    const channel = this.selectedChannel();
    const date = this.selectedDate();
    const parts: string[] = [];

    if (date) parts.push(`date=${encodeURIComponent(date)}`);
    if (channel && channel !== 'all') parts.push(`channel=${encodeURIComponent(channel)}`);

    if (parts.length === 0) return baseUrl;
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}${parts.join('&')}`;
  }

  /**
   * Modified to run the pipeline extraction when a specific channel is selected,
   * matching the exact same behavior as the Integrations page.
   */
  async setChannel(channel: string | null): Promise<void> {
    const cleanChan = channel === 'all' ? null : channel;
    this.selectedChannel.set(cleanChan);
    this.setActiveChannel(cleanChan);

    if (cleanChan) {
      try {
        this.loading.set(true);
        // Automatically run the pipeline extraction for this specific channel
        const result: any = await firstValueFrom(
          this.http.post(`${environment.apiUrl}/slack/pipeline/${encodeURIComponent(cleanChan)}`, {
            channel_id: cleanChan,
            fetch_all: true,
            all: true,
            limit: 200
          })
        );
        if (result?.dashboard) {
          this.data.set(result.dashboard);
          return;
        }
      } catch (err) {
        console.error('Failed to auto-run pipeline on channel selection, falling back to standard load:', err);
      } finally {
        this.loading.set(false);
      }
    }

    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const date = this.selectedDate();
      const channel = this.activeChannelId();
      const url = date
        ? `${environment.apiUrl}/dashboard/for-date?date=${encodeURIComponent(date)}${channel && channel !== 'all' ? `&channel=${encodeURIComponent(channel)}` : ''}`
        : `${environment.apiUrl}/dashboard${channel && channel !== 'all' ? `?channel=${encodeURIComponent(channel)}` : ''}`;
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
    this.load();
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

    this.socket.on('dashboard:update', (payload: any) => {
      if (payload?.action === 'SLACK_SYNC') return;
      this.load();
    });
  }

  async loadChannels(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ channels: SlackChannel[] }>(
          `${environment.apiUrl}/slack/channels`
        )
      );

      const channels = response.channels ?? [];
      this.channels.set(channels);

      const current = this.activeChannelId();
      if (current && !channels.some(c => c.id === current)) {
        this.clearActiveChannel();
      }
    } catch (err) {
      console.error('Failed to load Slack channels', err);
      this.channels.set([]);
    }
  }

  disconnectLive(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.live.set(false);
  }

  /**
   * 🟢 Global database search method.
   * Sends a search query request directly to the backend database search route.
   */
  async searchDatabase(query: string): Promise<any> {
    try {
      if (!query || !query.trim()) return null;
      const url = `${environment.apiUrl}/search?q=${encodeURIComponent(query.trim())}`;
      return await firstValueFrom(this.http.get<any>(url));
    } catch (err) {
      console.error('Failed to execute global database search:', err);
      return null;
    }
  }
}
