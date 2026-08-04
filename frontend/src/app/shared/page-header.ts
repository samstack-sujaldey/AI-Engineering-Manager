import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page-header">
      <h1 class="page-title">{{ title }}</h1>
      <div class="header-actions">
        <div class="search-box">
          <span class="search-label">search</span>
          <input type="text" class="search-input" [placeholder]="searchPlaceholder" />
        </div>
        <ng-content></ng-content>
        <div class="auth-section" *ngIf="auth.user()">
          <span class="role-badge">{{ auth.user()?.role }}</span>
          <button class="logout-btn" (click)="logout()">Logout</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 32px;
        background: white;
        border-bottom: 1px solid #e9ecef;
        min-height: 64px;
      }

      .page-title {
        font-size: 20px;
        font-weight: 600;
        color: #1a1a2e;
        margin: 0;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .search-box {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 6px 12px;
        background: white;
      }

      .search-label {
        font-size: 12px;
        color: #888;
        font-weight: 500;
      }

      .search-input {
        border: none;
        outline: none;
        font-size: 13px;
        color: #333;
        width: 220px;
        background: transparent;
      }

      .search-input::placeholder {
        color: #bbb;
      }

      .auth-section {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .role-badge {
        background: #eef2ff;
        color: #5b4fcf;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 3px;
        text-transform: uppercase;
      }

      .logout-btn {
        background: transparent;
        color: #e05050;
        border: 1px solid #e05050;
        border-radius: 4px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }

      .logout-btn:hover {
        background: #e05050;
        color: white;
      }
    `,
  ],
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() searchPlaceholder = 'Search...';
  auth = inject(AuthService);
  private router = inject(Router);

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}

