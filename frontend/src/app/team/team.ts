import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header';
import { FormsModule } from '@angular/forms';

interface TeamMember {
  name: string;
  role: string;
  initials: string;
  color: string;
  current: number;
  blocked: number;
  doneToday: number;
  workload: number;
}

@Component({
  selector: 'app-team',
  imports: [CommonModule, PageHeaderComponent, FormsModule],
  template: `
    <app-page-header title="Team" searchPlaceholder="Find a team member..."></app-page-header>

    <div class="team-body">
      <div class="team-section-header">
        <div>
          <h2 class="squad-title">Engineering Squad</h2>
          <p class="squad-subtitle">Real-time workload and availability overview.</p>
        </div>
        <select class="team-filter-select" [(ngModel)]="teamFilter">
          <option value="all">All Teams</option>
          <option value="engineering">Engineering</option>
          <option value="design">Design</option>
        </select>
      </div>

      <div class="members-grid">
        <div class="member-card" *ngFor="let member of members">
          <div class="member-card-header">
            <div class="avatar-lg" [style.background]="member.color">{{ member.initials }}</div>
            <div class="member-info">
              <div class="member-name">{{ member.name }}</div>
              <div class="member-role">{{ member.role }}</div>
            </div>
          </div>

          <div class="member-stats">
            <div class="stat-block">
              <div class="stat-label">CURRENT</div>
              <div class="stat-num">{{ member.current }}</div>
            </div>
            <div class="stat-block">
              <div class="stat-label">BLOCKED</div>
              <div class="stat-num" [class.blocked-red]="member.blocked > 0">{{ member.blocked }}</div>
            </div>
            <div class="stat-block">
              <div class="stat-label">DONE TODAY</div>
              <div class="stat-num">{{ member.doneToday }}</div>
            </div>
          </div>

          <div class="workload-row">
            <span class="workload-label">Workload</span>
            <span class="workload-pct">{{ member.workload }}%</span>
          </div>
          <div class="workload-bar-bg">
            <div class="workload-bar-fill" [style.width.%]="member.workload"></div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .team-body {
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .team-section-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }

    .squad-title {
      font-size: 17px;
      font-weight: 700;
      color: #1a1a2e;
      margin: 0 0 4px;
    }

    .squad-subtitle {
      font-size: 12.5px;
      color: #888;
      margin: 0;
    }

    .team-filter-select {
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 13px;
      color: #333;
      background: white;
      cursor: pointer;
      outline: none;
    }

    .members-grid {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .member-card {
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      padding: 20px;
      width: 240px;
      min-width: 220px;
    }

    .member-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }

    .avatar-lg {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      color: white;
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .member-name {
      font-size: 13.5px;
      font-weight: 600;
      color: #1a1a2e;
    }

    .member-role {
      font-size: 11.5px;
      color: #888;
      margin-top: 2px;
    }

    .member-stats {
      display: flex;
      gap: 16px;
      margin-bottom: 14px;
    }

    .stat-block {
      flex: 1;
    }

    .stat-label {
      font-size: 10px;
      color: #aaa;
      font-weight: 600;
      letter-spacing: 0.4px;
      margin-bottom: 4px;
    }

    .stat-num {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a2e;
    }

    .stat-num.blocked-red { color: #e53e3e; }

    .workload-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .workload-label {
      font-size: 12px;
      color: #666;
    }

    .workload-pct {
      font-size: 12px;
      color: #666;
    }

    .workload-bar-bg {
      width: 100%;
      height: 5px;
      background: #e9ecef;
      border-radius: 3px;
      overflow: hidden;
    }

    .workload-bar-fill {
      height: 100%;
      background: #5b4fcf;
      border-radius: 3px;
      transition: width 0.3s;
    }
  `]
})
export class TeamComponent {
  teamFilter = 'all';

  members: TeamMember[] = [
    { name: 'Nitesh Kumar Vishwakarma', role: 'Developer', initials: 'NV', color: '#e07b39', current: 3, blocked: 0, doneToday: 0, workload: 50 },
    { name: 'nandanimangal7', role: 'Developer', initials: 'NA', color: '#e05050', current: 2, blocked: 2, doneToday: 0, workload: 33 },
    { name: 'sujal dey', role: 'Developer', initials: 'SD', color: '#1abaab', current: 1, blocked: 0, doneToday: 0, workload: 17 },
  ];
}
