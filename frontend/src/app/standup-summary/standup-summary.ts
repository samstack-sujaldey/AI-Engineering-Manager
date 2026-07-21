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
        
        <!-- Top Control Bar with Calendar Picker -->
        <div class="control-header">
          <div class="header-left">
            <h2 class="summary-title">🗓 Daily Stand-up Digest</h2>
            <span class="selected-date-label">{{ formattedDateDisplay }}</span>
          </div>

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
            <span>Generating summary points for {{ formattedDateDisplay }}...</span>
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
      align-items: baseline;
      gap: 12px;
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

    /* Markdown Heading and List Styling */
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

  isLoading: boolean = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.setDefaultToMonday();
  }

  /**
   * Converts markdown returned by OpenRouter into clean HTML for rendering
   */
  get formattedSummaryHtml(): string {
    if (!this.currentSummary) return '<em>No activity logged for this date.</em>';

    return this.currentSummary
      // Convert Markdown headers (**Heading**) to styled strong tags
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Convert bullet list dashes to bullet indicators
      .replace(/^- /gm, '• ')
      // Convert newlines into HTML line breaks
      .replace(/\n/g, '<br/>');
  }

  setDefaultToMonday(): void {
    const today = new Date();
    const currentDay = today.getDay(); // 0 is Sunday, 1 is Monday

    // Calculate distance to Monday of current week
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(today);
    monday.setDate(today.getDate() + distanceToMonday);

    // Format YYYY-MM-DD for <input type="date">
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, '0');
    const day = String(monday.getDate()).padStart(2, '0');

    this.selectedDate = `${year}-${month}-${day}`;
    this.updateFormattedDateDisplay(monday);
    
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
    this.http.get<any>(`${this.apiUrl}/discussions/daily-summary?date=${dateStr}`).subscribe({
      next: (res) => {
        this.currentSummary = res.summary;
        this.taskCount = res.tasks?.length || 0;
        this.issueCount = res.issues?.length || 0;
        this.discussionCount = res.discussions?.length || 0;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Failed to fetch summary:', err);
        this.currentSummary = 'Unable to generate summary for this date.';
        this.isLoading = false;
      }
    });
  }
}