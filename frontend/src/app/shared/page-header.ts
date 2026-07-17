import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-page-header',
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
      </div>
    </div>
  `,
  styles: [`
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
  `]
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() searchPlaceholder = 'Search...';
}
