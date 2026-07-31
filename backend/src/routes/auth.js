const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const config = require('../config');

function createAuthRouter() {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const user = await User.findOne({ username, active: true }).lean();
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = jwt.sign(
        { username: user.username, role: user.role, display_name: user.display_name },
        config.jwtSecret,
        { expiresIn: '8h' }
      );

      res.json({
        token,
        user: {
          username: user.username,
          role: user.role,
          email: user.email,
          display_name: user.display_name,
        },
      });
    } catch (err) {
      console.error('[auth/login]', err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  router.post('/register', async (req, res) => {
    try {
      const { username, password, role, email, display_name } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const exists = await User.findOne({ username }).lean();
      if (exists) {
        return res.status(409).json({ error: 'Username already exists' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const user = await User.create({
        username,
        password: hashed,
        role: role || 'developer',
        email: email || '',
        display_name: display_name || username,
      });

      const token = jwt.sign(
        { username: user.username, role: user.role, display_name: user.display_name },
        config.jwtSecret,
        { expiresIn: '8h' }
      );

      res.status(201).json({
        token,
        user: {
          username: user.username,
          role: user.role,
          email: user.email,
          display_name: user.display_name,
        },
      });
    } catch (err) {
      console.error('[auth/register]', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  router.get('/me', require('../middleware/auth').authMiddleware(), async (req, res) => {
    try {
      const user = await User.findOne({ username: req.user.username }).lean();
      if (!user || !user.active) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }
      res.json({
        username: user.username,
        role: user.role,
        email: user.email,
        display_name: user.display_name,
      });
    } catch (err) {
      console.error('[auth/me]', err);
      res.status(500).json({ error: 'Failed to fetch current user' });
    }
  });

  return router;
}

module.exports = { createAuthRouter };
