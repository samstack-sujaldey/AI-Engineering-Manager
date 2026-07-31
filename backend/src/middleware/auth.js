const jwt = require('jsonwebtoken');
const config = require('../config');

function authMiddleware(requiredRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    if (!token) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      if (!decoded || !decoded.username) {
        return res.status(401).json({ error: 'Invalid token payload' });
      }
      if (requiredRoles.length > 0 && !requiredRoles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden: insufficient role' });
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { authMiddleware };
