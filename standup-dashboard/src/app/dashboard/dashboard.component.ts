import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';

import { TaskService } from '../services/task.service';
import {
  StandupTask,
  TaskPriority,
  TaskStatus,
} from '../models/task.model';

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

  statusOptions: StatusFilter[] = [
    'ALL',
    'PROCESSING',
    'COMPLETED',
    'BLOCKED',
  ];

  priorityOptions: PriorityFilter[] = [
    'ALL',
    'Critical',
    'High',
    'Medium',
    'Low',
  ];

  private readonly avatarPalette = [
    '#5eead4',
    '#fb923c',
    '#60a5fa',
    '#f472b6',
    '#a78bfa',
    '#34d399',
  ];

  filteredTasks = computed(() => {
    const term = this.searchTerm.trim().toLowerCase();

    return this.tasks().filter((task) => {

      const matchesStatus =
        this.statusFilter === 'ALL' ||
        task.status === this.statusFilter;

      const matchesPriority =
        this.priorityFilter === 'ALL' ||
        task.priority === this.priorityFilter;

      const haystack = `
        ${task.title ?? ''}
        ${task.description ?? ''}
        ${task.member?.name ?? ''}
      `.toLowerCase();

      const matchesSearch =
        !term || haystack.includes(term);

      return (
        matchesStatus &&
        matchesPriority &&
        matchesSearch
      );
    });
  });

  counts = computed(() => {
    const list = this.tasks();

    return {
      total: list.length,

      processing: list.filter(
        (task) => task.status === 'PROCESSING'
      ).length,

      completed: list.filter(
        (task) => task.status === 'COMPLETED'
      ).length,

      blocked: list.filter(
        (task) => task.status === 'BLOCKED'
      ).length,
    };
  });

  constructor(private taskService: TaskService) {}

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);

    const slackStatus = params.get('slack');

    if (slackStatus === 'connected') {
      this.syncSlackTasks();
    } else {
      this.fetchTasks();
    }
  }

  /**
   * Load already-existing tasks from database.
   */
  fetchTasks(): void {
    this.loading.set(true);
    this.error.set(null);

    this.taskService.getTasks().subscribe({

      next: (res) => {
        console.log('Existing tasks response:', res);

        this.tasks.set(res.tasks ?? []);
        this.lastSynced.set(new Date());
        this.loading.set(false);
      },

      error: (err: HttpErrorResponse) => {
        console.error('Task fetching error:', err);

        this.error.set(
          err.error?.message ||
          err.error?.error ||
          err.message ||
          'Could not fetch tasks.'
        );

        this.loading.set(false);
      },
    });
  }

  /**
   * Process Slack messages through the backend AI pipeline
   * and render returned tasks directly in the dashboard.
   */
 syncSlackTasks(): void {
  this.loading.set(true);
  this.error.set(null);

  this.taskService.processSlackChannel().subscribe({
    next: (res: any) => {
      console.log('Slack AI response:', res);

      // Slack processing completed.
      // Now fetch all saved tasks from the database.
      this.taskService.getTasks().subscribe({
        next: (taskResponse) => {
          console.log('Saved tasks from database:', taskResponse.tasks);

          this.tasks.set(taskResponse.tasks ?? []);
          this.lastSynced.set(new Date());
          this.loading.set(false);
        },

        error: (err: HttpErrorResponse) => {
          console.error('Error fetching saved tasks:', err);

          this.error.set(
            err.error?.message ||
            err.error?.error ||
            err.message ||
            'Slack processing succeeded, but saved tasks could not be fetched.'
          );

          this.loading.set(false);
        },
      });
    },

    error: (err: HttpErrorResponse) => {
      console.error('Slack processing error:', err);
      console.error('Backend response:', err.error);

      this.error.set(
        err.error?.message ||
        err.error?.error ||
        err.message ||
        'Could not process Slack channel messages.'
      );

      this.loading.set(false);
    },
  });
}

  /**
   * Redirect browser to Slack OAuth installation endpoint.
   */
  connectToSlack(): void {
    window.location.href =
      'http://localhost:5000/api/slack/install';
  }

  /**
   * Normalize backend/AI priority values so they match
   * the existing dashboard filters and CSS.
   */
  normalizePriority(
    priority: string | undefined
  ): TaskPriority {

    if (!priority) {
      return 'Low';
    }

    const value = priority
      .trim()
      .toLowerCase();

    if (value === 'critical') {
      return 'Critical';
    }

    if (value === 'high') {
      return 'High';
    }

    if (value === 'medium') {
      return 'Medium';
    }

    return 'Low';
  }

  initials(
    name: string | undefined
  ): string {

    if (!name) {
      return '?';
    }

    const parts = name
      .trim()
      .split(/\s+/);

    const first =
      parts[0]?.[0] ?? '';

    const last =
      parts.length > 1
        ? parts[parts.length - 1][0]
        : '';

    return (
      first + last
    ).toUpperCase();
  }

  avatarColor(
    name: string | undefined
  ): string {

    if (!name) {
      return this.avatarPalette[0];
    }

    let hash = 0;

    for (
      let i = 0;
      i < name.length;
      i++
    ) {
      hash =
        name.charCodeAt(i) +
        ((hash << 5) - hash);
    }

    return this.avatarPalette[
      Math.abs(hash) %
        this.avatarPalette.length
    ];
  }

  formatTime(
    date: Date | null
  ): string {

    if (!date) {
      return '—';
    }

    return date.toLocaleTimeString(
      [],
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    );
  }
}