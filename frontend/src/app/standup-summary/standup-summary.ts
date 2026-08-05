import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../shared/page-header';
import { DashboardService } from '../services/dashboard.service';

export interface WorkItem {
  rawText: string;
  cleanText: string;
  statusText?: string;
  statusClass?: string;
  blockedReason?: string;
}

export interface MemberSummary {
  name: string;
  initials: string;
  tasks: WorkItem[];
  issues: WorkItem[];
  discussions: WorkItem[];
}

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
            <!-- View Switcher Toggle Buttons -->
            <div class="view-toggle-group">
              <button
                class="toggle-btn"
                [class.active]="activeView === 'mom'"
                (click)="activeView = 'mom'"
              >
                📋 MOM Cards
              </button>
              <button
                class="toggle-btn"
                [class.active]="activeView === 'discussions'"
                (click)="activeView = 'discussions'"
              >
                💬 All Discussions
              </button>
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
        </div>

        <!-- Standup Summary View -->
        <div class="single-section-view" *ngIf="!isLoading; else loadingState">

          <!-- VIEW A: MOM Member Cards Grid -->
          <div class="summary-card-section" *ngIf="activeView === 'mom'">

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

            <div class="section-card-body">

              <!-- Meta Banner Header -->
              <div class="summary-banner" *ngIf="headerBannerText">
                <span class="banner-icon">ℹ️</span>
                <div [innerHTML]="headerBannerText"></div>
              </div>

              <!-- Dedicated Equal-Sized Cards Grid for Each Individual -->
              <div class="members-cards-grid" *ngIf="memberSummaries.length > 0; else emptyState">
                <div class="individual-card" *ngFor="let member of memberSummaries">

                  <!-- Card Member Header -->
                  <div class="card-member-header">
                    <div class="avatar-circle">{{ member.initials }}</div>
                    <div class="member-info">
                      <h4 class="member-name">{{ member.name }}</h4>
                      <span class="item-count-label">
                        {{ member.tasks.length }} Tasks • {{ member.issues.length }} Issues • {{ member.discussions.length }} Notes
                      </span>
                    </div>
                  </div>

                  <!-- Truncated Scroll-Free Card Body -->
                  <div class="card-content-area">

                    <!-- Tasks List -->
                    <div class="card-section" *ngIf="member.tasks.length > 0">
                      <h5 class="section-label">TASKS & UPDATES</h5>
                      <ul class="work-list">
                        <li class="work-item" *ngFor="let task of member.tasks">
                          <span class="bullet">•</span>
                          <div class="item-content">
                            <span class="task-title">{{ task.cleanText }}</span>
                            <span
                              *ngIf="task.statusText"
                              class="status-pill"
                              [ngClass]="task.statusClass"
                            >
                              {{ task.statusText }}
                            </span>
                          </div>
                        </li>
                      </ul>
                    </div>

                    <!-- Issues Sub-Card -->
                    <div class="issues-subcard" *ngIf="member.issues.length > 0">
                      <h5 class="issues-label">🚨 LOGGED ISSUES</h5>
                      <ul class="work-list">
                        <li class="work-item" *ngFor="let issue of member.issues">
                          <span class="bullet">•</span>
                          <div class="item-content">
                            <span class="issue-title">{{ issue.cleanText }}</span>
                            <span
                              *ngIf="issue.statusText"
                              class="status-pill"
                              [ngClass]="issue.statusClass"
                            >
                              {{ issue.statusText }}
                            </span>
                          </div>
                        </li>
                      </ul>
                    </div>

                    <!-- Discussions Sub-Card -->
                    <div class="discussions-subcard" *ngIf="member.discussions.length > 0">
                      <h5 class="discussions-label">💬 DISCUSSIONS & NOTES</h5>
                      <ul class="work-list">
                        <li class="work-item" *ngFor="let disc of member.discussions">
                          <span class="bullet">•</span>
                          <div class="item-content">
                            <span class="discussion-text">{{ disc.cleanText }}</span>
                          </div>
                        </li>
                      </ul>
                    </div>

                    <!-- Fade Gradient for Overflowing Content -->
                    <div class="card-fade-overlay" *ngIf="hasOverflow(member)"></div>
                  </div>

                  <!-- Card Footer with Read More Button -->
                  <div class="card-footer">
                    <button
                      class="read-more-btn"
                      (click)="openMemberModal(member)"
                    >
                      Read More <span class="arrow">→</span>
                    </button>
                  </div>

                </div>
              </div>

              <ng-template #emptyState>
                <div class="empty-box">
                  <p>No member updates recorded for this date.</p>
                </div>
              </ng-template>

            </div>

          </div>

          <!-- VIEW B: Dedicated All Discussions View -->
          <div class="summary-card-section" *ngIf="activeView === 'discussions'">
            <div class="section-card-header mom-header">
              <div class="header-title-box">
                <span class="doc-icon">💬</span>
                <h3>All Team Discussions & Notes for {{ formattedDateDisplay }}</h3>
              </div>
            </div>
            <div class="section-card-body">
              <div class="discussions-full-list" *ngIf="getAllDiscussions().length > 0; else noDiscussions">
                <div class="discussion-row-card" *ngFor="let item of getAllDiscussions()">
                  <div class="disc-author-badge">{{ item.memberName }}</div>
                  <div class="disc-content-box">
                    <p class="disc-text">{{ item.discussion.cleanText }}</p>
                  </div>
                </div>
              </div>
              <ng-template #noDiscussions>
                <div class="empty-box">
                  <p>No discussions or notes recorded for this date.</p>
                </div>
              </ng-template>
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

    <!-- FULL MEMBER CARD DETAILS MODAL OVERLAY -->
    <div class="modal-overlay" *ngIf="selectedMemberCard" (click)="closeMemberModal()">
      <div class="modal-content member-modal-content" (click)="$event.stopPropagation()">

        <div class="modal-header">
          <div class="modal-member-info">
            <div class="avatar-circle large-avatar">{{ selectedMemberCard.initials }}</div>
            <div>
              <h3 class="modal-title">{{ selectedMemberCard.name }}</h3>
              <span class="item-count-label">
                {{ selectedMemberCard.tasks.length }} Tasks • {{ selectedMemberCard.issues.length }} Issues • {{ selectedMemberCard.discussions.length }} Notes
              </span>
            </div>
          </div>
          <button class="close-btn" (click)="closeMemberModal()">&times;</button>
        </div>

        <div class="modal-body scrollable-modal-body">

          <!-- Full Tasks List in Modal -->
          <div class="modal-section" *ngIf="selectedMemberCard.tasks.length > 0">
            <h5 class="section-label">TASKS & UPDATES</h5>
            <ul class="work-list modal-work-list">
              <li class="work-item modal-work-item" *ngFor="let task of selectedMemberCard.tasks">
                <span class="bullet">•</span>
                <div class="item-content">
                  <span class="task-title">{{ task.cleanText }}</span>
                  <span
                    *ngIf="task.statusText"
                    class="status-pill"
                    [ngClass]="task.statusClass"
                  >
                    {{ task.statusText }}
                  </span>
                  <button
                    *ngIf="task.blockedReason"
                    class="blocked-tag-btn"
                    (click)="openBlockerModal(task.cleanText, task.blockedReason)"
                  >
                    🚨 Blocker Details
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <!-- Full Issues List in Modal -->
          <div class="modal-section issues-modal-section" *ngIf="selectedMemberCard.issues.length > 0">
            <h5 class="issues-label">🚨 LOGGED ISSUES</h5>
            <ul class="work-list modal-work-list">
              <li class="work-item modal-work-item" *ngFor="let issue of selectedMemberCard.issues">
                <span class="bullet">•</span>
                <div class="item-content">
                  <span class="issue-title">{{ issue.cleanText }}</span>
                  <span
                    *ngIf="issue.statusText"
                    class="status-pill"
                    [ngClass]="issue.statusClass"
                  >
                    {{ issue.statusText }}
                  </span>
                  <button
                    *ngIf="issue.blockedReason"
                    class="blocked-tag-btn"
                    (click)="openBlockerModal(issue.cleanText, issue.blockedReason)"
                  >
                    🚨 Details
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <!-- Full Discussions List in Modal -->
          <div class="modal-section discussions-modal-section" *ngIf="selectedMemberCard.discussions.length > 0">
            <h5 class="discussions-label">💬 DISCUSSIONS & NOTES</h5>
            <ul class="work-list modal-work-list">
              <li class="work-item modal-work-item" *ngFor="let disc of selectedMemberCard.discussions">
                <span class="bullet">•</span>
                <div class="item-content">
                  <span class="discussion-text">{{ disc.cleanText }}</span>
                </div>
              </li>
            </ul>
          </div>

        </div>

        <div class="modal-footer">
          <button class="btn-primary" (click)="closeMemberModal()">Close</button>
        </div>

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
    .standup-body { padding: 20px 28px; background: #f8fafc; min-height: 100vh; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    .summary-container { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; min-height: 580px; display: flex; flex-direction: column; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02); }

    .control-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 14px; border-bottom: 1px solid #f1f5f9; margin-bottom: 16px; }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-right { display: flex; align-items: center; gap: 16px; }
    .summary-title { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0; }
    .selected-date-label { font-size: 13px; color: #475569; font-weight: 600; background: #f1f5f9; padding: 4px 10px; border-radius: 16px; }
    .last-sync-badge { font-size: 12px; color: #64748b; font-weight: 500; }

    /* View Switcher Toggle Buttons */
    .view-toggle-group { display: flex; background: #f1f5f9; padding: 3px; border-radius: 8px; gap: 3px; }
    .toggle-btn { background: transparent; border: none; padding: 6px 12px; font-size: 12.5px; font-weight: 600; color: #64748b; border-radius: 6px; cursor: pointer; transition: all 0.2s; }
    .toggle-btn.active { background: #ffffff; color: #0f172a; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

    .calendar-picker-wrapper { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #334155; font-weight: 500; }
    .calendar-input { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 10px; font-size: 13px; color: #0f172a; outline: none; background: #ffffff; cursor: pointer; }

    .single-section-view { display: flex; flex-direction: column; flex: 1; }
    .summary-card-section { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; display: flex; flex-direction: column; overflow: hidden; flex: 1; }
    .section-card-header { padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; }
    .mom-header { background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .header-title-box { display: flex; align-items: center; gap: 8px; }
    .doc-icon { font-size: 16px; }
    .section-card-header h3 { margin: 0; font-size: 15px; font-weight: 700; color: #1e293b; }

    .badge-group { display: flex; gap: 8px; }
    .count-badge { padding: 2px 10px; border-radius: 14px; font-size: 11.5px; font-weight: 600; }
    .tasks-badge { background: #e0e7ff; color: #4338ca; }
    .issues-badge { background: #fee2e2; color: #991b1b; }

    .section-card-body { padding: 20px; font-size: 13.5px; color: #334155; flex: 1; overflow-y: auto; max-height: 720px; }

    /* Top Summary Banner */
    .summary-banner { background: #eff6ff; border-left: 4px solid #6366f1; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; color: #3730a3; display: flex; align-items: center; gap: 10px; }
    .banner-icon { font-size: 16px; }

    /* INDIVIDUAL MEMBER CARDS GRID - EQUAL SIZED CARDS */
    .members-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
      gap: 18px;
      align-items: start;
    }

    .individual-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
      height: 320px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      transition: all 0.2s ease;
      position: relative;
    }
    .individual-card:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      border-color: #cbd5e1;
    }

    .card-member-header {
      background: #f8fafc;
      padding: 12px 16px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .avatar-circle {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #6366f1;
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .large-avatar { width: 40px; height: 40px; font-size: 14px; }

    .member-info { display: flex; flex-direction: column; }
    .member-name { font-size: 14.5px; font-weight: 700; color: #0f172a; margin: 0; }
    .item-count-label { font-size: 11px; color: #64748b; font-weight: 500; }

    .card-content-area {
      flex: 1;
      padding: 12px 16px;
      overflow: hidden;
      position: relative;
    }

    .card-fade-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 45px;
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0), rgba(255, 255, 255, 1));
      pointer-events: none;
    }

    .card-section { margin-bottom: 12px; }
    .section-label { font-size: 10px; font-weight: 700; color: #64748b; letter-spacing: 0.5px; margin: 0 0 6px 0; }

    .work-list { list-style: none; padding: 0; margin: 0; }
    .work-item { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
    .work-item:last-child { margin-bottom: 0; }
    .bullet { color: #94a3b8; font-size: 12px; line-height: 1.4; }
    .item-content { flex: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; line-height: 1.4; color: #334155; }
    .task-title, .issue-title, .discussion-text { word-break: break-word; }

    /* Status Badges */
    .status-pill { padding: 1px 7px; border-radius: 10px; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
    .status-completed { background: #dcfce7; color: #166534; }
    .status-processing { background: #dbeafe; color: #1e40af; }
    .status-blocked { background: #fee2e2; color: #991b1b; }
    .status-todo { background: #f1f5f9; color: #475569; }

    /* Interactive Blocker Button */
    .blocked-tag-btn {
      cursor: pointer;
      color: #991b1b;
      background: #fee2e2;
      border: 1px solid #fecdd3;
      padding: 2px 7px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      transition: all 0.2s;
    }
    .blocked-tag-btn:hover { background: #fecdd3; }

    /* Subcards inside card */
    .issues-subcard {
      background: #fff1f2;
      border: 1px solid #fecdd3;
      border-radius: 6px;
      padding: 8px 12px;
      margin-top: 8px;
    }
    .issues-label { font-size: 10px; font-weight: 700; color: #9f1239; letter-spacing: 0.5px; margin: 0 0 6px 0; }

    .discussions-subcard {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 8px 12px;
      margin-top: 8px;
    }
    .discussions-label { font-size: 10px; font-weight: 700; color: #166534; letter-spacing: 0.5px; margin: 0 0 6px 0; }

    /* Dedicated Discussions List Styles */
    .discussions-full-list { display: flex; flex-direction: column; gap: 12px; }
    .discussion-row-card { display: flex; align-items: flex-start; gap: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; }
    .disc-author-badge { background: #e0e7ff; color: #4338ca; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 12px; white-space: nowrap; }
    .disc-content-box { flex: 1; }
    .disc-text { margin: 0; font-size: 13.5px; color: #334155; line-height: 1.5; }

    /* Card Footer with Read More Button */
    .card-footer {
      padding: 10px 16px;
      background: #ffffff;
      border-top: 1px solid #f1f5f9;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      flex-shrink: 0;
    }

    .read-more-btn {
      background: none;
      border: none;
      color: #6366f1;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      transition: background 0.2s;
    }
    .read-more-btn:hover { background: #e0e7ff; }
    .arrow { font-size: 13px; transition: transform 0.2s; }
    .read-more-btn:hover .arrow { transform: translateX(3px); }

    .empty-box { text-align: center; padding: 40px; color: #64748b; font-size: 14px; }
    .loading-box { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 350px; gap: 16px; color: #64748b; font-size: 14px; font-weight: 500; }
    .spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top: 3px solid #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* Modal Styles */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(3px); }
    .modal-content { background: #ffffff; border-radius: 12px; width: 100%; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); overflow: hidden; animation: slideIn 0.2s ease-out forwards; }
    .member-modal-content { max-width: 600px; max-height: 80vh; display: flex; flex-direction: column; }

    @keyframes slideIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }

    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #f1f5f9; background: #f8fafc; }
    .modal-member-info { display: flex; align-items: center; gap: 12px; }
    .modal-title-wrapper { display: flex; align-items: center; gap: 8px; }
    .alert-icon { font-size: 18px; }
    .modal-title { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
    .close-btn { background: none; border: none; font-size: 22px; color: #94a3b8; cursor: pointer; line-height: 1; }
    .close-btn:hover { color: #0f172a; }

    .modal-body { padding: 20px; }
    .scrollable-modal-body { overflow-y: auto; flex: 1; max-height: 60vh; }

    .modal-section { margin-bottom: 20px; }
    .modal-work-list { gap: 10px; }
    .modal-work-item { padding: 8px 0; border-bottom: 1px dashed #f1f5f9; }
    .modal-work-item:last-child { border-bottom: none; }
    .issues-modal-section { background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 14px; }
    .discussions-modal-section { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; }

    .info-group { margin-bottom: 16px; }
    .info-group:last-child { margin-bottom: 0; }
    .info-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 6px 0; }
    .info-value { margin: 0; font-size: 14px; color: #0f172a; font-weight: 600; }
    .reason-box { background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 12px 14px; }
    .reason-text { margin: 0; color: #991b1b; font-size: 13.5px; line-height: 1.4; font-weight: 500; }

    .modal-footer { padding: 14px 20px; background: #f8fafc; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; }
    .btn-primary { background: #0f172a; color: white; border: none; padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-primary:hover { background: #334155; }
  `]
})
export class StandupSummaryComponent implements OnInit {
  private apiUrl = 'http://localhost:4200/api';

  selectedDate: string = '';
  formattedDateDisplay: string = '';

  headerBannerText: string = '';
  memberSummaries: MemberSummary[] = [];

  taskCount: number = 0;
  issueCount: number = 0;
  lastSyncTime: Date | null = null;

  isLoading: boolean = false;
  loadingMessage: string = '';

  activeView: 'mom' | 'discussions' = 'mom';

  selectedBlockedTask: { title: string; blocked_reason: string } | null = null;
  selectedMemberCard: MemberSummary | null = null;

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
        this.parseSummaryTextToCards(res.summary || '');
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
        this.memberSummaries = [];
        this.headerBannerText = '<em>Unable to load stand-up digest for this date.</em>';
        this.isLoading = false;
        this.cdRef.detectChanges();
      }
    });
  }

  /**
   * Structured Parser: Converts Raw Text into Native Member Cards, filtering out bots and standalone issue headers
   */
  parseSummaryTextToCards(text: string): void {
    this.memberSummaries = [];
    this.headerBannerText = '';

    if (!text) return;

    const lines = text.split('\n').map(l => l.trim());
    const bannerLines: string[] = [];
    let currentMember: MemberSummary | null = null;
    let activeSection: 'tasks' | 'issues' | 'discussions' = 'tasks';

    const botKeywords = ['slackbot', 'bot', 'github', 'jira', 'ai_engineering','aiem'];

    const getInitials = (name: string) => {
      return name
        .split(' ')
        .filter(Boolean)
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
    };

    let idx = 0;
    while (idx < lines.length && !lines[idx].startsWith('**')) {
      if (lines[idx]) {
        bannerLines.push(lines[idx].replace(/^(Date|Duration|Team-wise Task Updates):?/i, '<strong>$1:</strong>'));
      }
      idx++;
    }

    if (bannerLines.length > 0) {
      this.headerBannerText = bannerLines.join(' &nbsp;•&nbsp; ');
    }

    for (; idx < lines.length; idx++) {
      const line = lines[idx];
      if (!line) continue;

      // Detect New Member Header (**John Doe**)
      if (line.startsWith('**') && line.endsWith('**')) {
        const name = line.replace(/\*\*/g, '').trim();
        const lowerName = name.toLowerCase();

        // 1. Skip bots
        const isBot = botKeywords.some(keyword => lowerName.includes(keyword));
        if (isBot) {
          currentMember = null;
          continue;
        }

        // 2. Skip rogue standalone "Issues:" or "Unassigned" headers and route items safely to current member
        if (lowerName.includes('issue') || lowerName === 'unassigned' || !name) {
          if (currentMember) {
            activeSection = 'issues';
          } else {
            currentMember = null;
          }
          continue;
        }

        currentMember = {
          name: name,
          initials: getInitials(name),
          tasks: [],
          issues: [],
          discussions: []
        };
        this.memberSummaries.push(currentMember);
        activeSection = 'tasks';
      }
      // Detect Section sub-headers
      else if (line.toLowerCase().startsWith('issues:')) {
        activeSection = 'issues';
      }
      else if (line.toLowerCase().startsWith('discussions:') || line.toLowerCase().startsWith('notes:') || line.toLowerCase().startsWith('discussion:')) {
        activeSection = 'discussions';
      }
      // Detect Bullet Items (* or -)
      else if ((line.startsWith('*') || line.startsWith('-')) && currentMember) {
        let cleanText = line.substring(1).trim();

        let statusText = '';
        let statusClass = 'status-todo';
        cleanText = cleanText.replace(/\[(.*?)\]/g, (match, status) => {
          statusText = status.trim();
          const s = statusText.toLowerCase();
          if (s.includes('done') || s.includes('complet') || s.includes('resolved')) statusClass = 'status-completed';
          else if (s.includes('process') || s.includes('work') || s.includes('progress')) statusClass = 'status-processing';
          else if (s.includes('block') || s.includes('hold') || s.includes('stuck')) statusClass = 'status-blocked';
          return '';
        }).trim();

        let blockedReason = '';
        cleanText = cleanText.replace(/(?:🚨|Blocker:?)\s*(.*?)$/i, (match, reason) => {
          blockedReason = reason.trim();
          return '';
        }).trim();

        const item: WorkItem = {
          rawText: line,
          cleanText: cleanText,
          statusText: statusText,
          statusClass: statusClass,
          blockedReason: blockedReason
        };

        if (activeSection === 'issues') {
          currentMember.issues.push(item);
        } else if (activeSection === 'discussions') {
          currentMember.discussions.push(item);
        } else {
          currentMember.tasks.push(item);
        }
      }
    }
  }

  /**
   * Helper to flatten all discussions across all members for the standalone Discussions tab
   */
  getAllDiscussions(): { memberName: string; discussion: WorkItem }[] {
    const all: { memberName: string; discussion: WorkItem }[] = [];
    for (const member of this.memberSummaries) {
      for (const disc of member.discussions) {
        all.push({ memberName: member.name, discussion: disc });
      }
    }
    return all;
  }

  hasOverflow(member: MemberSummary): boolean {
    return (member.tasks.length + member.issues.length + member.discussions.length) >= 3;
  }

  openMemberModal(member: MemberSummary): void {
    this.selectedMemberCard = member;
    this.cdRef.detectChanges();
  }

  closeMemberModal(): void {
    this.selectedMemberCard = null;
    this.cdRef.detectChanges();
  }

  openBlockerModal(title: string, reason: string): void {
    const cleanTitle = title.replace(/^[•*\-\s]+/, '').trim() || 'Blocked Item';
    this.selectedBlockedTask = {
      title: cleanTitle,
      blocked_reason: reason || 'No specific blocker reason logged. Awaiting update in Slack.'
    };
    this.cdRef.detectChanges();
  }

  closeModal(): void {
    this.selectedBlockedTask = null;
    this.cdRef.detectChanges();
  }
}
