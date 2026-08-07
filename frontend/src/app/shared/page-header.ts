import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header class="page-header">
      <div class="header-left">
        <h1 class="page-title">{{ title }}</h1>
      </div>

      <div class="header-right">
        <!-- Search Bar with Suggestions Dropdown -->
        <div class="search-wrapper" *ngIf="searchEnabled">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            class="search-input"
            [placeholder]="searchPlaceholder"
            [ngModel]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
            (focus)="showDropdown = true"
            (blur)="hideDropdownWithDelay()"
          />

     <!-- Suggestions Dropdown Menu Positioned Underneath -->
          <div class="search-suggestions" *ngIf="showDropdown && searchQuery && suggestions.length > 0">
            <div 
              class="suggestion-item" 
              *ngFor="let item of suggestions"
              (mousedown)="selectSuggestion(item)"
            >
              <span class="suggestion-type" [class.issue]="(item.type || '').toLowerCase() === 'issue'">{{ item.type | uppercase }}</span>
              <div class="suggestion-content">
                <div class="suggestion-title">{{ item.title }}</div>
                <div class="suggestion-subtitle" *ngIf="item.subtitle">{{ item.subtitle }}</div>
              </div>
            </div>
          </div>

          <div class="search-suggestions empty" *ngIf="showDropdown && searchQuery && suggestions.length === 0">
            <div class="suggestion-item">
              <div class="suggestion-content">
                <div class="suggestion-title" style="color: #888; font-style: italic;">No matching tasks or issues found</div>
              </div>
            </div>
          </div>
        </div>

        <ng-content></ng-content>
      </div>
    </header>
  `,
  styles: [
    `
      .page-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 32px; background: #ffffff; border-bottom: 1px solid #e2e8f0; position: relative; z-index: 50; }
      .page-title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0; }
      .header-right { display: flex; align-items: center; gap: 16px; }
      .search-wrapper { position: relative; display: flex; align-items: center; }
      .search-icon { position: absolute; left: 12px; width: 16px; height: 16px; color: #94a3b8; pointer-events: none; }
      .search-input { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 14px 8px 36px; font-size: 13px; color: #0f172a; background: #f8fafc; outline: none; width: 260px; transition: all 0.2s ease; }
      .search-input:focus { border-color: #5b4fcf; background: #ffffff; box-shadow: 0 0 0 3px rgba(91, 79, 207, 0.1); }
      .search-suggestions { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); max-height: 300px; overflow-y: auto; z-index: 100; }
      .suggestion-item { padding: 10px 14px; display: flex; align-items: flex-start; gap: 10px; cursor: pointer; border-bottom: 1px solid #f1f5f9; transition: background 0.15s ease; }
      .suggestion-item:last-child { border-bottom: none; }
      .suggestion-item:hover { background: #f8fafc; }
      .suggestion-type { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: #e0e7ff; color: #5b4fcf; flex-shrink: 0; margin-top: 2px; }
      .suggestion-type.issue { background: #fee2e2; color: #dc2626; }
      .suggestion-content { overflow: hidden; }
      .suggestion-title { font-size: 13px; font-weight: 500; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .suggestion-subtitle { font-size: 11px; color: #64748b; margin-top: 2px; }
      
    `,
  ],
})
export class PageHeaderComponent {
  private router = inject(Router);

  @Input() title: string = '';
  @Input() searchPlaceholder: string = 'Search tasks, teams, or summaries...';
  @Input() searchEnabled: boolean = true;
  @Input() searchQuery: string = '';
  
  @Input() suggestions: Array<{ id?: string; _id?: any; task_id?: string; issue_id?: string; title: string; subtitle?: string; type: string }> = [];

  @Output() searchChange = new EventEmitter<string>();

  showDropdown = false;

  onSearchChange(query: string) {
    this.searchQuery = query;
    this.showDropdown = true;
    this.searchChange.emit(query);
  }

  hideDropdownWithDelay() {
    setTimeout(() => {
      this.showDropdown = false;
    }, 250);
  }

  navigateToTask(taskId: string) {
    this.router.navigate(['/tasks'], { queryParams: { id: taskId } });
  }

  async selectSuggestion(item: any) {
    this.showDropdown = false;
    
    // Safely extract ID supporting MongoDB _id.$oid object variants as well
    const rawId = item._id?.$oid || item.id || item._id || item.task_id || item.issue_id;
    const targetId = rawId ? String(rawId) : '';
    
    const badgeType = (item.type || (item.task_id ? 'task' : item.issue_id ? 'issue' : '')).toLowerCase();

    if (!targetId) {
      console.warn("Item missing ID:", item);
      return;
    }

    if (badgeType.includes('issue') || item.issue_id) {
      const currentChannel = this.router.routerState.snapshot.root.queryParamMap.get('channel');
      const queryParams: any = { id: targetId };
      if (currentChannel) {
        queryParams.channel = currentChannel;
      }
      this.router.navigate(['/issues'], { queryParams });
    } else {
      this.navigateToTask(targetId);
    }
  }
}