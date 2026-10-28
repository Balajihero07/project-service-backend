exports.ok = (res, message, data = {}, status = 200) =>
  res.status(status).json({ success: true, message, data });
