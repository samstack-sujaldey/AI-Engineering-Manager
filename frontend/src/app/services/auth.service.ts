import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuthUser {

  email?: string;
  role: string;
  display_name?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http: HttpClient;
  readonly user = signal<AuthUser | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor(http: HttpClient) {
    this.http = http;
    const stored = localStorage.getItem('auth_user');
    const token = localStorage.getItem('auth_token');
    if (stored && token) {
      try {
        this.user.set(JSON.parse(stored));
      } catch {
        this.clear();
      }
    }
  }

  async login(email: string, password: string): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.http.post<{ token: string; user: AuthUser }>(
          `${environment.apiUrl}/auth/login`,
          { email, password }
        )
      );
      localStorage.setItem('auth_token', result.token);
      localStorage.setItem('auth_user', JSON.stringify(result.user));
      this.user.set(result.user);
      return true;
    } catch (err: any) {
      this.error.set(err.error?.error || 'Login failed');
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  async register(username: string, password: string, role = 'developer'): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.http.post<{ token: string; user: AuthUser }>(
          `${environment.apiUrl}/auth/register`,
          { username, password, role }
        )
      );
      localStorage.setItem('auth_token', result.token);
      localStorage.setItem('auth_user', JSON.stringify(result.user));
      this.user.set(result.user);
      return true;
    } catch (err: any) {
      this.error.set(err.error?.error || 'Registration failed');
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  async checkAuth(): Promise<boolean> {
    const token = localStorage.getItem('auth_token');
    if (!token) return false;
    try {
      const user = await firstValueFrom(
        this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`)
      );
      localStorage.setItem('auth_user', JSON.stringify(user));
      this.user.set(user);
      return true;
    } catch {
      this.clear();
      return false;
    }
  }

  hasRole(role: string | string[]): boolean {
    const current = this.user();
    if (!current) return false;
    const allowed = Array.isArray(role) ? role : [role];
    return allowed.includes(current.role);
  }

  isAdmin(): boolean {
    return this.hasRole('admin');
  }

  isManager(): boolean {
    return this.hasRole(['admin', 'manager']);
  }

  logout(): void {
    this.clear();
  }

  private clear(): void {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    this.user.set(null);
  }
}
