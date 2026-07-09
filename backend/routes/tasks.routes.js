import express from 'express';
import { getTasks } from '../controllers/tasks.controller.js';

const router = express.Router();

// GET /api/tasks → list all tasks (with member populated) for the dashboard
router.get('/', getTasks);

export default router;
