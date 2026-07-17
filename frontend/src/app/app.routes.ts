import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard';
import { TasksComponent } from './tasks/tasks';
import { StandupSummaryComponent } from './standup-summary/standup-summary';
import { TeamComponent } from './team/team';
import { IntegrationsComponent } from './integrations/integrations';
import { IssuesComponent } from './issues/issues';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'tasks', component: TasksComponent },
  { path: 'standup-summary', component: StandupSummaryComponent },
  { path: 'team', component: TeamComponent },
  { path: 'integrations', component: IntegrationsComponent },
  { path: 'issues', component: IssuesComponent },
  { path: '**', redirectTo: 'dashboard' },
];
