const Staff = require('../models/Staff');
const { verifyStaffSession } = require('../lib/staffSession');
const { readCookie } = require('../lib/cookies');

// Loads the logged-in staff member from the staff_session cookie.
// The account is re-read from the database on every request, and only an
// active account counts, so deactivating someone locks them out immediately.
async function loadStaff(req) {
  const token = readCookie(req, 'staff_session');
  if (!token) return null;

  const payload = verifyStaffSession(token);
  if (!payload) return null;

  return Staff.findOne({ _id: payload.staffId, email: payload.email, active: true }).lean();
}

// requireStaff()                 -> any active staff member
// requireStaff('campus_admin')   -> campus admins (and super admins)
// requireStaff('super_admin')    -> super admins only
// A super admin passes every role check.
function requireStaff(...allowedRoles) {
  return async function staffAuthMiddleware(req, res, next) {
    let staff = null;
    try {
      staff = await loadStaff(req);
    } catch (error) {
      console.error('Staff authentication failed:', error.message);
      staff = null;
    }

    if (!staff) {
      return res.status(401).json({ error: 'Staff login required' });
    }

    if (allowedRoles.length > 0 && staff.role !== 'super_admin' && !allowedRoles.includes(staff.role)) {
      return res.status(403).json({ error: 'You do not have permission for this action' });
    }

    req.staff = staff;
    return next();
  };
}

module.exports = {
  requireStaff
};
