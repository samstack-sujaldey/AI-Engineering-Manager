import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="login-wrapper">
      <div class="login-card">
        <h1 class="login-title">AI Engineering Manager</h1>
        <p class="login-subtitle">Sign in to continue</p>

        <form [formGroup]="form" (ngSubmit)="onSubmit()">
          <label class="field-label">Username</label>
          <input class="field-input" formControlName="username" autocomplete="username" />

          <label class="field-label">Password</label>
          <input class="field-input" type="password" formControlName="password" autocomplete="current-password" />

          <div class="error-text" *ngIf="auth.error()">{{ auth.error() }}</div>

          <button class="login-btn" type="submit" [disabled]="auth.loading() || form.invalid">
            {{ auth.loading() ? 'Signing in...' : 'Sign In' }}
          </button>
        </form>

        <p class="hint-text">
          Default admin: <b>admin</b> / <b>admin123</b>
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      .login-wrapper {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f5f6fa;
        padding: 24px;
      }

      .login-card {
        background: white;
        border-radius: 12px;
        padding: 32px;
        width: 100%;
        max-width: 360px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .login-title {
        font-size: 20px;
        font-weight: 700;
        color: #1a1a2e;
        margin: 0;
      }

      .login-subtitle {
        font-size: 13px;
        color: #888;
        margin: 0;
      }

      .field-label {
        font-size: 12px;
        font-weight: 600;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .field-input {
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 10px 12px;
        font-size: 14px;
        color: #1a1a2e;
        outline: none;
        background: #fafafd;
      }

      .field-input:focus {
        border-color: #5b4fcf;
      }

      .error-text {
        color: #e53e3e;
        font-size: 13px;
      }

      .login-btn {
        margin-top: 8px;
        background: #5b4fcf;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 10px 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .login-btn:hover:not(:disabled) {
        background: #4a3ebc;
      }

      .login-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .hint-text {
        font-size: 12px;
        color: #888;
        text-align: center;
      }
    `,
  ],
})
export class LoginComponent {
  form: any;
  auth: AuthService;

  constructor(fb: FormBuilder, auth: AuthService, private router: Router) {
    this.auth = auth;
    this.form = fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) return;
    const { username, password } = this.form.value;
    const ok = await this.auth.login(username, password);
    if (ok) {
      this.router.navigate(['/dashboard']);
    }
  }
}
