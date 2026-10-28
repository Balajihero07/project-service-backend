exports.notFound = (req, res) =>
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });

exports.errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  let status = Number(err.statusCode || err.status);
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;

  let message = err.message || 'Internal server error';

  // PostgreSQL error codes
  if (err.code === '23505') { status = 409; message = 'Record already exists'; }
  else if (err.code === '23503') { status = 400; message = 'Referenced record does not exist'; }
  else if (err.code === '22P02') { status = 400; message = 'Invalid input format'; }
  else if (err.code === 'LIMIT_FILE_SIZE') { status = 400; message = 'File too large (max 5MB)'; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON request body'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Request body too large'; }

  if (status === 500) {
    console.error(err);
    if (process.env.NODE_ENV === 'production') message = 'Internal server error';
  }
  res.status(status).json({ success: false, message });
};
