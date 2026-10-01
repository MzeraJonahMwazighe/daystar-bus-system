const Student = require('../models/Student');
const { verifyStudentSession } = require('../lib/studentSession');

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

async function loadStudent(req) {
  const token = readCookie(req, 'student_session');
  if (!token) return null;

  try {
    const payload = verifyStudentSession(token);
    if (!payload) return null;

    return await Student.findOne({ _id: payload.studentId, email: payload.email }).lean();
  } catch {
    return null;
  }
}

async function requireStudentAuth(req, res, next) {
  try {
    req.student = await loadStudent(req);
    if (!req.student) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return next();
  } catch (error) {
    console.error('Student authentication failed:', error.message);
    return res.status(401).json({ error: 'Authentication required' });
  }
}

async function optionalStudentAuth(req, res, next) {
  try {
    req.student = await loadStudent(req);
    return next();
  } catch {
    req.student = null;
    return next();
  }
}

module.exports = {
  requireStudentAuth,
  optionalStudentAuth
};