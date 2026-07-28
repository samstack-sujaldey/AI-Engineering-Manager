import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../shared/page-header';
import { DashboardService } from '../services/dashboard.service';

@Component({
  selector: 'app-standup-summary',
  standalone: true,
  imports: [CommonModule, HttpClientModule, FormsModule, PageHeaderComponent],
  template: `
    <app-page-header title="Stand-up Summary" searchPlaceholder="Search summaries..."></app-page-header>

    <div class="standup-body">
      <div class="summary-container">
        
        <!-- Top Control Bar -->
        <div class="control-header">
          <div class="header-left">
            <h2 class="summary-title">🗓 Daily Stand-up Digest</h2>
            <span class="selected-date-label">{{ formattedDateDisplay }}</span>
            <span class="last-sync-badge" *ngIf="lastSyncTime">
              Last synced: {{ lastSyncTime | date:'shortTime' }}
            </span>
          </div>

          <div class="header-right">
            <div class="calendar-picker-wrapper">
              <label for="summaryDate">Select Date:</label>
              <input
                type="date"
                id="summaryDate"
                [(ngModel)]="selectedDate"
                (change)="onDateChange()"
                class="calendar-input"
              />
            </div>
          </div>
        </div>

        <!-- Rich Card Display View -->
        <div class="single-section-view" *ngIf="!isLoading; else loadingState">
          <div class="summary-card-section">
            
            <div class="section-card-header mom-header">
              <div class="header-title-box">
                <span class="doc-icon">📋</span>
                <h3>Stand-up Minutes of Meeting (MOM)</h3>
              </div>
              <div class="badge-group">
                <span class="count-badge tasks-badge">Tasks: {{ taskCount }}</span>
                <span class="count-badge issues-badge">Issues: {{ issueCount }}</span>
              </div>
            </div>

            <div class="section-card-body" (click)="handleItemClick($event)">
              <!-- Enhanced HTML Rendered Here -->
              <div class="formatted-points mom-body-content" [innerHTML]="summaryHtml"></div>
            </div>

          </div>
        </div>

        <ng-template #loadingState>
          <div class="loading-box">
            <div class="spinner"></div>
            <span>{{ loadingMessage }}</span>
          </div>
        </ng-template>

      </div>
    </div>

    <!-- BLOCKED REASON MODAL OVERLAY -->
    <div class="modal-overlay" *ngIf="selectedBlockedTask" (click)="closeModal()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title-wrapper">
            <span class="alert-icon">🚨</span>
            <h2 class="modal-title">Blocked Task Details</h2>
          </div>
          <button class="close-btn" (click)="closeModal()">&times;</button>
        </div>

        <div class="modal-body">
          <div class="info-group">
            <h3 class="info-label">Task Title</h3>
            <p class="info-value">{{ selectedBlockedTask.title }}</p>
          </div>

          <div class="info-group">
            <h3 class="info-label">Blocker Reason</h3>
            <div class="reason-box">
              <p class="reason-text">
                {{ selectedBlockedTask.blocked_reason || 'No specific blocker reason logged. Awaiting update in Slack.' }}
              </p>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-primary" (click)="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .standup-body { padding: 24px 32px; background: #f8fafc; min-height: 100vh; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    .summary-container { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; min-height: 580px; display: flex; flex-direction: column; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    
    .control-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9; margin-bottom: 24px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .header-right { display: flex; align-items: center; gap: 16px; }
    .summary-title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; letter-spacing: -0.3px; }
    .selected-date-label { font-size: 14px; color: #475569; font-weight: 600; background: #f1f5f9; padding: 4px 12px; border-radius: 20px; }
    .last-sync-badge { font-size: 12px; color: #64748b; font-weight: 500; }
    
    .calendar-picker-wrapper { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #334155; font-weight: 500; }
    .calendar-input { border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 12px; font-size: 14px; color: #0f172a; outline: none; background: #ffffff; cursor: pointer; transition: border 0.2s; }
    .calendar-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); }
    
    .single-section-view { display: flex; flex-direction: column; flex: 1; }
    .summary-card-section { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; display: flex; flex-direction: column; overflow: hidden; flex: 1; }
    .section-card-header { padding: 16px 22px; display: flex; align-items: center; justify-content: space-between; }
    .mom-header { background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .header-title-box { display: flex; align-items: center; gap: 10px; }
    .doc-icon { font-size: 18px; }
    .section-card-header h3 { margin: 0; font-size: 16px; font-weight: 700; color: #1e293b; }
    
    .badge-group { display: flex; gap: 8px; }
    .count-badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: 0.3px; }
    .tasks-badge { background: #e0e7ff; color: #4338ca; }
    .issues-badge { background: #fee2e2; color: #991b1b; }
    
    .section-card-body { padding: 24px; font-size: 14.5px; line-height: 1.6; color: #334155; flex: 1; overflow-y: auto; max-height: 650px; }

    /* DYNAMIC UI CARD STYLES */
    .formatted-points ::ng-deep .summary-banner { background: #eff6ff; border-left: 4px solid #6366f1; padding: 14px 18px; border-radius: 6px; margin-bottom: 24px; font-size: 14px; color: #3730a3; }
    .formatted-points ::ng-deep .summary-banner strong { color: #1e1b4b; font-weight: 700; }
    
    .formatted-points ::ng-deep .member-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); overflow: hidden; transition: box-shadow 0.2s; }
    .formatted-points ::ng-deep .member-card:hover { box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    
    .formatted-points ::ng-deep .member-header { background: #f8fafc; padding: 12px 18px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; gap: 12px; }
    .formatted-points ::ng-deep .avatar-circle { width: 32px; height: 32px; border-radius: 50%; background: #6366f1; color: #ffffff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; text-transform: uppercase; }
    .formatted-points ::ng-deep .member-name { font-size: 15px; font-weight: 700; color: #0f172a; margin: 0; }
    
    .formatted-points ::ng-deep .work-list { padding: 16px 18px; margin: 0; list-style: none; }
    .formatted-points ::ng-deep .work-item { display: flex; align-items: flex-start; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #f1f5f9; gap: 12px; }
    .formatted-points ::ng-deep .work-item:last-child { border-bottom: none; padding-bottom: 0; }
    .formatted-points ::ng-deep .item-text { flex: 1; color: #334155; }
    
    /* Status Pill Badges */
    .formatted-points ::ng-deep .status-pill { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
    .formatted-points ::ng-deep .status-completed { background: #dcfce7; color: #166534; }
    .formatted-points ::ng-deep .status-processing { background: #dbeafe; color: #1e40af; }
    .formatted-points ::ng-deep .status-blocked { background: #fee2e2; color: #991b1b; }
    .formatted-points ::ng-deep .status-todo { background: #f1f5f9; color: #475569; }
    
    /* Issues Sub-section inside Member Card */
    .formatted-points ::ng-deep .issues-box { background: #fff1f2; border-top: 1px solid #fecdd3; padding: 12px 18px; }
    .formatted-points ::ng-deep .issues-title { font-size: 12px; font-weight: 700; color: #9f1239; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px 0; display: flex; align-items: center; gap: 6px; }
    
    /* Interactive Clickable Blocker Tag */
    .formatted-points ::ng-deep .blocked-tag-clickable { cursor: pointer; color: #991b1b; background: #fee2e2; border: 1px solid #fecdd3; padding: 3px 10px; border-radius: 14px; font-weight: 600; font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; transition: all 0.2s ease; }
    .formatted-points ::ng-deep .blocked-tag-clickable:hover { background: #fecdd3; transform: translateY(-1px); }
    
    .loading-box { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 350px; gap: 16px; color: #64748b; font-size: 14px; font-weight: 500; }
    .spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top: 3px solid #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    
    /* Modal Styles */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(3px); }
    .modal-content { background: #ffffff; border-radius: 12px; width: 100%; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); overflow: hidden; animation: slideIn 0.2s ease-out forwards; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid #f1f5f9; background: #f8fafc; }
    .modal-title-wrapper { display: flex; align-items: center; gap: 8px; }
    .alert-icon { font-size: 18px; }
    .modal-title { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
    .close-btn { background: none; border: none; font-size: 24px; color: #94a3b8; cursor: pointer; line-height: 1; transition: color 0.2s; }
    .close-btn:hover { color: #0f172a; }
    .modal-body { padding: 24px; }
    .info-group { margin-bottom: 20px; }
    .info-group:last-child { margin-bottom: 0; }
    .info-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px 0; }
    .info-value { margin: 0; font-size: 15px; color: #0f172a; font-weight: 600; }
    .reason-box { background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 14px 16px; }
    .reason-text { margin: 0; color: #991b1b; font-size: 14px; line-height: 1.5; font-weight: 500; }
    .modal-footer { padding: 16px 24px; background: #f8fafc; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; }
    .btn-primary { background: #0f172a; color: white; border: none; padding: 8px 18px; border-radius: 6px; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .btn-primary:hover { background: #334155; }
  `]
})
export class StandupSummaryComponent implements OnInit {
  private apiUrl = 'http://localhost:4000/api';

  selectedDate: string = '';
  formattedDateDisplay: string = '';

  summaryHtml: string = '';
  taskCount: number = 0;
  issueCount: number = 0;
  lastSyncTime: Date | null = null;

  isLoading: boolean = false;
  loadingMessage: string = '';

  selectedBlockedTask: { title: string; blocked_reason: string } | null = null;

  constructor(
    private http: HttpClient,
    private cdRef: ChangeDetectorRef,
    private dashService: DashboardService
  ) {}

  ngOnInit(): void {
    this.setDefaultToToday();
  }

  setDefaultToToday(): void {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    this.selectedDate = `${year}-${month}-${day}`;
    this.updateFormattedDateDisplay(today);
    
    this.fetchSummaryForDate(this.selectedDate);
  }

  onDateChange(): void {
    if (!this.selectedDate) return;

    const [year, month, day] = this.selectedDate.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);

    this.updateFormattedDateDisplay(dateObj);
    this.fetchSummaryForDate(this.selectedDate);
  }

  updateFormattedDateDisplay(dateObj: Date): void {
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    this.formattedDateDisplay = `${dayName}, ${monthDay}`;
  }

  fetchSummaryForDate(rawDateStr: string): void {
    this.isLoading = true;
    this.loadingMessage = `Loading digest for ${this.formattedDateDisplay}...`;
    this.cdRef.detectChanges();

    const timestamp = new Date().getTime();
    const params = new URLSearchParams();
    params.set('date', rawDateStr);
    const activeChannel = this.dashService.activeChannelId();
    if (activeChannel) params.set('channel', activeChannel);
    params.set('_t', String(timestamp));

    const url = `${this.apiUrl}/discussions/daily-summary?${params.toString()}`;

    this.http.get<any>(url).subscribe({
      next: (res) => {
        this.summaryHtml = this.formatSectionContent(res.summary);
        this.taskCount = res.tasks_count || 0;
        this.issueCount = res.issues_count || 0;
        
        if (res.date) {
          const [bYear, bMonth, bDay] = res.date.split('-').map(Number);
          this.updateFormattedDateDisplay(new Date(bYear, bMonth - 1, bDay));
        }

        if (res.last_updated_at) {
          this.lastSyncTime = new Date(res.last_updated_at);
        } else {
          this.lastSyncTime = new Date();
        }

        this.isLoading = false;
        this.cdRef.detectChanges();
      },
      error: (err) => {
        console.error('Failed to fetch summary:', err);
        this.summaryHtml = '<div style="padding: 20px; text-align: center; color: #64748b;"><em>Unable to load stand-up digest for this date.</em></div>';
        this.isLoading = false;
        this.cdRef.detectChanges();
      }
    });
  }

  /**
   * Enhances plain MOM text into sleek, structured SaaS dashboard cards
   */
  formatSectionContent(text: string): string {
    if (!text) return '<em>No summary available.</em>';

    const lines = text.split('\n').map(l => l.trim());
    let html = '';
    let bannerText = '';
    let currentMember: string | null = null;
    let inIssuesSection = false;

    // 1. Separate Top Header metadata into a sleek top banner
    const headerLines = [];
    let lineIdx = 0;
    while (lineIdx < lines.length && !lines[lineIdx].startsWith('**')) {
      if (lines[lineIdx]) headerLines.push(lines[lineIdx]);
      lineIdx++;
    }

    if (headerLines.length > 0) {
      bannerText = headerLines
        .map(l => l.replace(/^(Date|Duration|Team-wise Task Updates):?/i, '<strong>$1:</strong>'))
        .join('<br>');
      html += `<div class="summary-banner">${bannerText}</div>`;
    }

    // Helper to close open member card
    const closeMemberCard = () => {
      if (currentMember) {
        if (inIssuesSection) html += `</ul></div>`;
        else html += `</ul>`;
        html += `</div>`;
        currentMember = null;
        inIssuesSection = false;
      }
    };

    // Helper to generate Avatar initials (e.g., "John Doe" -> "JD")
    const getInitials = (name: string) => {
      return name
        .split(' ')
        .filter(Boolean)
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
    };

    // 2. Parse Member Cards and Status Badges
    while (lineIdx < lines.length) {
      const line = lines[lineIdx];

      // New Member Header
      if (line.startsWith('**') && line.endsWith('**')) {
        closeMemberCard();
        currentMember = line.replace(/\*\*/g, '').trim();
        const initials = getInitials(currentMember);
        
        html += `<div class="member-card">
                   <div class="member-header">
                     <div class="avatar-circle">${initials}</div>
                     <h4 class="member-name">${currentMember}</h4>
                   </div>
                   <ul class="work-list">`;
        inIssuesSection = false;
      }
      // Enter Issues Sub-section
      else if (line.toLowerCase().startsWith('issues:')) {
        if (!inIssuesSection && currentMember) {
          html += `</ul><div class="issues-box"><h5 class="issues-title">🚨 Reported Issues</h5><ul class="work-list" style="padding: 0;">`;
          inIssuesSection = true;
        }
      }
      // Bullet Items (* or -)
      else if (line.startsWith('*') || line.startsWith('-')) {
        let cleanItem = line.substring(1).trim();

        // Extract Status Tag and wrap in colored CSS pill badge
        let statusClass = 'status-todo';
        cleanItem = cleanItem.replace(/\[(.*?)\]/g, (match, status) => {
          const s = status.toLowerCase();
          if (s.includes('done') || s.includes('complet') || s.includes('resolved')) statusClass = 'status-completed';
          else if (s.includes('process') || s.includes('work') || s.includes('progress')) statusClass = 'status-processing';
          else if (s.includes('block') || s.includes('hold') || s.includes('stuck')) statusClass = 'status-blocked';
          return `<span class="status-pill ${statusClass}">${status}</span>`;
        });

        // Extract Blocker and transform into interactive clickable badge
        cleanItem = cleanItem.replace(/(?:🚨|Blocker:?)\s*(.*?)$/i, (match, reason) => {
          return `<span class="blocked-tag-clickable" data-reason="${reason.trim()}">🚨 Blocker Details</span>`;
        });

        html += `<li class="work-item"><span class="item-text">• ${cleanItem}</span></li>`;
      }
      lineIdx++;
    }

    closeMemberCard();
    return html;
  }

  handleItemClick(event: MouseEvent): void {
    if (!event || !event.target) return;

    const target = event.target as HTMLElement;
    const blockedBadge = target.closest('.blocked-tag-clickable');

    if (blockedBadge) {
      const reason = blockedBadge.getAttribute('data-reason') || 'No reason provided yet. Awaiting reply in Slack.';
      
      const lineText = blockedBadge.closest('.work-item')?.textContent || 'Blocked Item';
      const titleMatch = lineText.match(/^(.*?)(?=\[|$|🚨)/);
      const title = titleMatch ? titleMatch[1].replace(/^[•*\-\s]+/, '').trim() : 'Blocked Task';

      this.selectedBlockedTask = {
        title: title,
        blocked_reason: reason
      };
      this.cdRef.detectChanges();
    }
  }

  closeModal(): void {
    this.selectedBlockedTask = null;
    this.cdRef.detectChanges();
  }
}