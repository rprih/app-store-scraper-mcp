import { z } from "zod";
import scraper from "app-store-scraper";

export const collectionNames = Object.keys(scraper.collection) as [string, ...string[]];
export const categoryNames = Object.keys(scraper.category) as [string, ...string[]];
export const sortNames = Object.keys(scraper.sort) as [string, ...string[]];

// ---------- shared input parameter schemas ----------

export const country = z
  .string()
  .length(2)
  .regex(/^[a-zA-Z]{2}$/, "Must be a two-letter ISO 3166-1 alpha-2 country code, e.g. 'us', 'gb', 'jp'.")
  .optional()
  .describe(
    "Two-letter ISO 3166-1 alpha-2 country code selecting the regional App Store storefront (e.g. 'us', 'gb', 'de', 'jp'). Defaults to 'us'. Determines regional app availability, pricing currency, chart rankings, review pool, and default localized text language.",
  );

export const lang = z
  .string()
  .min(2)
  .optional()
  .describe(
    "IETF BCP 47 language tag for localized metadata text (e.g. 'en-us', 'de-de', 'fr-fr', 'ja-jp'). When omitted, defaults to the primary language of the selected `country` storefront.",
  );

export const trackId = z
  .number()
  .int()
  .positive()
  .describe(
    "Numeric Apple iTunes trackId uniquely identifying the app (e.g. 553834731 for Candy Crush Saga). Obtainable from the `id` field returned by `search_apps`, `list_top_apps`, `list_developer_apps`, or `list_similar_apps`.",
  );

export const optionalTrackId = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Numeric Apple iTunes trackId uniquely identifying the app (e.g. 553834731 for Candy Crush Saga). Provide either `id` or `appId`; prefer `id` when known because several endpoints require an extra lookup round-trip to resolve `appId`.",
  );

export const optionalBundleId = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Case-sensitive reverse-DNS bundle identifier of the app (e.g. 'com.midasplayer.apps.candycrushsaga'). Provide either `id` (numeric trackId) or `appId` (bundle ID). Ignored if `id` is also provided.",
  );

export const verbose = z
  .boolean()
  .optional()
  .describe(
    "When false or omitted (default), returns compact app objects optimized for context window size: `description` is truncated to 300 characters and bulky arrays (`screenshots`, `ipadScreenshots`, `appletvScreenshots`, `supportedDevices`, `languages`, `releaseNotes`) are omitted. Set to true only when you specifically need full descriptions, screenshot URLs, device compatibility lists, or release notes across the list.",
  );

// ---------- output schemas ----------

const ratingsHistogramSchema = () =>
  z
    .record(
      z.string().describe("Star bucket key from '1' (1 star) to '5' (5 stars)."),
      z.number().int().nonnegative().describe("Number of user ratings in this star bucket."),
    )
    .describe("Star rating breakdown mapping star level ('1', '2', '3', '4', '5') to its rating count in the storefront.");

export const appObjectSchema = () =>
  z
    .looseObject({
      id: z
        .union([z.number().int(), z.string()])
        .describe("Numeric iTunes trackId (number from lookup endpoints, or numeric string from RSS chart feeds when `fullDetail` is false)."),
      appId: z
        .string()
        .optional()
        .describe("Reverse-DNS bundle identifier (e.g. 'com.midasplayer.apps.candycrushsaga')."),
      title: z.string().describe("Localized display name of the application on the App Store."),
      url: z
        .string()
        .optional()
        .describe("Canonical Apple App Store product page URL for the application."),
      description: z
        .string()
        .optional()
        .describe(
          "Localized App Store description text. Truncated to 300 characters with an ellipsis in list tools when `verbose` is false or omitted.",
        ),
      icon: z.string().optional().describe("URL of the application artwork icon image (typically 512x512 or 100x100 PNG/JPG)."),
      genres: z
        .array(z.string().describe("Localized category/genre name."))
        .optional()
        .describe("List of localized App Store category names the app belongs to (present on full lookup results)."),
      genreIds: z
        .array(z.union([z.string(), z.number()]).describe("Numeric Apple genre identifier."))
        .optional()
        .describe("List of Apple genre IDs corresponding to `genres` (present on full lookup results)."),
      primaryGenre: z
        .string()
        .optional()
        .describe("Primary App Store category name (e.g. 'Games', 'Productivity')."),
      primaryGenreId: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Numeric Apple genre ID for the app's primary category (e.g. 6014 for Games)."),
      genre: z
        .string()
        .optional()
        .describe("Primary category name returned by `list_top_apps` when `fullDetail` is false."),
      genreId: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Primary category ID returned by `list_top_apps` when `fullDetail` is false."),
      contentRating: z
        .string()
        .optional()
        .describe("Age advisory rating assigned by Apple (e.g. '4+', '9+', '12+', '17+')."),
      languages: z
        .array(z.string().describe("Two-letter ISO 639-1 language code (e.g. 'EN', 'ES')."))
        .optional()
        .describe("Supported ISO language codes. Omitted in list tools unless `verbose: true`."),
      size: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Application download size in bytes (as a numeric string from iTunes Lookup)."),
      requiredOsVersion: z
        .string()
        .optional()
        .describe("Minimum iOS/iPadOS/macOS version required to install the app (e.g. '15.0')."),
      released: z
        .string()
        .optional()
        .describe("ISO-8601 timestamp or localized date string when the app was first released on the App Store."),
      updated: z
        .string()
        .optional()
        .describe("ISO-8601 timestamp when the current version of the app was released."),
      releaseNotes: z
        .string()
        .optional()
        .describe("Release notes ('What's New') for the current version. Omitted in list tools unless `verbose: true`."),
      version: z
        .string()
        .optional()
        .describe("Current published version string of the application (e.g. '1.290.0')."),
      price: z
        .number()
        .optional()
        .describe("Upfront purchase price in the storefront's local `currency` (0 for free-to-download apps)."),
      currency: z
        .string()
        .optional()
        .describe("Three-letter ISO 4217 currency code for `price` (e.g. 'USD', 'EUR', 'GBP', 'JPY')."),
      free: z
        .boolean()
        .optional()
        .describe("True if the app is free to download (`price === 0`), false for paid apps."),
      developerId: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Apple iTunes artistId of the publisher. Pass this numeric value as `devId` to `list_developer_apps`."),
      developer: z
        .string()
        .optional()
        .describe("Display name of the developer or publishing company."),
      developerUrl: z
        .string()
        .optional()
        .describe("App Store URL for the developer's portfolio page."),
      developerWebsite: z
        .string()
        .optional()
        .describe("External marketing or support website URL provided by the developer."),
      score: z
        .number()
        .nullable()
        .optional()
        .describe("Average user star rating (0 to 5) across all versions in the storefront."),
      reviews: z
        .number()
        .nullable()
        .optional()
        .describe("Total count of user ratings received across all versions in the storefront (named `reviews` by upstream iTunes Lookup)."),
      currentVersionScore: z
        .number()
        .nullable()
        .optional()
        .describe("Average user star rating (0 to 5) for the current version in the storefront."),
      currentVersionReviews: z
        .number()
        .nullable()
        .optional()
        .describe("Total count of user ratings for the current version in the storefront."),
      screenshots: z
        .array(z.string().describe("iPhone screenshot image URL."))
        .optional()
        .describe("iPhone screenshot URLs. Omitted in list tools unless `verbose: true`."),
      ipadScreenshots: z
        .array(z.string().describe("iPad screenshot image URL."))
        .optional()
        .describe("iPad screenshot URLs. Omitted in list tools unless `verbose: true`."),
      appletvScreenshots: z
        .array(z.string().describe("Apple TV screenshot image URL."))
        .optional()
        .describe("Apple TV screenshot URLs. Omitted in list tools unless `verbose: true`."),
      supportedDevices: z
        .array(z.string().describe("Apple hardware device identifier (e.g. 'iPhone14-iPhone14')."))
        .optional()
        .describe("Compatible Apple device model identifiers. Omitted in list tools unless `verbose: true`."),
      ratings: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Total user ratings count summed across the 1–5 star histogram (present on `get_app` when `ratings: true`)."),
      histogram: ratingsHistogramSchema().optional(),
    })
    .describe("App Store application metadata record.");

export const searchOutputSchema = z
  .looseObject({
    results: z
      .array(
        z
          .union([
            appObjectSchema(),
            z.number().int().describe("Numeric iTunes trackId when `idsOnly: true`."),
            z.string().describe("String iTunes trackId when `idsOnly: true`."),
          ])
          .describe("App metadata object (default) or raw trackId when `idsOnly: true`."),
      )
      .describe("Ordered list of App Store search results matching the query term."),
  })
  .describe("Search response containing matching App Store applications or track IDs.");

export const appListOutputSchema = z
  .looseObject({
    results: z
      .array(appObjectSchema())
      .describe("Ordered list of App Store application objects."),
  })
  .describe("List response containing App Store application records.");

const reviewItemSchema = z
  .looseObject({
    id: z.string().describe("Unique Apple review entry identifier."),
    userName: z.string().describe("Display name or nickname of the reviewer."),
    userUrl: z.string().describe("App Store reviewer profile URI."),
    version: z.string().describe("App version string that the user was reviewing (e.g. '1.290.0')."),
    score: z.number().int().min(1).max(5).describe("Star rating given by the reviewer (integer from 1 to 5)."),
    title: z.string().describe("Headline title of the user review."),
    text: z.string().describe("Full written body text of the user review."),
    url: z.string().describe("Direct link URL to the review entry."),
    updated: z.string().optional().describe("ISO-8601 timestamp when the review was submitted or last updated."),
  })
  .describe("Single written user review from the App Store Customer Reviews RSS feed.");

export const reviewsOutputSchema = z
  .looseObject({
    results: z
      .array(reviewItemSchema)
      .describe("Page of up to 50 written user reviews for the application in the requested storefront."),
  })
  .describe("Paginated user reviews response.");

export const ratingsOutputSchema = z
  .looseObject({
    ratings: z
      .number()
      .int()
      .nonnegative()
      .describe("Total number of user ratings in the storefront, accurately summed across all 5 buckets of `histogram`."),
    histogram: ratingsHistogramSchema(),
  })
  .describe("Aggregate user rating count and 1–5 star histogram for an app in a country storefront.");

const makePrivacyCategorySchema = () =>
  z
    .looseObject({
      dataCategory: z
        .string()
        .describe("Human-readable privacy data category name (e.g. 'Contact Info', 'Identifiers', 'Usage Data', 'Diagnostics')."),
      identifier: z
        .string()
        .describe("Machine-readable Apple category identifier (e.g. 'CONTACT_INFO', 'IDENTIFIERS', 'USAGE_DATA')."),
      dataTypes: z
        .array(z.string().describe("Specific data element collected within this category (e.g. 'Email Address', 'Device ID', 'Crash Data')."))
        .describe("Granular data types disclosed under this category."),
    })
    .describe("Privacy data category and its disclosed granular data types.");

const privacyPurposeSchema = z
  .looseObject({
    purpose: z
      .string()
      .describe("Human-readable collection purpose (e.g. 'Analytics', 'Third-Party Advertising', 'App Functionality')."),
    identifier: z
      .string()
      .describe("Machine-readable Apple purpose identifier (e.g. 'ANALYTICS', 'THIRD_PARTY_ADVERTISING', 'APP_FUNCTIONALITY')."),
    dataCategories: z
      .array(makePrivacyCategorySchema())
      .describe("Data categories collected for this specific purpose."),
  })
  .describe("Breakdown of data categories collected for a specific purpose.");

const privacyTypeItemSchema = z
  .looseObject({
    privacyType: z
      .string()
      .describe("Top-level Apple privacy classification title (e.g. 'Data Used to Track You', 'Data Linked to You', 'Data Not Linked to You', 'Data Not Collected')."),
    identifier: z
      .string()
      .describe("Machine-readable Apple privacy classification identifier (e.g. 'DATA_USED_TO_TRACK_YOU', 'DATA_LINKED_TO_YOU', 'DATA_NOT_LINKED_TO_YOU')."),
    description: z
      .string()
      .describe("Localized explanation from Apple describing what this privacy classification means."),
    dataCategories: z
      .array(makePrivacyCategorySchema())
      .describe("Summary list of data categories falling under this privacy classification."),
    purposes: z
      .array(privacyPurposeSchema)
      .describe("Per-purpose breakdown showing why each data category is collected (empty for 'Data Used to Track You' or 'Data Not Collected')."),
  })
  .describe("Single App Privacy ('nutrition label') classification card.");

export const privacyOutputSchema = z
  .looseObject({
    privacyPolicyUrl: z
      .string()
      .optional()
      .describe("External URL to the developer's published privacy policy, if linked on the App Store page."),
    privacyTypes: z
      .array(privacyTypeItemSchema)
      .describe("App Privacy nutrition label classifications disclosed by the developer (empty array if the developer has not submitted privacy disclosures)."),
  })
  .describe("App Privacy nutrition label disclosure and privacy policy URL.");

const versionItemSchema = z
  .looseObject({
    version: z
      .string()
      .describe("Published version string with any leading 'Version ' prefix removed (e.g. '1.290.0')."),
    date: z
      .string()
      .optional()
      .describe("Release date normalized to an ISO-8601 UTC timestamp string (or raw date string if unparseable)."),
    releaseNotes: z
      .string()
      .describe("Localized release notes ('What's New') text for this version (empty string if none provided)."),
  })
  .describe("Single historical version entry from the App Store Version History shelf.");

export const versionsOutputSchema = z
  .looseObject({
    results: z
      .array(versionItemSchema)
      .describe("Version history entries ordered newest first (Apple lists at most the ~25 most recent versions)."),
  })
  .describe("Historical release log for the application.");

export const suggestionsOutputSchema = z
  .looseObject({
    results: z
      .array(
        z
          .looseObject({
            term: z.string().describe("Suggested App Store search query string."),
          })
          .describe("Autocomplete suggestion entry."),
      )
      .describe("Ordered list of up to 50 App Store search autocomplete suggestions."),
  })
  .describe("App Store search autocomplete suggestions response.");
