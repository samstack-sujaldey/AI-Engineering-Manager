import { Component, OnInit } from '@angular/core';
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
        
        <!-- Top Control Bar with Calendar Picker and Sync Button -->
        <div class="control-header">
          <div class="header-left">
            <h2 class="summary-title">🗓 Daily Stand-up Digest</h2>
            <span class="selected-date-label">{{ formattedDateDisplay }}</span>
            <span class="last-sync-badge" *ngIf="lastSyncTime">
              Last synced: {{ lastSyncTime | date:'shortTime' }}
            </span>
          </div>

          <div class="header-right">
            <!-- Sync / Refresh AI Summary Button -->
            <button 
              class="refresh-btn" 
              [disabled]="isLoading || isRefreshing" 
              (click)="onRefreshClick()">
              <span *ngIf="!isRefreshing">🔄 Refresh AI Summary</span>
              <span *ngIf="isRefreshing">⏳ Summarizing...</span>
            </button>

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

        <!-- Summary Display Panel -->
        <div class="summary-card" *ngIf="!isLoading; else loadingState">
          <div class="summary-text-box">
            <div class="formatted-points" [innerHTML]="formattedSummaryHtml"></div>
          </div>

          <!-- Items Counter Badge Bar -->
          <div class="stats-footer">
            <span class="stat-tag">Tasks: {{ taskCount }}</span>
            <span class="stat-tag">Issues: {{ issueCount }}</span>
            <span class="stat-tag">Discussions: {{ discussionCount }}</span>
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

    /* Sync Button Styling */
    .refresh-btn {
      background: #5b4fcf;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.2s ease, opacity 0.2s ease;
    }

    .refresh-btn:hover:not(:disabled) {
      background: #4a3ebd;
    }

    .refresh-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
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

    /* Main Summary Card */
    .summary-card {
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .summary-text-box {
      flex: 1;
      background: #fafafd;
      border: 1px solid #eae6fb;
      border-radius: 8px;
      padding: 20px;
      overflow-y: auto;
    }

    .formatted-points {
      font-size: 14.5px;
      line-height: 1.8;
      color: #2c2c3e;
    }

    .formatted-points ::ng-deep strong {
      color: #1a1a2e;
      font-size: 15px;
      display: inline-block;
      margin-top: 14px;
      margin-bottom: 4px;
    }

    .formatted-points ::ng-deep strong:first-child {
      margin-top: 0;
    }

    .stats-footer {
      display: flex;
      gap: 12px;
      margin-top: 20px;
    }

    .stat-tag {
      background: #f0edff;
      color: #5b4fcf;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 20px;
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

  currentSummary: string = '';
  taskCount: number = 0;
  issueCount: number = 0;
  discussionCount: number = 0;
  lastSyncTime: Date | null = null;

  isLoading: boolean = false;
  isRefreshing: boolean = false;
  loadingMessage: string = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.setDefaultToToday();
  }

  /**
   * Converts markdown returned by backend/LLM into clean HTML for rendering
   */
  get formattedSummaryHtml(): string {
    if (!this.currentSummary) return '<em>No activity logged for this date.</em>';

    return this.currentSummary
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- /gm, '• ')
      .replace(/\n/g, '<br/>');
  }

  /**
   * Sets default selected date to today's current date
   */
  setDefaultToToday(): void {
    const today = new Date();

    // Format YYYY-MM-DD for <input type="date">
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    this.selectedDate = `${year}-${month}-${day}`;
    this.updateFormattedDateDisplay(today);
    
    // Initial fetch loads summary directly for today
    this.fetchSummaryForDate(this.selectedDate, false);
  }

  onDateChange(): void {
    if (!this.selectedDate) return;

    const [year, month, day] = this.selectedDate.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);

    this.updateFormattedDateDisplay(dateObj);
    this.fetchSummaryForDate(this.selectedDate, false);
  }

  onRefreshClick(): void {
    if (!this.selectedDate) return;
    this.fetchSummaryForDate(this.selectedDate, true);
  }

  updateFormattedDateDisplay(dateObj: Date): void {
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    this.formattedDateDisplay = `${dayName}, ${monthDay}`;
  }

  fetchSummaryForDate(dateStr: string, forceRefresh: boolean = false): void {
    if (forceRefresh) {
      this.isRefreshing = true;
      this.loadingMessage = `Re-analyzing new tasks & issues with AI for ${this.formattedDateDisplay}...`;
    } else {
      this.isLoading = true;
      this.loadingMessage = `Loading summary for ${this.formattedDateDisplay}...`;
    }

    const url = `${this.apiUrl}/discussions/daily-summary?date=${dateStr}&forceRefresh=${forceRefresh}`;

    this.http.get<any>(url).subscribe({
      next: (res) => {
        this.currentSummary = res.summary;
        this.taskCount = res.tasks?.length || res.tasks_count || 0;
        this.issueCount = res.issues?.length || res.issues_count || 0;
        this.discussionCount = res.discussions?.length || res.discussions_count || 0;
        
        if (res.last_updated_at) {
          this.lastSyncTime = new Date(res.last_updated_at);
        } else {
          this.lastSyncTime = new Date();
        }

        this.isLoading = false;
        this.isRefreshing = false;
      },
      error: (err) => {
        console.error('Failed to fetch summary:', err);
        this.currentSummary = 'Unable to generate summary for this date.';
        this.isLoading = false;
        this.isRefreshing = false;
      }
    });
  }
}