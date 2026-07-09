import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TasksResponse } from '../models/task.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly baseUrl = `${environment.apiUrl}/tasks`;

  private readonly slackProcessUrl =
    `${environment.apiUrl}/slack/channels/C0BFP88C535/process?limit=50`;

  constructor(private http: HttpClient) {}

  getTasks(): Observable<TasksResponse> {
    return this.http.get<TasksResponse>(this.baseUrl);
  }

  processSlackChannel(): Observable<any> {
    return this.http.post<any>(this.slackProcessUrl, {});
  }
}