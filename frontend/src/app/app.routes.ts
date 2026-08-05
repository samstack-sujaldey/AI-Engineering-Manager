import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard';
import { TasksComponent } from './tasks/tasks';
import { StandupSummaryComponent } from './standup-summary/standup-summary';
import { TeamComponent } from './team/team';
import { IssuesComponent } from './issues/issues';
import { LoginComponent } from './login/login.component';
import { NewUserComponent } from './new_user/new_user';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [authGuard],
  },
  {
    path: 'tasks',
    component: TasksComponent,
    canActivate: [authGuard],
  },
  {
    path: 'standup-summary',
    component: StandupSummaryComponent,
    canActivate: [authGuard],
  },
  {
    path: 'team',
    component: TeamComponent,
    canActivate: [authGuard],
  },
  {
    path: 'issues',
    component: IssuesComponent,
    canActivate: [authGuard],
  },
  {
    path: 'new-user',
    component:NewUserComponent,
    canActivate: [adminGuard],
  },
  { path: '**', redirectTo: 'dashboard' },
];
