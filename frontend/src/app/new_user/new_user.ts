import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';
import { PageHeaderComponent } from '../shared/page-header';

@Component({
  selector: 'app-new-user',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent,ReactiveFormsModule],
  template: `
  <app-page-header title="Admin" searchPlaceholder="Find a team member..."></app-page-header>

    <div class="card-container">
      <div class="form-card">
        <div class="header-block">
          <h2 class="title">Provision New Account</h2>
          <p class="subtitle">Create a new system user and assign permissions.</p>
        </div>

        <div *ngIf="errorMessage" class="banner error">
          {{ errorMessage }}
        </div>
        
        <div *ngIf="successMessage" class="banner success">
          {{ successMessage }}
        </div>

        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="user-form">
          <div class="input-group">
            <label for="email">Email Address</label>
            <input id="email" type="email" formControlName="email" placeholder="user@domain.com" />
          </div>

          <div class="form-row">
            <div class="input-group">
              <label for="role">System Role</label>
              <select id="role" formControlName="role">
                <option value="viewer">Viewer (Read-only)</option>
                <option value="developer">Developer</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin (Full Access)</option>
              </select>
            </div>

            <div class="input-group">
              <label for="password">Temporary Password</label>
              <input id="password" type="password" formControlName="password" placeholder="••••••••" />
            </div>
          </div>

          <div class="toggle-group">
            <label class="checkbox-container">
              <input type="checkbox" formControlName="active" />
              <span class="checkmark"></span>
              <span class="toggle-label">Account is Active (User can log in immediately)</span>
            </label>
          </div>

          <button type="submit" class="btn primary" [disabled]="loading || form.invalid">
            {{ loading ? 'Creating User...' : 'Create Account' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [
    `
      .card-container {
        padding: 24px;
        --ink: #132019;
        --muted: #5c6b63;
        --panel: #ffffff;
        --line: #e2dfd5;
        --accent: #1f6f4a;
        --accent-deep: #0f3d2a;
        --urgent: #b42318;
        --success: #0d5c34;
        font-family: 'Source Serif 4', 'Libre Baskerville', Georgia, serif;
      }
       app-page-header ::ng-deep .search-wrapper,
    app-page-header ::ng-deep input[type="text"],
    app-page-header ::ng-deep input.search-input,
    .search-bar,
    .search-container {
      display: none !important;
    }
      .form-card {
        background: var(--panel);
        border: 1px solid var(--line);
        padding: 2.5rem;
        border-radius: 8px;
        max-width: 550px;
        margin: 0 auto;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
      }

      .header-block {
        margin-bottom: 2rem;
        border-bottom: 1px solid var(--line);
        padding-bottom: 1.5rem;
      }

      .title {
        margin: 0 0 0.5rem 0;
        font-family: 'Space Grotesk', 'Avenir Next', sans-serif;
        font-size: 1.4rem;
        font-weight: 600;
        color: var(--ink);
      }

      .subtitle {
        margin: 0;
        color: var(--muted);
        font-size: 0.95rem;
        font-family: 'Space Grotesk', sans-serif;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
      }

      @media (max-width: 500px) {
        .form-row { grid-template-columns: 1fr; gap: 0; }
      }

      .input-group {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        margin-bottom: 1.5rem;
      }

      .input-group label {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 0.72rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
        font-weight: 600;
      }

      .input-group input, .input-group select {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--line);
        background: #faf7f0;
        padding: 0.75rem 1rem;
        font: inherit;
        outline: none;
        border-radius: 4px;
        transition: border-color 160ms ease, box-shadow 160ms ease;
      }

      .input-group input:focus, .input-group select:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(31, 111, 74, 0.1);
      }
      
      .toggle-group {
        margin-bottom: 2rem;
        padding-top: 0.5rem;
      }

      .checkbox-container {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        cursor: pointer;
        font-family: 'Space Grotesk', sans-serif;
        font-size: 0.9rem;
        color: var(--ink);
      }

      .checkbox-container input {
        width: 1.2rem;
        height: 1.2rem;
        cursor: pointer;
        accent-color: var(--accent);
      }

      .btn {
        font-family: 'Space Grotesk', sans-serif;
        border: none;
        background: var(--accent-deep);
        color: #f7f3ea;
        padding: 0.85rem 1.5rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
        letter-spacing: 0.04em;
        transition: background 160ms ease;
        float: right;
      }

      .btn:hover:not(:disabled) {
        background: var(--ink);
      }

      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .banner {
        padding: 0.85rem 1rem;
        margin-bottom: 1.5rem;
        font-family: 'Space Grotesk', sans-serif;
        font-size: 0.85rem;
        border-radius: 0 4px 4px 0;
      }

      .banner.error {
        background: #fbe9e7;
        border-left: 3px solid var(--urgent);
        color: var(--urgent);
      }

      .banner.success {
        background: #e8f5e9;
        border-left: 3px solid var(--success);
        color: var(--success);
      }
      
      .user-form::after {
        content: "";
        display: table;
        clear: both;
      }
    `
  ]
})
export class NewUserComponent {
  form: FormGroup;
  loading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;

  constructor(
    private fb: FormBuilder, 
    private http: HttpClient
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      role: ['developer', Validators.required],
      password: ['', [Validators.required, Validators.minLength(6)]],
      active: [true] // Default to active
    });
  }

  onSubmit() {
    if (this.form.invalid) return;

    this.loading = true;
    this.errorMessage = null;
    this.successMessage = null;

    const token = localStorage.getItem('auth_token');
    
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });

    this.http.post(
      `${environment.apiUrl}/auth/create-user`, 
      this.form.value, 
      { headers }
    ).subscribe({
      next: (response: any) => {
        this.loading = false;
        this.successMessage = `Successfully created account for ${this.form.value.email}.`;
        this.form.reset({ role: 'developer', active: true });
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err.error?.error || 'Failed to create user. Ensure you have Admin privileges.';
      }
    });
  }
}