const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const adminService = require('../services/adminService');


/*
|--------------------------------------------------------------------------
| GET /api/admin/stats
|--------------------------------------------------------------------------
*/

exports.stats = asyncHandler(async (req, res) => {
  const stats = await adminService.getStats();

  ok(
    res,
    'Stats fetched',
    stats
  );
});


/*
|--------------------------------------------------------------------------
| GET /api/admin/users?role=&q=
|--------------------------------------------------------------------------
*/

exports.users = asyncHandler(async (req, res) => {
  const {
    role,
    q,
  } = req.query;

  const users = await adminService.getUsers({
    role,
    q,
  });

  ok(
    res,
    'Users fetched',
    users
  );
});


/*
|--------------------------------------------------------------------------
| GET /api/admin/providers?status=PENDING
|--------------------------------------------------------------------------
*/

exports.providers = asyncHandler(async (req, res) => {
  const {
    status,
  } = req.query;

  const providers =
    await adminService.getProviders(status);

  ok(
    res,
    'Providers fetched',
    providers
  );
});


/*
|--------------------------------------------------------------------------
| PUT /api/admin/users/:id/block
|
| Body:
| {
|   "blocked": true
| }
|--------------------------------------------------------------------------
*/

exports.setBlocked = asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);

  const {
    blocked,
  } = req.body;


  /*
   * Validate user ID
   */
  if (!Number.isInteger(userId)) {
    throw new ApiError(
      400,
      'Invalid user ID'
    );
  }


  /*
   * Validate blocked value
   */
  if (typeof blocked !== 'boolean') {
    throw new ApiError(
      400,
      'blocked must be true or false'
    );
  }


  /*
   * Prevent admin from blocking themselves
   */
  if (userId === req.user.user_id) {
    throw new ApiError(
      400,
      'You cannot block yourself'
    );
  }


  const user =
    await adminService.setUserBlocked(
      userId,
      blocked
    );


  /*
   * User not found
   */
  if (!user) {
    throw new ApiError(
      404,
      'User not found'
    );
  }


  ok(
    res,
    blocked
      ? 'User blocked'
      : 'User unblocked',
    user
  );
});