import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DashboardService } from './services/dashboard.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  template: `
    <div class="app-container" *ngIf="auth.user(); else loginTpl">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-brand">
          <span class="brand-name">Ai Engineering Manager</span>
          <span class="brand-role">{{ auth.user()?.role || 'User' }}</span>
        </div>

        <!-- Navigation Menu -->
        <nav class="sidebar-nav">
          <a routerLink="/dashboard" routerLinkActive="active" class="nav-item">
            <span class="nav-dot"></span>Dashboard
          </a>
          <a routerLink="/tasks" routerLinkActive="active" class="nav-item">
            <span class="nav-dot"></span>Tasks
          </a>
          <a routerLink="/standup-summary" routerLinkActive="active" class="nav-item">
            <span class="nav-dot"></span>Stand-up Summary
          </a>
          <a routerLink="/team" routerLinkActive="active" class="nav-item">
            <span class="nav-dot"></span>Team
          </a>
          <a routerLink="/issues" routerLinkActive="active" class="nav-item">
            <span class="nav-dot"></span>Issues
          </a>
          <a routerLink="/integrations" routerLinkActive="active" class="nav-item">
            <span class="nav-dot"></span>Integrations
          </a>
          <a routerLink="/new-user" routerLinkActive="active" *ngIf="auth.isAdmin()" class="nav-item">
            <span class="nav-dot"></span> Create New User
          </a>
        </nav>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <router-outlet />
      </main>
    </div>

    <ng-template #loginTpl>
      <router-outlet />
    </ng-template>
  `,
   styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        caret-color: transparent;
        user-select: none;
      }
      .app-container {
        display: flex;
        min-height: 100vh;
        background: #f8f9fa;
      }

      .sidebar {
        width: 220px;
        min-width: 220px;
        background: #ffffff;
        border-right: 1px solid #e9ecef;
        padding: 24px 0;
        display: flex;
        flex-direction: column;
      }

      .sidebar-brand {
        padding: 0 20px 28px 20px;
        border-bottom: 1px solid #f0f0f0;
        margin-bottom: 20px;
      }

      .brand-name {
        display: block;
        font-size: 15px;
        font-weight: 700;
        color: #5b4fcf;
        letter-spacing: -0.2px;
      }

      .brand-role {
        display: block;
        font-size: 11.5px;
        color: #888;
        margin-top: 2px;
        text-transform: capitalize;
      }

      .sidebar-nav {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 0 12px;
      }

      .nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 6px;
        font-size: 13.5px;
        color: #555;
        text-decoration: none;
        transition:
          background 0.15s,
          color 0.15s;
        cursor: pointer;
      }

      .nav-item:hover {
        background: #f5f3ff;
        color: #5b4fcf;
      }

      .nav-item.active {
        background: #edeaff;
        color: #5b4fcf;
        font-weight: 500;
      }

      .nav-item.active .nav-dot {
        background: #5b4fcf;
      }

      .nav-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ccc;
        flex-shrink: 0;
      }

      .main-content {
        flex: 1;
        overflow: auto;
      }

      input, textarea, [contenteditable="true"] {
        caret-color: auto;
        user-select: text;
      }
    `,
  ],
})
export class App {
  dashService = inject(DashboardService);
  auth = inject(AuthService);

  ngOnInit() {
    this.auth.checkAuth().then(() => {
      this.dashService.load();
      this.dashService.connectLive();
    });
  }

  logout(): void {
    this.auth.logout();
  }
}

