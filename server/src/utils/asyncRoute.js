// Express 4 does not catch a rejected promise thrown inside an async route handler — it becomes
// an unhandled rejection and can crash the entire process (verified live: an invalid ObjectId in
// a route param, e.g. GET /api/admin/users/not-an-id, took the whole server down). Every async
// handler must be wrapped in this so errors reach the error-handling middleware instead.
export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
