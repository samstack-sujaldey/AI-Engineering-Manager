import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../services/task.service';
import { StandupTask, TaskPriority, TaskStatus } from '../models/task.model';

type StatusFilter = 'ALL' | TaskStatus;
type PriorityFilter = 'ALL' | TaskPriority;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  tasks = signal<StandupTask[]>([]);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);
  lastSynced = signal<Date | null>(null);

  searchTerm = '';
  statusFilter: StatusFilter = 'ALL';
  priorityFilter: PriorityFilter = 'ALL';

  statusOptions: StatusFilter[] = ['ALL', 'PROCESSING', 'COMPLETED', 'BLOCKED'];
  priorityOptions: PriorityFilter[] = ['ALL', 'Critical', 'High', 'Medium', 'Low'];

  private readonly avatarPalette = ['#5eead4', '#fb923c', '#60a5fa', '#f472b6', '#a78bfa', '#34d399'];

  filteredTasks = computed(() => {
    const term = this.searchTerm.trim().toLowerCase();
    return this.tasks().filter((t) => {
      const matchesStatus = this.statusFilter === 'ALL' || t.status === this.statusFilter;
      const matchesPriority = this.priorityFilter === 'ALL' || t.priority === this.priorityFilter;
      const haystack = `${t.title} ${t.description ?? ''} ${t.member?.name ?? ''}`.toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      return matchesStatus && matchesPriority && matchesSearch;
    });
  });

  counts = computed(() => {
    const list = this.tasks();
    return {
      total: list.length,
      processing: list.filter((t) => t.status === 'PROCESSING').length,
      completed: list.filter((t) => t.status === 'COMPLETED').length,
      blocked: list.filter((t) => t.status === 'BLOCKED').length,
    };
  });

  constructor(private taskService: TaskService) {}

  ngOnInit(): void {
    this.fetchTasks();
  }

  fetchTasks(): void {
    this.loading.set(true);
    this.error.set(null);
    this.taskService.getTasks().subscribe({
      next: (res) => {
        this.tasks.set(res.tasks);
        this.lastSynced.set(new Date());
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not reach the server. Is the backend running on :8000?');
        this.loading.set(false);
      },
    });
  }

  initials(name: string | undefined): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  avatarColor(name: string | undefined): string {
    if (!name) return this.avatarPalette[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return this.avatarPalette[Math.abs(hash) % this.avatarPalette.length];
  }

  formatTime(date: Date | null): string {
    if (!date) return '—';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
