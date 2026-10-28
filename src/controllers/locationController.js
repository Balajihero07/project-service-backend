const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const {
  autocompletePlaces,
  getPlaceDetails,
} = require('../services/locationService');

const validateSessionToken = (sessionToken) => {
  if (
    typeof sessionToken !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(sessionToken)
  ) {
    throw new ApiError(400, 'A valid session token is required.');
  }
};

exports.autocomplete = asyncHandler(async (req, res) => {
  const input =
    typeof req.query.input === 'string'
      ? req.query.input.trim()
      : '';
  const { sessionToken } = req.query;

  if (!input) {
    throw new ApiError(400, 'Location search text is required.');
  }
  if (input.length < 2) {
    throw new ApiError(400, 'Enter at least 2 characters.');
  }
  if (input.length > 200) {
    throw new ApiError(400, 'Location search text is too long.');
  }

  validateSessionToken(sessionToken);

  const suggestions = await autocompletePlaces(
    input,
    sessionToken
  );

  ok(res, 'Location suggestions fetched.', { suggestions });
});

exports.details = asyncHandler(async (req, res) => {
  const { placeId, sessionToken } = req.query;

  if (
    typeof placeId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(placeId)
  ) {
    throw new ApiError(400, 'Unable to get selected location.');
  }
  validateSessionToken(sessionToken);

  const location = await getPlaceDetails(
    placeId,
    sessionToken
  );

  ok(res, 'Selected location fetched.', location);
});
