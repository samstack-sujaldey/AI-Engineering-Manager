import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // If they are an admin, let them pass
  if (auth.isAdmin()) {
    return true;
  }
  
  // Otherwise, kick them back to the dashboard securely
  return router.parseUrl('/dashboard'); 
};