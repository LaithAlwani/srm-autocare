/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as addOns from "../addOns.js";
import type * as auth from "../auth.js";
import type * as bookings from "../bookings.js";
import type * as calcom from "../calcom.js";
import type * as contact from "../contact.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as gallery from "../gallery.js";
import type * as http from "../http.js";
import type * as reviews from "../reviews.js";
import type * as seed from "../seed.js";
import type * as services from "../services.js";
import type * as siteContent from "../siteContent.js";
import type * as square from "../square.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  addOns: typeof addOns;
  auth: typeof auth;
  bookings: typeof bookings;
  calcom: typeof calcom;
  contact: typeof contact;
  crons: typeof crons;
  files: typeof files;
  gallery: typeof gallery;
  http: typeof http;
  reviews: typeof reviews;
  seed: typeof seed;
  services: typeof services;
  siteContent: typeof siteContent;
  square: typeof square;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
