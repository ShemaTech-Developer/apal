// Auth middleware — session-based.
function requireAuth(req, res, next) {
  if (req.session && (req.session.studentId || req.session.teacherId || req.session.adminId)) return next();
  return res.status(401).json({ error: 'Please log in first.' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: 'Administrator login required.' });
}
function requireStudent(req, res, next) {
  if (req.session && req.session.studentId) return next();
  return res.status(401).json({ error: 'Student login required.' });
}
function requireTeacher(req, res, next) {
  if (req.session && req.session.teacherId) return next();
  return res.status(401).json({ error: 'Teacher login required.' });
}
function requireTeacherVerified(req, res, next) {
  if (req.session && req.session.teacherVerified && req.session.teacherVerifiedAt) {
    const ageMs = Date.now() - req.session.teacherVerifiedAt;
    if (ageMs < 10 * 60 * 1000) return next();
  }
  return res.status(403).json({ error: 'School access verification required. Please enter the school access code first.', needsVerification: true });
}
module.exports = { requireAuth, requireAdmin, requireStudent, requireTeacher, requireTeacherVerified };
