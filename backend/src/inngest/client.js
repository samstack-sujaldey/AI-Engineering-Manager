// src/inngest/client.js
const { Inngest } = require("inngest");

// Initialize Inngest Client
const inngest = new Inngest({
  id: "ai-engineering-manager",
  // Ensures events sent via inngest.send() go to local dev server (http://127.0.0.1:8288)
  isDev: process.env.NODE_ENV !== "production",
});

module.exports = { inngest };