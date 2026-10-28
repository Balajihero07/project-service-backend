const ApiError = require('../utils/ApiError');

const AUTOCOMPLETE_URL =
  'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL =
  'https://places.googleapis.com/v1/places/';
const TAMIL_NADU_BOUNDS = {
  south: 8.0,
  west: 76.2,
  north: 13.6,
  east: 80.4,
};

const getApiKey = () => {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    throw new ApiError(500, 'Location search is not configured.');
  }

  return process.env.GOOGLE_PLACES_API_KEY;
};

const isInsideTamilNaduBounds = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= TAMIL_NADU_BOUNDS.south &&
  latitude <= TAMIL_NADU_BOUNDS.north &&
  longitude >= TAMIL_NADU_BOUNDS.west &&
  longitude <= TAMIL_NADU_BOUNDS.east;

const callGooglePlaces = async (url, options, failureMessage) => {
  let response;

  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError(502, failureMessage);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(502, failureMessage);
  }

  return { response, body };
};

const autocompletePlaces = async (input, sessionToken) => {
  const apiKey = getApiKey();
  const { response, body } = await callGooglePlaces(
    AUTOCOMPLETE_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'suggestions.placePrediction.placeId',
          'suggestions.placePrediction.text.text',
          'suggestions.placePrediction.structuredFormat.mainText.text',
          'suggestions.placePrediction.structuredFormat.secondaryText.text',
        ].join(','),
      },
      body: JSON.stringify({
        input,
        sessionToken,
        includedRegionCodes: ['IN'],
        locationRestriction: {
          rectangle: {
            low: {
              latitude: TAMIL_NADU_BOUNDS.south,
              longitude: TAMIL_NADU_BOUNDS.west,
            },
            high: {
              latitude: TAMIL_NADU_BOUNDS.north,
              longitude: TAMIL_NADU_BOUNDS.east,
            },
          },
        },
      }),
    },
    'Unable to search locations.'
  );

  if (!response.ok) {
    throw new ApiError(502, 'Unable to search locations.');
  }
  if (!body || typeof body !== 'object') {
    throw new ApiError(502, 'Unable to search locations.');
  }

  if (
    body.suggestions !== undefined &&
    !Array.isArray(body.suggestions)
  ) {
    throw new ApiError(502, 'Unable to search locations.');
  }

  const suggestions = (body.suggestions || [])
    .filter((suggestion) => suggestion?.placePrediction)
    .map(({ placePrediction }) => ({
      placeId: placePrediction.placeId,
      description: placePrediction.text?.text || '',
      mainText:
        placePrediction.structuredFormat?.mainText?.text || '',
      secondaryText:
        placePrediction.structuredFormat?.secondaryText?.text || '',
    }));

  return suggestions;
};

const getComponentText = (components, type) => {
  const component = components.find((item) =>
    item.types?.includes(type)
  );
  return component?.longText || component?.shortText || null;
};

const getPlaceDetails = async (placeId, sessionToken) => {
  const apiKey = getApiKey();
  const url = new URL(
    `${PLACE_DETAILS_URL}${encodeURIComponent(placeId)}`
  );
  url.searchParams.set('sessionToken', sessionToken);

  const { response, body } = await callGooglePlaces(
    url,
    {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'id',
          'displayName',
          'formattedAddress',
          'location',
          'addressComponents',
          'types',
          'googleMapsUri',
        ].join(','),
      },
    },
    'Unable to get selected location.'
  );

  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      throw new ApiError(400, 'Unable to get selected location.');
    }
    throw new ApiError(502, 'Unable to get selected location.');
  }

  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'Unable to get selected location.');
  }

  const components = body.addressComponents || [];
  if (!Array.isArray(components)) {
    throw new ApiError(400, 'Unable to get selected location.');
  }
  const location = {
    placeId: body.id,
    name: body.displayName?.text || null,
    formattedAddress: body.formattedAddress || null,
    latitude: body.location?.latitude,
    longitude: body.location?.longitude,
    country: getComponentText(components, 'country'),
    state: getComponentText(
      components,
      'administrative_area_level_1'
    ),
    district: getComponentText(
      components,
      'administrative_area_level_2'
    ),
    city:
      getComponentText(components, 'locality') ||
      getComponentText(components, 'postal_town') ||
      getComponentText(
        components,
        'administrative_area_level_3'
      ),
    googleMapsUri: body.googleMapsUri || null,
  };

  if (
    !location.placeId ||
    !location.formattedAddress ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  ) {
    throw new ApiError(400, 'Unable to get selected location.');
  }

  if (
    location.country !== 'India' ||
    location.state !== 'Tamil Nadu' ||
    !isInsideTamilNaduBounds(
      location.latitude,
      location.longitude
    )
  ) {
    throw new ApiError(
      400,
      'Please select a location within Tamil Nadu.'
    );
  }

  return location;
};

module.exports = {
  autocompletePlaces,
  getPlaceDetails,
  isInsideTamilNaduBounds,
};
