const bcrypt = require("bcryptjs");
const User = require("../models/User.js"); // Ensure this path matches your structure

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_ROLE = process.env.ADMIN_ROLE;

async function seedAdmin() {
  try {
    // 1. Safety check for env vars
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_USERNAME) {
      console.log("⚠️ Admin credentials missing in .env. Skipping auto-seed.");
      return;
    }

    // 2. Check by EMAIL to prevent the E11000 duplicate key crash!
    const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });
    if (existingAdmin) {
      console.log("✅ Admin user already exists. Skipping creation.");
      return;
    }

    // 3. Hash password and create user
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

    await User.create({
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: ADMIN_ROLE,
      active: true,
    });

    console.log("🎉 Admin user successfully auto-created!");

  } catch (error) {
    console.error("❌ Error seeding admin user:", error);
  } 
}

module.exports = seedAdmin;