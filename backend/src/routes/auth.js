const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const config = require('../config');

// Extract your middleware at the top for cleaner code
const {verifyToken, requireAdmin } = require('../middleware/auth'); 

function createAuthRouter() {
  const router = express.Router();

  // LOGIN ROUTE (Public)
  router.post('/login', async (req, res) => {
    try {
      const email = String(req.body?.email || "");
      const password = String(req.body?.password || "");
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await User.findOne({ email, active: true }).lean();
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { email: user.email, role: user.role },
        config.jwtSecret,
        { expiresIn: '8h' }
      );

      res.json({
        token,
        user: {
          email: user.email,
          role: user.role,
        },
      });
    } catch (err) {
      console.error('[auth/login]', err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // REGISTER ROUTE (Public/Self-Serve)
  router.post('/register', async (req, res) => {
    try {
      const { password, role, email, display_name } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const exists = await User.findOne({ email }).lean();
      if (exists) {
        return res.status(409).json({ error: 'Email already exists' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const user = await User.create({
        email: email,
        password: hashed,
        role: role || 'developer',
        display_name: display_name,
      });

      const token = jwt.sign(
        { email: user.email, role: user.role },
        config.jwtSecret,
        { expiresIn: '8h' }
      );

      res.status(201).json({
        token,
        user: {
          role: user.role,
          email: user.email,
        },
      });
    } catch (err) {
      console.error('[auth/register]', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // NEW: CREATE USER ROUTE (Protected & Admin Only)
  router.post('/create-user', verifyToken, requireAdmin, async (req, res) => {
    try {
      // Security Check: Only Admins can hit this route!
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Only admins can provision new accounts.' });
      }

      const { email, password, role, active } = req.body || {};
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const exists = await User.findOne({ email }).lean();
      if (exists) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }

      const hashed = await bcrypt.hash(password, 10);
      
      const user = await User.create({
        email: email,
        password: hashed,
        role: role || 'developer',
        active: active !== undefined ? active : true,
      });

      // ⚠️ Notice we DO NOT send back a token here! 
      // The admin creating the account needs to stay logged in as the admin.
      res.status(201).json({
        message: 'User created successfully',
        email: user.email,
        role: user.role
      });
    } catch (err) {
      console.error('[auth/create-user]', err);
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  // CHECK USER ROUTE (Protected)
  router.get('/check-user', verifyToken, async (req, res) => {
    try {
      const user = await User.findOne({ email: req.user.email }).lean();
      
      if (!user || !user.active) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }
      
      res.json({
        email: user.email,
        role: user.role,
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