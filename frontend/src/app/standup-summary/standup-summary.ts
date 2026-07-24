import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../shared/page-header';

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
            <div class="section-card-body">
              <div class="formatted-points" [innerHTML]="tasksHtml"></div>
            </div>
          </div>

          <!-- Section 2: Issues & Bugs Summary -->
          <div class="summary-card-section">
            <div class="section-card-header issues-header">
              <h3>🚨 Issues & Bugs Summary</h3>
              <span class="count-badge">{{ issueCount }}</span>
            </div>
            <div class="section-card-body">
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

    /* Top Control Header */
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

    /* Two-Section Grid Layout */
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
      line-height: 1.6;
      color: #333;
      flex: 1;
      overflow-y: auto;
      max-height: 480px;
    }

    .formatted-points ::ng-deep strong {
      color: #1a1a2e;
      font-weight: 600;
    }

    /* Loading Spinner */
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
  `]
})
export class StandupSummaryComponent implements OnInit {
  private apiUrl = 'http://localhost:4000/api';

  selectedDate: string = ''; // YYYY-MM-DD
  formattedDateDisplay: string = '';

  tasksHtml: string = '';
  issuesHtml: string = '';
  taskCount: number = 0;
  issueCount: number = 0;
  lastSyncTime: Date | null = null;

  isLoading: boolean = false;
  loadingMessage: string = '';

  constructor(private http: HttpClient, private cdRef: ChangeDetectorRef) {}

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

    const url = `${this.apiUrl}/discussions/daily-summary?date=${dateStr}`;

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
      .replace(/^\s{2,}- /gm, '&nbsp;&nbsp;&nbsp;&nbsp;↳ ') // Indent sub-lines nicely
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
  }
}