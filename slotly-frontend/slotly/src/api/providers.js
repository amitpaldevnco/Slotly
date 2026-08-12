
import { api, unwrap } from "./client";


export const list = (params = {}, options = {}) =>
  api.get("/providers", { params, ...options }).then(unwrap);

export const get = (providerId, options = {}) =>
  api.get(`/providers/${providerId}`, options).then(unwrap);

export const listServices = (providerId, options = {}) =>
  api.get(`/providers/${providerId}/services`, options).then(unwrap);


export const getAvailability = (providerId, params = {}, options = {}) =>
  api.get(`/providers/${providerId}/availability`, { params, ...options }).then(unwrap);


export const getSlots = (providerId, params, options = {}) =>
  api.get(`/providers/${providerId}/slots`, { params, ...options }).then(unwrap);

export const listReviews = (providerId, options = {}) =>
  api.get(`/providers/${providerId}/reviews`, options).then(unwrap);
