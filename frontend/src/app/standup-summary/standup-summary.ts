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
        
        <!-- Top Control Bar with Calendar Picker -->
        <div class="control-header">
          <div class="header-left">
            <h2 class="summary-title">🗓 Daily Stand-up Digest</h2>
            <span class="selected-date-label">{{ formattedDateDisplay }}</span>
            <span class="last-sync-badge" *ngIf="lastSyncTime">
              Last synced: {{ lastSyncTime | date:'shortTime' }}
            </span>
          </div>

           <div class="header-right">
             <!-- Calendar Picker -->
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

        <!-- Two-Section Display Grid -->
        <div class="sections-grid" *ngIf="!isLoading; else loadingState">
          
          <!-- Section 1: Tasks Summary -->
          <div class="summary-card-section">
            <div class="section-card-header tasks-header">
              <h3>📌 Tasks Summary</h3>
              <span class="count-badge">{{ taskCount }}</span>
            </div>
            <!-- Pass $event explicitly here -->
            <div class="section-card-body" (click)="handleItemClick($event)">
              <div class="formatted-points" [innerHTML]="tasksHtml"></div>
            </div>
          </div>

          <!-- Section 2: Issues & Bugs Summary -->
          <div class="summary-card-section">
            <div class="section-card-header issues-header">
              <h3>🚨 Issues & Bugs Summary</h3>
              <span class="count-badge">{{ issueCount }}</span>
            </div>
            <!-- Pass $event explicitly here -->
            <div class="section-card-body" (click)="handleItemClick($event)">
              <div class="formatted-points" [innerHTML]="issuesHtml"></div>
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
    .standup-body {
      padding: 24px 32px;
    }

    .summary-container {
      background: #ffffff;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      padding: 24px;
      min-height: 550px;
      display: flex;
      flex-direction: column;
    }

    .control-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 16px;
      border-bottom: 1px solid #f0f0f0;
      margin-bottom: 20px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .summary-title {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a2e;
      margin: 0;
    }

    .selected-date-label {
      font-size: 14px;
      color: #666;
      font-weight: 500;
    }

    .last-sync-badge {
      font-size: 12px;
      color: #888;
      background: #f4f4f6;
      padding: 4px 8px;
      border-radius: 4px;
    }

    .calendar-picker-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      color: #333;
      font-weight: 500;
    }

    .calendar-input {
      border: 1px solid #5b4fcf;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13.5px;
      color: #1a1a2e;
      outline: none;
      background: #fafafd;
      cursor: pointer;
    }

    .sections-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 20px;
      flex: 1;
    }

    .summary-card-section {
      background: #fafafd;
      border: 1px solid #eae6fb;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .section-card-header {
      padding: 14px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 14px;
    }

    .tasks-header {
      background: #f0edff;
      color: #5b4fcf;
      border-bottom: 1px solid #e2dbfc;
    }

    .issues-header {
      background: #ffeaea;
      color: #c0392b;
      border-bottom: 1px solid #fcdada;
    }

    .section-card-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
    }

    .count-badge {
      background: rgba(0, 0, 0, 0.08);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
    }

    .section-card-body {
      padding: 16px;
      font-size: 13.5px;
      line-height: 1.8;
      color: #333;
      flex: 1;
      overflow-y: auto;
      max-height: 480px;
    }

    .formatted-points ::ng-deep strong {
      color: #1a1a2e;
      font-weight: 600;
    }

    /* Interactive Clickable Blocker Tag */
    .formatted-points ::ng-deep .blocked-tag-clickable {
      cursor: pointer;
      color: #c0392b;
      background: #ffeaea;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 6px;
      transition: background 0.2s ease;
    }

    .formatted-points ::ng-deep .blocked-tag-clickable:hover {
      background: #ffd3d3;
    }

    .loading-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 350px;
      gap: 16px;
      color: #666;
      font-size: 14px;
    }

    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #f3f3f3;
      border-top: 3px solid #5b4fcf;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      backdrop-filter: blur(2px);
    }

    .modal-content {
      background: #ffffff;
      border-radius: 10px;
      width: 100%;
      max-width: 450px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
      overflow: hidden;
      animation: slideIn 0.2s ease-out forwards;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(15px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 24px;
      border-bottom: 1px solid #f0f0f0;
    }

    .modal-title-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .alert-icon { font-size: 18px; }

    .modal-title {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #1a1a2e;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 24px;
      color: #999;
      cursor: pointer;
      line-height: 1;
      transition: color 0.2s;
    }

    .close-btn:hover { color: #333; }

    .modal-body { padding: 24px; }

    .info-group { margin-bottom: 20px; }
    .info-group:last-child { margin-bottom: 0; }

    .info-label {
      font-size: 11px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0 0 6px 0;
    }

    .info-value {
      margin: 0;
      font-size: 14px;
      color: #333;
      font-weight: 500;
    }

    .reason-box {
      background: #fff9f9;
      border: 1px solid #ffeaea;
      border-radius: 6px;
      padding: 12px 16px;
    }

    .reason-text {
      margin: 0;
      color: #c0392b;
      font-size: 13.5px;
      line-height: 1.5;
    }

    .modal-footer {
      padding: 16px 24px;
      background: #fafafa;
      border-top: 1px solid #f0f0f0;
      display: flex;
      justify-content: flex-end;
    }

    .btn-primary {
      background: #1a1a2e;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }

    .btn-primary:hover { background: #2a2a4a; }
  `]
})
export class StandupSummaryComponent implements OnInit {
  private apiUrl = 'http://localhost:4000/api';

  selectedDate: string = '';
  formattedDateDisplay: string = '';

  tasksHtml: string = '';
  issuesHtml: string = '';
  taskCount: number = 0;
  issueCount: number = 0;
  lastSyncTime: Date | null = null;

  isLoading: boolean = false;
  loadingMessage: string = '';

  selectedBlockedTask: { title: string; blocked_reason: string } | null = null;

  constructor(private http: HttpClient, private cdRef: ChangeDetectorRef, private dashService: DashboardService) {}

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

  fetchSummaryForDate(dateStr: string): void {
    this.isLoading = true;
    this.loadingMessage = `Loading summary for ${this.formattedDateDisplay}...`;
    this.cdRef.detectChanges();

    const timestamp = new Date().getTime();
    const params = new URLSearchParams();
    params.set('date', dateStr);
    const activeChannel = this.dashService.activeChannelId();
    if (activeChannel) params.set('channel', activeChannel);
    params.set('_t', String(timestamp));

    const url = `${this.apiUrl}/discussions/daily-summary?${params.toString()}`;

    this.http.get<any>(url).subscribe({
      next: (res) => {
        this.parseSummaryIntoSections(res.summary);
        this.taskCount = res.tasks_count || 0;
        this.issueCount = res.issues_count || 0;
        
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
        this.tasksHtml = '<em>Unable to load tasks for this date.</em>';
        this.issuesHtml = '<em>Unable to load issues for this date.</em>';
        this.isLoading = false;
        this.cdRef.detectChanges();
      }
    });
  }

  parseSummaryIntoSections(fullText: string): void {
    if (!fullText) {
      this.tasksHtml = 'No tasks recorded.';
      this.issuesHtml = 'No issues recorded.';
      return;
    }

    const taskMatch = fullText.match(/📌\s*\*\*Tasks Summary\*\*([\s\S]*?)(?=🚨\s*\*\*Issues\s*&\s*Bugs\s*Summary\*\*|$)/i);
    const issueMatch = fullText.match(/🚨\s*\*\*Issues\s*&\s*Bugs\s*Summary\*\*([\s\S]*)$/i);

    const rawTasks = taskMatch ? taskMatch[1] : 'No tasks recorded.';
    const rawIssues = issueMatch ? issueMatch[1] : 'No issues recorded.';

    this.tasksHtml = this.formatSectionContent(rawTasks);
    this.issuesHtml = this.formatSectionContent(rawIssues);
  }

  formatSectionContent(text: string): string {
    return text
      .trim()
      .replace(/^- /gm, '• ')
      .replace(/^\s{2,}- /gm, '&nbsp;&nbsp;&nbsp;&nbsp;↳ ')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Transforms Blocker text into a clickable tag
      .replace(/(?:🚨|Blocker:?)\s*(.*?)(?=\n|<br\/>|$)/gi, (match, reason) => {
        const cleanReason = reason.replace(/[*_]/g, '').trim();
        return `<span class="blocked-tag-clickable" data-reason="${cleanReason}">🚨 Blocker Details</span>`;
      })
      .replace(/\n/g, '<br/>');
  }

  // Safely handles click events for blocked items inside the summary cards
  handleItemClick(event: MouseEvent): void {
    if (!event || !event.target) return;

    const target = event.target as HTMLElement;
    const blockedBadge = target.closest('.blocked-tag-clickable');

    if (blockedBadge) {
      const reason = blockedBadge.getAttribute('data-reason') || 'No reason provided yet. Awaiting reply in Slack.';
      
      const lineText = blockedBadge.parentElement?.textContent || 'Blocked Item';
      const titleMatch = lineText.match(/•\s*(.*?)(?=\[|$)/) || lineText.match(/^(.*?)(?=\[|$)/);
      const title = titleMatch ? titleMatch[1].trim() : 'Blocked Task';

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