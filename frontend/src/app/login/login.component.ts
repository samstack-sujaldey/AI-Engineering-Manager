import { Component, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service'; //[cite: 19]

declare var ScrollReveal: any;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule], //[cite: 19]
  template: `
    <div class="login-shell">
      <div class="login-panel sr-item">
        <div class="brand-block">
          <p class="brand">System Access</p>
          <h1 class="login-title">AI Engineering Manager</h1>
          <p class="login-subtitle">Sign in to continue</p>
        </div>

        <div *ngIf="auth.error()" class="banner error sr-item">
          {{ auth.error() }}
        </div>

        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="login-form">
          <div class="input-group sr-item">
            <label for="username">Username</label>
            <input
              id="username"
              type="text"
              formControlName="username"
              autocomplete="username"
              placeholder="Enter your username"
            />
          </div>

          <div class="input-group sr-item">
            <label for="password">Password</label>
            <input
              id="password"
              type="password"
              formControlName="password"
              autocomplete="current-password"
              placeholder="••••••••"
            />
          </div>

          <button type="submit" class="btn sr-item" [disabled]="auth.loading() || form.invalid">
            {{ auth.loading() ? 'Signing in...' : 'Sign In' }}
          </button>
        </form>

      </div>
    </div>
  `,
  styles: [
    `
      .login-shell {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        --ink: #132019;
        --muted: #5c6b63;
        --paper: #f3efe6;
        --panel: #fffdf8;
        --line: #d5cfc0;
        --accent: #1f6f4a;
        --accent-deep: #0f3d2a;
        --urgent: #b42318;

        background:
          radial-gradient(1200px 500px at 10% -10%, rgba(31, 111, 74, 0.12), transparent 60%),
          linear-gradient(180deg, #e8e2d4 0%, var(--paper) 40%, #ebe6da 100%);
        font-family: 'Source Serif 4', 'Libre Baskerville', Georgia, serif;
        color: var(--ink);
        padding: 24px;
      }

      .login-panel {
        background: var(--panel);
        border: 1px solid var(--line);
        padding: 3.5rem 2.5rem;
        border-radius: 8px;
        width: 100%;
        max-width: 420px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.04);
      }

      .brand-block {
        text-align: center;
        margin-bottom: 2.5rem;
      }

      .brand {
        margin: 0;
        font-family: 'Space Grotesk', 'Avenir Next', sans-serif;
        font-size: 0.85rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent-deep);
        font-weight: 600;
      }

      .login-title {
        margin: 0.5rem 0 0.5rem;
        font-family: 'Space Grotesk', 'Avenir Next', sans-serif;
        font-size: 1.8rem;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--ink);
      }

      .login-subtitle {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
        font-family: 'Space Grotesk', 'Avenir Next', sans-serif;
      }

      .input-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
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

      .input-group input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--line);
        background: #faf7f0;
        padding: 0.85rem 1rem;
        font: inherit;
        outline: none;
        border-radius: 4px;
        transition: border-color 160ms ease, box-shadow 160ms ease;
      }

      .input-group input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(31, 111, 74, 0.1);
      }

      .btn {
        width: 100%;
        font-family: 'Space Grotesk', sans-serif;
        border: none;
        background: var(--accent-deep);
        color: #f7f3ea;
        padding: 0.85rem 1rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
        letter-spacing: 0.04em;
        margin-top: 0.5rem;
        transition: background 160ms ease, opacity 160ms ease;
      }

      .btn:hover:not(:disabled) {
        background: var(--ink);
      }

      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .banner.error {
        padding: 0.85rem 1rem;
        margin-bottom: 1.5rem;
        background: #fbe9e7;
        border-left: 3px solid var(--urgent);
        font-family: 'Space Grotesk', sans-serif;
        font-size: 0.85rem;
        color: var(--urgent);
        border-radius: 0 4px 4px 0;
      }

      .hint-text {
        font-size: 0.85rem;
        color: var(--muted);
        text-align: center;
        margin-top: 1.5rem;
        font-family: 'Space Grotesk', sans-serif;
      }
    `,
  ],
})
export class LoginComponent implements AfterViewInit {
  form: any;
  auth: AuthService;

  constructor(fb: FormBuilder, auth: AuthService, private router: Router) {
    this.auth = auth; //[cite: 19]
    this.form = fb.group({
      username: ['', Validators.required], //[cite: 19]
      password: ['', Validators.required], //[cite: 19]
    });
  }

  ngAfterViewInit(): void {
    ScrollReveal().reveal('.sr-item', {
      delay: 150,
      distance: '20px',
      origin: 'bottom',
      interval: 100,
      duration: 600,
      easing: 'cubic-bezier(0.5, 0, 0, 1)'
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) return; //[cite: 19]
    const { username, password } = this.form.value; //[cite: 19]
    const ok = await this.auth.login(username, password); //[cite: 19]
    if (ok) {
      this.router.navigate(['/dashboard']); //[cite: 19]
    }
  }
}
