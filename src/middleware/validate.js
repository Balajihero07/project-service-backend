const { validationResult } = require('express-validator');

module.exports = (req, res, next) => {
  const errors = validationResult(req);
  console.log('Validatio:', errors);
  if (errors.isEmpty()) return next();
  console.log('Validation errorsssss:', errors.array());
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
  });
};
