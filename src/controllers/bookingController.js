const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const bookingService = require('../services/bookingService');

/*
|--------------------------------------------------------------------------
| CREATE
|--------------------------------------------------------------------------
*/

const createBookingResponse = async (req, res, bookingType) => {
  const booking = await bookingService.createBooking(
    req.body,
    req.user.user_id,
    bookingType
  );
  const fullBooking = await bookingService.loadBooking(
    booking.booking_id,
    req.user
  );
  ok(
    res,
    booking.provider_count
      ? 'Booking request sent to nearby providers'
      : 'Booking created; no available providers found nearby. You can cancel and submit a new request later.',
    {
      ...bookingService.presentBooking(fullBooking, req.user),
      provider_count: booking.provider_count,
      request_status: booking.provider_count ? 'SENT' : 'NO_PROVIDERS',
    },
    201
  );
};

exports.create = asyncHandler(async (req, res) => {
  await createBookingResponse(req, res, 'google');
});

exports.createLive = asyncHandler(async (req, res) => {
  await createBookingResponse(req, res, 'live');
});

exports.createScheduled = asyncHandler(async (req, res) => {
  await createBookingResponse(req, res, 'date');
});


/*
|--------------------------------------------------------------------------
| LIST
|--------------------------------------------------------------------------
*/

exports.list = asyncHandler(
  async (req, res) => {

    const bookings =
      await bookingService.listBookings(
        req.user
      );

    ok(
      res,
      'Bookings fetched',
      bookings.map((b) =>
        bookingService.presentBooking(
          b,
          req.user
        )
      )
    );
  }
);


/*
|--------------------------------------------------------------------------
| GET
|--------------------------------------------------------------------------
*/

exports.get = asyncHandler(
  async (req, res) => {

    const booking =
      await bookingService.loadBooking(
        req.params.id,
        req.user
      );

    ok(
      res,
      'Booking fetched',
      bookingService.presentBooking(
        booking,
        req.user
      )
    );
  }
);


/*
|--------------------------------------------------------------------------
| UPDATE STATUS
|--------------------------------------------------------------------------
*/

exports.updateStatus =
  asyncHandler(
    async (req, res) => {
      await bookingService.updateBookingStatus(
        req.params.id,
        req.user,
        req.body.status
      );

      const updated =
        await bookingService.loadBooking(
          req.params.id,
          req.user
        );

      ok(
        res,
        `Booking ${req.body.status}`,
        bookingService.presentBooking(
          updated,
          req.user
        )
      );
    }
  );

exports.providerRequests = asyncHandler(async (req, res) => {
  const requests = await bookingService.listProviderRequests(req.user.user_id);
  ok(res, 'Provider requests fetched', requests);
});

const listProviderBookings = (category) => asyncHandler(async (req, res) => {
  const result = await bookingService.listProviderBookings(
    req.user.user_id,
    category,
    req.query
  );
  ok(res, `Provider ${category} bookings fetched`, {
    ...result,
    bookings: result.bookings.map((booking) =>
      bookingService.presentBooking(booking, req.user)
    ),
  });
});

exports.providerActiveBookings = listProviderBookings('active');
exports.providerBookingHistory = listProviderBookings('history');

exports.accept = asyncHandler(async (req, res) => {
  const bookingId = await bookingService.acceptBooking(req.params.id, req.user.user_id);
  const booking = await bookingService.loadBooking(bookingId, req.user);
  ok(res, 'Booking accepted', bookingService.presentBooking(booking, req.user));
});

exports.reject = asyncHandler(async (req, res) => {
  await bookingService.rejectBooking(req.params.id, req.user.user_id);
  ok(res, 'Booking request rejected', { booking_id: Number(req.params.id), request_status: 'REJECTED' });
});

exports.generateOtp = asyncHandler(async (req, res) => {
  const result = await bookingService.generateCustomerOtp(req.params.id, req.user.user_id);
  ok(res, 'Booking OTP generated', result);
});

/*
|--------------------------------------------------------------------------
| VERIFY OTP
|--------------------------------------------------------------------------
*/

exports.verifyOtp =
  asyncHandler(
    async (req, res) => {
      await bookingService.verifyBookingOtp(
        req.params.id,
        req.user.user_id,
        req.body.otp
      );

      const updated =
        await bookingService.loadBooking(
          req.params.id,
          req.user
        );

      ok(
        res,
        'Service started',
        bookingService.presentBooking(
          updated,
          req.user
        )
      );
    }
  );