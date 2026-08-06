const jwt = require("jsonwebtoken");



function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
    req.user = decoded; // Contains { id, username, role }
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token." });
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