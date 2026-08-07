const jwt = require("jsonwebtoken");



function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  // 🟢 FIX: Ensure the environment variable exists. Do NOT use a hardcoded fallback.
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[AUTH FATAL] JWT_SECRET is not defined in environment variables.");
    return res.status(500).json({ error: "Internal server configuration error." });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded; // Contains { id, username, role }
    next();
  } catch (error) {
    // Distinguish between expired and malformed tokens for better client-side handling
    if (error.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token has expired. Please log in again." });
    }
    res.status(401).json({ error: "Invalid token." });
  }
}

function requireAdmin(req, res, next) {
  // Matching the exact lowercase 'admin' from your schema's enum
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: "Forbidden. Admin access required to perform this action." });
  }
  next();
}

module.exports = { verifyToken, requireAdmin };